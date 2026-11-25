import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Agent } from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { ProxyAgent, Socks5ProxyAgent } from 'undici';
import type { Dispatcher } from 'undici';

/** Proxy de salida de un canal. Nunca se devuelve completo por la API ni se registra en logs. */
export type ProxyConfig = { protocol: 'socks5' | 'socks5h' | 'http' | 'https'; host: string; port: number; username: string; password: string };

/** Agentes para cada camino de red de Baileys: WebSocket, subida de media y fetch (media, app-state, historial). */
export type ProxyAgents = { agent: Agent; fetchAgent: Agent; dispatcher: Dispatcher };

const PROTOCOLS = new Set(['socks5:', 'socks5h:', 'http:', 'https:']);

/** Valida una URL tipo socks5h://usuario:clave@host:puerto. Devuelve null si no es válida. */
export function parseProxyUrl(value: string): ProxyConfig | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  let url: URL;
  try { url = new URL(value.trim()); } catch { return null; }
  if (!PROTOCOLS.has(url.protocol) || !url.hostname || !url.port) return null;
  if ((url.pathname !== '' && url.pathname !== '/') || url.search || url.hash) return null;
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return {
    protocol: url.protocol.slice(0, -1) as ProxyConfig['protocol'],
    host: url.hostname, port,
    username: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
  };
}

export function proxyUrl(config: ProxyConfig, withCredentials = true): string {
  const auth = withCredentials && config.username ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@` : '';
  return `${config.protocol}://${auth}${config.host}:${config.port}`;
}

/** Versión segura para mostrar: protocolo, host y puerto, sin usuario ni contraseña. */
export const maskProxy = (config: ProxyConfig) => proxyUrl(config, false);

function getKey(): Buffer {
  const key = process.env.WHATSAPP_SESSION_KEY;
  if (!key || !/^[0-9a-f]{64}$/i.test(key)) throw new Error('WHATSAPP_SESSION_KEY debe contener 64 caracteres hexadecimales.');
  return Buffer.from(key, 'hex');
}

const aad = (channelId: string) => Buffer.from(JSON.stringify(['proxy', channelId]));

/** Cifra el proxy con AES-256-GCM, ligado al canal para que no pueda copiarse a otro. */
export function encryptProxy(config: ProxyConfig, channelId: string): string {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  cipher.setAAD(aad(channelId));
  const data = Buffer.concat([cipher.update(JSON.stringify(config), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64')).join('.');
}

export function decryptProxy(value: string, channelId: string): ProxyConfig {
  const parts = value.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) throw new Error('Proxy cifrado inválido.');
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(parts[0]!, 'base64'));
  decipher.setAAD(aad(channelId)); decipher.setAuthTag(Buffer.from(parts[1]!, 'base64'));
  const config = JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[2]!, 'base64')), decipher.final()]).toString('utf8')) as ProxyConfig;
  const parsed = parseProxyUrl(proxyUrl(config));
  if (!parsed) throw new Error('Proxy cifrado inválido.');
  return parsed;
}

/**
 * Crea los agentes de red. socks5 se trata como socks5h: el DNS también se resuelve
 * en el proxy, para que ninguna consulta salga desde la IP del servidor.
 */
export function createProxyAgents(config: ProxyConfig): ProxyAgents {
  if (config.protocol === 'socks5' || config.protocol === 'socks5h') {
    const url = proxyUrl({ ...config, protocol: 'socks5h' });
    const agent = new SocksProxyAgent(url) as unknown as Agent;
    const dispatcher = new Socks5ProxyAgent(`socks5://${config.host}:${config.port}`, config.username ? { username: config.username, password: config.password } : {});
    return { agent, fetchAgent: agent, dispatcher };
  }
  const url = proxyUrl(config);
  const agent = new HttpsProxyAgent(url) as unknown as Agent;
  return { agent, fetchAgent: agent, dispatcher: new ProxyAgent(url) };
}

export async function closeProxyAgents(agents: ProxyAgents | undefined) {
  if (!agents) return;
  agents.agent.destroy();
  await agents.dispatcher.close().catch(() => {});
}

/**
 * Consulta la IP pública con la que sale el proxy. Falla si el proxy no responde.
 * Usa el fetch global de Node, el mismo que usa Baileys para media, app-state e historial:
 * si el dispatcher no fuera compatible con esa versión de Node, el canal falla cerrado en vez de
 * salir por la IP del servidor. Requiere Node 26 (undici 8 incluido), como indica .nvmrc.
 */
export async function checkExitIp(agents: ProxyAgents, timeoutMs = 10000, url = 'https://api.ipify.org?format=json'): Promise<string> {
  const response = await fetch(url, { dispatcher: agents.dispatcher, signal: AbortSignal.timeout(timeoutMs) } as RequestInit);
  if (!response.ok) throw new Error('El proxy no respondió correctamente.');
  const data = await response.json() as { ip?: unknown };
  if (typeof data.ip !== 'string' || !/^[0-9a-f.:]{3,45}$/i.test(data.ip)) throw new Error('El proxy devolvió una IP inválida.');
  return data.ip;
}
