import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { restoreSession, sessionKey } from './session.js';
import { Inbox } from './Inbox.js';

function sessionStorageOrNull(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}

function hasSavedSession() {
  try { return !!sessionStorageOrNull()?.getItem(sessionKey); } catch { return false; }
}

type Channel = { id: string; phone_number: string | null; display_name: string; connection_status: string; connection_type?: string };

export function ChannelList({ channels }: { channels: Channel[] }) {
  const states: Record<string, string> = { awaiting_qr: 'Pendiente', starting: 'Conectando', qr: 'Esperando QR', connected: 'Conectado', disconnected: 'Desconectado', revoked: 'Revocado', duplicate: 'Número duplicado', duplicate_cleanup_failed: 'Revisión necesaria' };
  return <section aria-labelledby="channels-title">
    <h2 id="channels-title">Canales de WhatsApp</h2>
    <p>Los ejemplos son ficticios; las conexiones de WhatsApp Web muestran el estado del servidor.</p>
    {channels.length === 0 ? <p>No hay canales registrados.</p> : <ul>{channels.map((channel) => (
      <li key={channel.id}>{channel.display_name} · {channel.phone_number ?? 'Sin número vinculado'} · {states[channel.connection_status] ?? 'Estado desconocido'}{channel.connection_type === 'demo' && ' (ejemplo ficticio)'}</li>
    ))}</ul>}
  </section>;
}

function ChannelManager({ token, channels, refresh }: { token: string; channels: Channel[]; refresh: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [connection, setConnection] = useState<{ status: string; qr: string | null } | null>(null);
  const [message, setMessage] = useState('');
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    async function poll() {
      try {
        const response = await fetch(`/api/channels/${active}/connection`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!response.ok) throw new Error('No se pudo consultar el estado del canal.');
        const data = await response.json() as { status: string; qr: string | null };
        setConnection(data);
        if (['connected', 'disconnected', 'duplicate', 'duplicate_cleanup_failed'].includes(data.status)) await refresh();
      } catch { if (!controller.signal.aborted) setMessage('No se pudo consultar el canal.'); }
    }
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 3000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [active, token, refresh]);

  async function create(event: FormEvent) {
    event.preventDefault(); setMessage('');
    try {
      const response = await fetch('/api/channels', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: name }) });
      if (!response.ok) throw new Error();
      const data = await response.json() as { id: string };
      setName(''); await refresh(); await connect(data.id);
    } catch { setMessage('No se pudo crear el canal.'); }
  }
  async function connect(id: string) {
    setMessage(''); setConnection(null);
    try {
      const response = await fetch(`/api/channels/${id}/connect`, { method: 'POST', headers });
      if (!response.ok) throw new Error();
      setActive(id);
    } catch { setMessage('No se pudo iniciar la conexión. Revisá la configuración del servidor.'); }
  }
  async function disconnect(id: string) {
    if (!window.confirm('¿Desvincular esta cuenta de WhatsApp?')) return;
    setMessage('');
    try {
      const response = await fetch(`/api/channels/${id}/disconnect`, { method: 'POST', headers });
      if (!response.ok) throw new Error();
      setActive(null); setConnection(null); await refresh();
    } catch { setMessage('No se pudo desvincular el canal.'); }
  }
  return <section aria-labelledby="manage-title"><h2 id="manage-title">Vincular WhatsApp Web</h2>
    <p>Integración no oficial. Probá primero con un número de prueba.</p>
    <form onSubmit={create}><label>Nombre del canal <input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></label><button>Agregar canal</button></form>
    <ul>{channels.filter((channel) => channel.connection_type === 'whatsapp_web').map((channel) => <li key={channel.id}>
      {channel.display_name} · {channel.phone_number ?? 'Sin número vinculado'} · {active === channel.id ? connection?.status ?? 'starting' : channel.connection_status}
      {' '}<button type="button" onClick={() => void connect(channel.id)}>Conectar / ver QR</button>{' '}
      <button type="button" onClick={() => void disconnect(channel.id)}>Desvincular</button>
      {active === channel.id && connection?.qr && <div><p>En WhatsApp: Dispositivos vinculados → Vincular dispositivo.</p><img src={connection.qr} alt="Código QR para vincular WhatsApp" /></div>}
      {active === channel.id && connection?.status === 'duplicate' && <p role="alert">Este número ya está registrado en otro canal de esta organización. Se solicitó desvincular la sesión duplicada; comprobá Dispositivos vinculados en el teléfono.</p>}
      {active === channel.id && connection?.status === 'duplicate_cleanup_failed' && <p role="alert">Este número ya está registrado en otro canal. No se pudo completar la limpieza: revisá y desvinculá el dispositivo duplicado desde WhatsApp antes de volver a intentar.</p>}
    </li>)}</ul>
    {message && <p role="alert">{message}</p>}
  </section>;
}

export function App() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [channelError, setChannelError] = useState('');
  const [revision, setRevision] = useState(0);
  const refreshChannels = useCallback(async () => { setRevision((value) => value + 1); }, []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(hasSavedSession);
  const [restoreError, setRestoreError] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);

  useEffect(() => {
    if (!restoring) return;
    const storage = sessionStorageOrNull();
    if (!storage) { setRestoring(false); return; }
    let cancelled = false;
    void restoreSession(storage).then((session) => {
      if (cancelled) return;
      if (session) { setToken(session.token); setName(session.name); setRole(session.role); }
      setRestoring(false);
    }).catch(() => { if (!cancelled) { setRestoreError(true); setRestoring(false); } });
    return () => { cancelled = true; };
  }, [restoring, restoreAttempt]);

  useEffect(() => {
    if (!token || role !== 'admin') return;
    const controller = new AbortController();
    setChannelError('');
    void fetch('/api/channels', { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('No se pudieron cargar los canales.');
        return response.json() as Promise<{ channels: Channel[] }>;
      })
      .then((data) => setChannels(data.channels))
      .catch((err: unknown) => { if (!controller.signal.aborted) setChannelError(err instanceof Error ? err.message : 'No se pudieron cargar los canales.'); });
    return () => controller.abort();
  }, [token, role, revision]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, code }),
      });
      if (!response.ok) throw new Error(response.status === 429 ? 'Demasiados intentos. Intentalo más tarde.' : 'No se pudo iniciar sesión. Revisá tus datos.');
      const data = await response.json() as { token: string; user: { displayName: string; role: string } };
      try {
        const storage = sessionStorageOrNull();
        if (!storage) throw new Error();
        storage.setItem(sessionKey, data.token);
      }
      catch { setError('No se pudo guardar la sesión en esta pestaña; deberás ingresar de nuevo al recargar.'); }
      setToken(data.token);
      setName(data.user.displayName);
      setRole(data.user.role);
      setPassword('');
      setCode('');
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo conectar.'); }
    finally { setBusy(false); }
  }

  async function logout() {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok && response.status !== 401) throw new Error();
      try { sessionStorageOrNull()?.removeItem(sessionKey); } catch { /* El servidor ya revocó la sesión. */ }
      setToken(null);
      setName('');
      setRole('');
      setChannels(null);
    } catch { setError('No se pudo cerrar la sesión. Intentá nuevamente.'); }
  }

  return (
    <main className={token ? 'workspace' : undefined}>
      <h1>CRM WhatsApp</h1>
      {restoring ? <p role="status">Recuperando sesión…</p> : restoreError ? <><p role="alert">No se pudo comprobar la sesión. Revisá la conexión.</p><button type="button" onClick={() => { setRestoreError(false); setRestoring(true); setRestoreAttempt((value) => value + 1); }}>Reintentar</button></> : token ? <><p>Sesión iniciada: {name}</p><button type="button" onClick={logout}>Cerrar sesión</button>
        <Inbox token={token} />
        {role === 'admin' && <details className="channel-settings"><summary>Administrar canales</summary>{channelError ? <p role="alert">{channelError}</p> : channels ? <><ChannelList channels={channels} /><ChannelManager token={token} channels={channels} refresh={refreshChannels} /></> : <p role="status">Cargando canales…</p>}</details>}
      </> : (
        <form onSubmit={login}>
          <label>Correo electrónico <input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Contraseña <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label>Código de autenticación (administradores) <input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value)} /></label>
          <button type="submit" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
