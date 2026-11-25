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

type Channel = { id: string; phone_number: string | null; display_name: string; connection_status: string; connection_type?: string; proxy_label?: string | null; proxy_exit_ip?: string | null; proxy_checked_at?: string | null; reconnects?: number; last_error?: string | null; next_retry_at?: number | null };

export function ChannelList({ channels }: { channels: Channel[] }) {
  const states: Record<string, string> = { awaiting_qr: 'Pendiente', starting: 'Conectando', qr: 'Esperando QR', connected: 'Conectado', disconnected: 'Desconectado', revoked: 'Revocado', duplicate: 'Número duplicado', duplicate_cleanup_failed: 'Revisión necesaria' };
  return <section className="channel-section" aria-labelledby="channels-title">
    <h2 id="channels-title">Canales de WhatsApp</h2>
    <p>Los ejemplos son ficticios; las conexiones de WhatsApp Web muestran el estado del servidor.</p>
    {channels.length === 0 ? <p>No hay canales registrados.</p> : <ul className="channel-list">{channels.map((channel) => (
      <li key={channel.id}><span className="channel-dot" aria-hidden="true" /><span><strong>{channel.display_name}</strong><small>{channel.phone_number ?? 'Sin número vinculado'}{channel.connection_type === 'demo' && ' · Ejemplo ficticio'}</small></span><span className="channel-state">{states[channel.connection_status] ?? 'Estado desconocido'}</span></li>
    ))}</ul>}
  </section>;
}

function ChannelManager({ token, channels, refresh }: { token: string; channels: Channel[]; refresh: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [connection, setConnection] = useState<{ status: string; qr: string | null } | null>(null);
  const [message, setMessage] = useState('');
  const [proxyDraft, setProxyDraft] = useState<Record<string, string>>({});
  const [proxyBusy, setProxyBusy] = useState<string | null>(null);
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
  async function saveProxy(id: string, proxyUrl: string | null) {
    if (proxyUrl === null && !window.confirm('¿Quitar el proxy? El canal volverá a salir por la IP del servidor.')) return;
    setMessage(''); setProxyBusy(id);
    try {
      const response = await fetch(`/api/channels/${id}/proxy`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ proxyUrl }) });
      const data = await response.json().catch(() => ({})) as { error?: string; proxy?: { exitIp: string } | null };
      if (!response.ok) throw new Error(data.error ?? 'No se pudo guardar el proxy.');
      setProxyDraft((draft) => ({ ...draft, [id]: '' }));
      setMessage(data.proxy ? `Proxy guardado. IP de salida: ${data.proxy.exitIp}` : 'Proxy quitado.');
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo guardar el proxy.'); }
    finally { setProxyBusy(null); }
  }
  return <section className="channel-section channel-connect" aria-labelledby="manage-title"><h2 id="manage-title">Vincular WhatsApp Web</h2>
    <p>Integración no oficial. Probá primero con un número de prueba.</p>
    <form className="channel-form" onSubmit={create}><label>Nombre del canal <input placeholder="Ej. Atención principal" required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></label><button className="button-primary">Agregar canal</button></form>
    <ul className="manage-list">{channels.filter((channel) => channel.connection_type === 'whatsapp_web').map((channel) => <li key={channel.id}>
      <div className="manage-channel"><div><strong>{channel.display_name}</strong><small>{channel.phone_number ?? 'Sin número vinculado'} · {active === channel.id ? connection?.status ?? 'starting' : channel.connection_status}</small></div>
      <div className="manage-actions"><button type="button" onClick={() => void connect(channel.id)}>Conectar / ver QR</button>{' '}
      <button type="button" onClick={() => void disconnect(channel.id)}>Desvincular</button></div></div>
      <div className="channel-proxy">
        <small>{channel.proxy_label ? <>Proxy: {channel.proxy_label} · IP de salida: {channel.proxy_exit_ip ?? 'sin verificar'}</> : 'Sin proxy: sale por la IP del servidor'}
          {!!channel.reconnects && <> · Reconexiones: {channel.reconnects}</>}
          {channel.last_error === 'proxy_unavailable' && <> · <strong>Proxy sin respuesta</strong></>}
          {channel.next_retry_at && <> · Reintento {new Date(channel.next_retry_at).toLocaleTimeString()}</>}</small>
        <form className="channel-form" onSubmit={(event) => { event.preventDefault(); void saveProxy(channel.id, proxyDraft[channel.id] ?? ''); }}>
          <label>Proxy del canal <input type="password" autoComplete="off" placeholder="socks5://usuario:clave@host:puerto" maxLength={500} value={proxyDraft[channel.id] ?? ''} onChange={(event) => setProxyDraft((draft) => ({ ...draft, [channel.id]: event.target.value }))} /></label>
          <button disabled={proxyBusy === channel.id || !(proxyDraft[channel.id] ?? '').trim()}>{proxyBusy === channel.id ? 'Probando…' : 'Probar y guardar'}</button>
          {channel.proxy_label && <button type="button" disabled={proxyBusy === channel.id} onClick={() => void saveProxy(channel.id, null)}>Quitar proxy</button>}
        </form>
      </div>
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
  const [channelsOpen, setChannelsOpen] = useState(false);

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

  if (token) return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="#inbox-title"><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M5 5.5h14v10H11l-4.5 3v-3H5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M8 9h8M8 12h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg></span><span><strong>CRM WhatsApp</strong><small>Espacio de trabajo</small></span></a>
      <nav className="side-nav" aria-label="Navegación principal"><span className="nav-label">ESPACIO DE TRABAJO</span><a className="nav-active" href="#inbox-title"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5h16v11H9l-5 3V5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M8 9h8M8 12h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>Bandeja</a>{role === 'admin' && <a href="#channel-settings" onClick={() => setChannelsOpen(true)}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-6 6v4m0-4a6 6 0 0 1-6-6V8Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>Canales</a>}</nav>
      <div className="sidebar-footer"><div className="user-avatar" aria-hidden="true">{name.trim().charAt(0).toUpperCase() || 'U'}</div><div className="user-info"><strong>{name}</strong><small>{role === 'admin' ? 'Administrador' : 'Operador'}</small></div><button className="logout-button" type="button" onClick={logout}>Cerrar sesión</button></div>
    </aside>
    <main className="workspace"><header className="workspace-top"><div><span className="top-context">CRM WhatsApp</span><span className="top-separator">/</span><span>Bandeja</span></div><div className="top-user">Sesión iniciada: <strong>{name}</strong></div></header>
      <div className="workspace-content"><Inbox token={token} />
        {role === 'admin' && <details id="channel-settings" className="channel-settings" open={channelsOpen} onToggle={(event) => setChannelsOpen(event.currentTarget.open)}><summary>Administrar canales <span>Conexiones y números de WhatsApp</span></summary><div className="channel-settings-content">{channelError ? <p role="alert">{channelError}</p> : channels ? <><ChannelList channels={channels} /><ChannelManager token={token} channels={channels} refresh={refreshChannels} /></> : <p role="status">Cargando canales…</p>}</div></details>}
        {error && <p role="alert" className="global-error">{error}</p>}
      </div>
    </main>
  </div>;

  return <main className="login-page"><div className="login-card"><div className="login-brand"><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M5 5.5h14v10H11l-4.5 3v-3H5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M8 9h8M8 12h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg></span><span>CRM WhatsApp</span></div>
    {restoring ? <p role="status">Recuperando sesión…</p> : restoreError ? <><p role="alert">No se pudo comprobar la sesión. Revisá la conexión.</p><button type="button" className="button-primary" onClick={() => { setRestoreError(false); setRestoring(true); setRestoreAttempt((value) => value + 1); }}>Reintentar</button></> : <><h1>Bienvenido de nuevo</h1><p className="login-intro">Ingresá para acceder a tu espacio de trabajo.</p>
        <form className="login-form" onSubmit={login}>
          <label>Correo electrónico <input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Contraseña <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label>Código de autenticación (administradores) <input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value)} /></label>
          <button type="submit" className="button-primary" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
        </form>
      </>}
      {error && <p role="alert" className="global-error">{error}</p>}
      </div><p className="login-footer">Tu espacio para atender conversaciones</p></main>;
}
