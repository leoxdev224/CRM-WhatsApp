import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import type { AuthenticationState, SignalDataTypeMap, SignalDataSet } from '@whiskeysockets/baileys';
import type { Pool } from 'pg';

function getKey(): Buffer {
  const key = process.env.WHATSAPP_SESSION_KEY;
  if (!key || !/^[0-9a-f]{64}$/i.test(key)) throw new Error('WHATSAPP_SESSION_KEY debe contener 64 caracteres hexadecimales.');
  return Buffer.from(key, 'hex');
}

function encrypt(value: unknown, aad: string): string {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(JSON.stringify(value, BufferJSON.replacer), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64')).join('.');
}

function decrypt(value: string, aad: string): unknown {
  const parts = value.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) throw new Error('Sesión cifrada inválida.');
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(parts[0]!, 'base64'));
  decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(Buffer.from(parts[1]!, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[2]!, 'base64')), decipher.final()]).toString('utf8'), BufferJSON.reviver);
}

export async function createAuthStore(pool: Pool, channel: string): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  getKey();
  async function read(type: string, id: string): Promise<unknown> {
    const result = await pool.query<{ encrypted_value: string }>('SELECT encrypted_value FROM whatsapp_auth_state WHERE channel_account_id = $1 AND key_type = $2 AND key_id = $3', [channel, type, id]);
    return result.rows[0] ? decrypt(result.rows[0].encrypted_value, JSON.stringify([channel, type, id])) : null;
  }
  async function write(type: string, id: string, value: unknown) {
    if (value === null || value === undefined) {
      await pool.query('DELETE FROM whatsapp_auth_state WHERE channel_account_id = $1 AND key_type = $2 AND key_id = $3', [channel, type, id]);
    } else {
      await pool.query('INSERT INTO whatsapp_auth_state (channel_account_id, key_type, key_id, encrypted_value) VALUES ($1,$2,$3,$4) ON CONFLICT (channel_account_id,key_type,key_id) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value', [channel, type, id, encrypt(value, JSON.stringify([channel, type, id]))]);
    }
  }
  const creds = (await read('credentials', 'main') as AuthenticationState['creds'] | null) ?? initAuthCreds();
  const state: AuthenticationState = { creds, keys: {
    async get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]) {
      const result: Record<string, SignalDataTypeMap[T]> = {};
      for (const id of ids) {
        const value = await read(type, id);
        if (value !== null) result[id] = (type === 'app-state-sync-key' ? proto.Message.AppStateSyncKeyData.fromObject(value as object) : value) as SignalDataTypeMap[T];
      }
      return result;
    },
    async set(data: SignalDataSet) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const [type, values] of Object.entries(data)) for (const [id, value] of Object.entries(values ?? {})) {
          if (value === null || value === undefined) await client.query('DELETE FROM whatsapp_auth_state WHERE channel_account_id=$1 AND key_type=$2 AND key_id=$3', [channel, type, id]);
          else await client.query('INSERT INTO whatsapp_auth_state (channel_account_id,key_type,key_id,encrypted_value) VALUES ($1,$2,$3,$4) ON CONFLICT (channel_account_id,key_type,key_id) DO UPDATE SET encrypted_value=EXCLUDED.encrypted_value', [channel, type, id, encrypt(value, JSON.stringify([channel, type, id]))]);
        }
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
  } };
  return { state, saveCreds: () => write('credentials', 'main', creds) };
}
