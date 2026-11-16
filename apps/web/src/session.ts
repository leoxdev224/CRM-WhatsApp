export const sessionKey = 'crm_session_token';

export async function restoreSession(storage: Pick<Storage, 'getItem' | 'removeItem'>, request: typeof fetch = fetch) {
  const token = storage.getItem(sessionKey);
  if (!token) return null;
  const response = await request('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 401) { storage.removeItem(sessionKey); return null; }
  if (!response.ok) throw new Error('No se pudo recuperar la sesión.');
  const data = await response.json() as { user: { display_name: string; role: string } };
  return { token, name: data.user.display_name, role: data.user.role };
}
