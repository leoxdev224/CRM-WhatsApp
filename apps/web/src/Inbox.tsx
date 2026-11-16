import { useEffect, useState } from 'react';

type Conversation = {
  id: string; kind: string; contact_name: string; contact_phone: string | null;
  channel_name: string; channel_phone: string | null; status: string; operator_name: string | null;
  last_message: string | null; last_message_type: string | null; last_message_direction: string | null; last_message_at: string | null;
};
type Option = { id: string; display_name: string; phone_number?: string | null };
const statuses: Record<string, string> = { open: 'Abierta', pending: 'En espera', resolved: 'Resuelta', spam: 'Spam' };
const messageTypes: Record<string, string> = { image: 'Foto', video: 'Video', document: 'Documento', audio: 'Audio', sticker: 'Sticker', location: 'Ubicación', contact: 'Contacto', system: 'Mensaje del sistema' };

export function ConversationList({ conversations }: { conversations: Conversation[] }) {
  if (!conversations.length) return <p className="inbox-empty">No hay conversaciones para mostrar con estos filtros.</p>;
  return <ul className="conversation-list">{conversations.map((item) => <li key={item.id} className="conversation-row">
    <div className="conversation-primary"><strong>{item.kind === 'group' ? `Grupo · ${item.contact_name.replace(/@g\.us$/, '')}` : item.contact_name}</strong>
      <span className="conversation-time">{item.last_message_at ? new Date(item.last_message_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : 'Sin mensajes'}</span></div>
    <p className="conversation-preview">{item.last_message_direction === 'outgoing' ? 'Vos: ' : ''}{item.last_message || (item.last_message_type ? messageTypes[item.last_message_type] ?? 'Mensaje' : 'Sin mensajes')}</p>
    <div className="conversation-meta"><span>{item.channel_name}{item.channel_phone ? ` · ${item.channel_phone}` : ''}</span><span>{item.operator_name ?? 'Sin asignar'}</span><span className="conversation-status">{statuses[item.status] ?? item.status}</span></div>
    {item.contact_phone && <span className="contact-phone">{item.contact_phone}</span>}
  </li>)}</ul>;
}

export function Inbox({ token }: { token: string }) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('');
  const [operator, setOperator] = useState('');
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<Conversation[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [options, setOptions] = useState<{ channels: Option[]; operators: Option[] } | null>(null);
  const [error, setError] = useState('');
  const [optionsError, setOptionsError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => { const timer = window.setTimeout(() => { setDebounced(search); setPage(0); }, 300); return () => window.clearTimeout(timer); }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/inbox/options', { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(); return response.json() as Promise<{ channels: Option[]; operators: Option[] }>; })
      .then((data) => { setOptions(data); setOptionsError(false); })
      .catch(() => { if (!controller.signal.aborted) setOptionsError(true); });
    return () => controller.abort();
  }, [token, retry]);
  useEffect(() => {
    const controller = new AbortController();
    let sequence = 0;
    setItems(null); setError('');
    const params = new URLSearchParams({ search: debounced, channel, status, operator, limit: '20', offset: String(page * 20) });
    async function load() {
      const current = ++sequence;
      try {
        const response = await fetch(`/api/conversations?${params}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!response.ok) throw new Error();
        const data = await response.json() as { conversations: Conversation[]; hasMore: boolean };
        if (!controller.signal.aborted && current === sequence) { setItems(data.conversations); setHasMore(data.hasMore); setError(''); }
      } catch { if (!controller.signal.aborted && current === sequence) setError('No se pudo actualizar la bandeja. Revisá la conexión e intentá nuevamente.'); }
    }
    void load();
    const timer = window.setInterval(() => { void load(); }, 5000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [token, debounced, channel, status, operator, page, retry]);

  return <section className="inbox" aria-labelledby="inbox-title">
    <div className="inbox-header"><div><h2 id="inbox-title">Bandeja unificada</h2><p>Conversaciones de tus líneas de WhatsApp</p></div><span className="inbox-live">Actualización automática</span></div>
    <div className="inbox-filters">
      <label className="inbox-search">Buscar contacto<input type="search" placeholder="Nombre o número" maxLength={100} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <label>Cuenta<select value={channel} onChange={(event) => { setChannel(event.target.value); setPage(0); }}><option value="">Todas las cuentas</option>{options?.channels.map((item) => <option key={item.id} value={item.id}>{item.display_name}{item.phone_number ? ` · ${item.phone_number}` : ''}</option>)}</select></label>
      <label>Estado<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}><option value="">Todos los estados</option>{Object.entries(statuses).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
      <label>Operador<select value={operator} onChange={(event) => { setOperator(event.target.value); setPage(0); }}><option value="">Todos los operadores</option><option value="unassigned">Sin asignar</option>{options?.operators.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select></label>
    </div>
    {optionsError && <p role="alert" className="inbox-error">No se pudieron cargar los filtros. <button type="button" onClick={() => setRetry((value) => value + 1)}>Reintentar</button></p>}
    {error && <p role="alert" className="inbox-error">{error} <button type="button" onClick={() => setRetry((value) => value + 1)}>Reintentar</button></p>}
    {items ? <ConversationList conversations={items} /> : !error && <p role="status" className="inbox-empty">Cargando conversaciones…</p>}
    <nav className="inbox-pagination" aria-label="Páginas de conversaciones"><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Anterior</button><span>Página {page + 1}</span><button type="button" disabled={!items || !hasMore} onClick={() => setPage((value) => value + 1)}>Siguiente</button></nav>
  </section>;
}
