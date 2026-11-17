import { ConversationDetails } from './ConversationDetails.js';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

type Message = { id: string; direction: string; message_type: string; body: string | null; occurred_at: string; sender_external_id: string | null; delivery_status: number | null; send_state: string | null };
type ChatData = { current_user_id: string; conversation: { id: string; kind: string; contact_name: string; contact_phone: string | null; external_id: string; status: string; assigned_user_id: string | null; channel_name: string; channel_phone: string | null; connection_type: string }; messages: Message[]; hasMore: boolean };
const types: Record<string, string> = { image: 'Foto', video: 'Video', document: 'Documento', audio: 'Audio', sticker: 'Sticker', location: 'Ubicación', contact: 'Contacto', system: 'Mensaje del sistema' };
const delivery: Record<number, string> = { 1: 'Pendiente', 2: 'Recibido por WhatsApp', 3: 'Entregado', 4: 'Leído', 5: 'Reproducido' };

export function MessageList({ messages, group = false }: { messages: Message[]; group?: boolean }) {
  if (!messages.length) return <p className="chat-empty">No hay mensajes guardados en esta conversación.</p>;
  return <ol className="chat-messages">{messages.map((message) => {
    const state = message.delivery_status && message.delivery_status >= 2 ? delivery[message.delivery_status] : message.send_state === 'unknown' || message.send_state === 'sending' ? 'Sin confirmar' : message.send_state === 'submitted' ? 'Enviado, pendiente de confirmación' : message.delivery_status ? delivery[message.delivery_status] : '';
    return <li key={message.id} className={`chat-message ${message.direction === 'outgoing' ? 'outgoing' : 'incoming'}`}>
      <div className="chat-bubble">{group && message.direction === 'incoming' && message.sender_external_id && <span className="chat-sender">{message.sender_external_id}</span>}
        <p>{message.body || types[message.message_type] || 'Mensaje'}</p>
        <div className="chat-message-meta"><time dateTime={message.occurred_at}>{new Date(message.occurred_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</time>{state && <span>{state}</span>}</div>
      </div>
    </li>;
  })}</ol>;
}

export function Chat({ token, id, onBack }: { token: string; id: string; onBack: () => void }) {
  const [data, setData] = useState<ChatData | null>(null);
  const [older, setOlder] = useState<Message[]>([]);
  const [hasOlder, setHasOlder] = useState<boolean | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sendError, setSendError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [retry, setRetry] = useState(0);
  const historyRef = useRef<HTMLDivElement>(null);
  const followNewest = useRef(true);
  const path = `/api/conversations/${id}/messages`;
  const headers = { Authorization: `Bearer ${token}` };
  useEffect(() => {
    const controller = new AbortController(); let sequence = 0;
    async function load() {
      const current = ++sequence;
      try {
        const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!response.ok) throw new Error();
        const result = await response.json() as ChatData;
        if (!controller.signal.aborted && sequence === current) { setData(result); setError(''); }
      } catch { if (!controller.signal.aborted && sequence === current) setError('No se pudo actualizar la conversación. Revisá la conexión.'); }
    }
    void load();
    const interval = window.setInterval(() => { void load(); }, 5000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [token, path, retry]);
  useEffect(() => {
    const history = historyRef.current;
    if (history && followNewest.current) history.scrollTop = history.scrollHeight;
  }, [data]);
  async function loadOlder() {
    if (!data || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const oldest = older[0] ?? data.messages[0];
      if (!oldest) return;
      const response = await fetch(`${path}?before=${oldest.id}`, { headers });
      if (!response.ok) throw new Error();
      const result = await response.json() as ChatData;
      setOlder((current) => [...result.messages, ...current]); setHasOlder(result.hasMore); setError('');
    } catch { setError('No se pudieron cargar los mensajes anteriores.'); }
    finally { setLoadingOlder(false); }
  }
  async function send(event: FormEvent) {
    event.preventDefault(); if (busy || uncertain || !text.trim()) return;
    const content = text; const requestId = crypto.randomUUID();
    setBusy(true); setSendError('');
    try {
      const response = await fetch(path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: requestId, text: content }) });
      if (response.status === 400 || response.status === 401 || response.status === 404 || response.status === 409) {
        const result = await response.json() as { error?: string };
        setSendError(result.error || 'No se pudo enviar el mensaje.'); return;
      }
      if (!response.ok) throw new Error();
      const result = await response.json() as { send_state: string };
      setText(''); setRetry((value) => value + 1);
      if (result.send_state !== 'submitted') { setUncertain(true); setSendError('No se pudo confirmar el envío. Revisá WhatsApp antes de volver a enviar.'); }
    } catch { setUncertain(true); setSendError('No se pudo confirmar el envío. Revisá WhatsApp antes de volver a enviar.'); setRetry((value) => value + 1); }
    finally { setBusy(false); }
  }
  const merged = new Map<string, Message>();
  for (const message of [...older, ...(data?.messages ?? [])]) merged.set(message.id, message);
  const messages = [...merged.values()].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.id.localeCompare(b.id));
  return <section className="chat-panel" aria-label="Conversación">
    <header className="chat-header"><button type="button" className="chat-back" onClick={onBack}>← Volver a la bandeja</button>
      {data && <div><h2>{data.conversation.kind === 'group' ? `Grupo · ${data.conversation.contact_name.replace(/@g\.us$/, '')}` : data.conversation.contact_name}</h2><p>Respondés desde <strong>{data.conversation.channel_name}</strong>{data.conversation.channel_phone ? ` · ${data.conversation.channel_phone}` : ''}</p></div>}
    </header>
    {error && <p className="chat-alert" role="alert">{error} <button type="button" onClick={() => setRetry((value) => value + 1)}>Reintentar</button></p>}
    {!data && !error && <p className="chat-empty" role="status">Cargando conversación…</p>}
    {data && <><ConversationDetails token={token} id={id} conversation={data.conversation} currentUserId={data.current_user_id} refresh={() => setRetry((value) => value + 1)} /><div className="chat-history" ref={historyRef} onScroll={(event) => { const el = event.currentTarget; followNewest.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>{(hasOlder ?? data.hasMore) && <button type="button" className="chat-older" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? 'Cargando…' : 'Cargar mensajes anteriores'}</button>}<MessageList messages={messages} group={data.conversation.kind === 'group'} /></div>
      {sendError && <p className="chat-alert" role="alert">{sendError} {uncertain && <button type="button" onClick={() => { setUncertain(false); setSendError(''); }}>Ya revisé el estado</button>}</p>}
      {data.conversation.connection_type === 'whatsapp_web' ? <form className="chat-compose" onSubmit={send}><label htmlFor="chat-reply">Tu respuesta</label><div><textarea id="chat-reply" placeholder="Escribí un mensaje…" maxLength={4096} rows={2} value={text} onChange={(event) => setText(event.target.value)} /><button className="button-primary" disabled={busy || uncertain || !text.trim() || data.conversation.assigned_user_id !== data.current_user_id}>{busy ? 'Enviando…' : 'Enviar mensaje'}</button></div></form> : <p className="chat-empty">Este canal de ejemplo no permite enviar mensajes.</p>}
    </>}
  </section>;
}
