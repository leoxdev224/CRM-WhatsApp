import { useState } from 'react';
import type { FormEvent } from 'react';

export function App() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, code }),
      });
      if (!response.ok) throw new Error(response.status === 429 ? 'Demasiados intentos. Intentalo más tarde.' : 'No se pudo iniciar sesión. Revisá tus datos.');
      const data = await response.json() as { token: string; user: { displayName: string } };
      setToken(data.token);
      setName(data.user.displayName);
      setPassword('');
      setCode('');
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo conectar.'); }
    finally { setBusy(false); }
  }

  async function logout() {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok && response.status !== 401) throw new Error();
      setToken(null);
      setName('');
    } catch { setError('No se pudo cerrar la sesión. Intentá nuevamente.'); }
  }

  return (
    <main>
      <h1>CRM WhatsApp</h1>
      {token ? <><p>Sesión iniciada: {name}</p><button type="button" onClick={logout}>Cerrar sesión</button></> : (
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
