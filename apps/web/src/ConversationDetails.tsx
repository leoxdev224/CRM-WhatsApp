import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

type Conversation = { status: string; assigned_user_id: string | null; contact_name: string; contact_phone: string | null; external_id: string; kind: string };
type Note = { id: string; body: string; author: string; created_at: string };
type Activity = { id: string; field: string; old_value: string | null; new_value: string | null; old_name: string | null; new_name: string | null; actor: string; created_at: string };
const statuses: Record<string, string> = { open: 'Abierta', pending: 'En espera', resolved: 'Resuelta', spam: 'Spam' };

export function ConversationDetails({ token, id, conversation, currentUserId, refresh }: { token: string; id: string; conversation: Conversation; currentUserId: string; refresh: () => void }) {
  const [operators, setOperators] = useState<{ id: string; display_name: string }[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const path = `/api/conversations/${id}`;
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const responses = await Promise.all(['/api/inbox/options', `${path}/notes`, `${path}/activity`].map((url) => fetch(url, { headers, signal: controller.signal })));
        if (responses.some((response) => !response.ok)) throw new Error();
        const [options, notesData, activityData] = await Promise.all(responses.map((response) => response.json()));
        if (!controller.signal.aborted) { setOperators(options.operators); setNotes(notesData.notes); setActivity(activityData.activity); setError(''); }
      } catch { if (!controller.signal.aborted) setError('No se pudo cargar la ficha. Revisá la conexión.'); }
    }
    void load(); const timer = window.setInterval(() => void load(), 5000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [token, path, revision]);
  async function update(payload: object) {
    setBusy(true); setError('');
    try {
      const response = await fetch(path, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error();
      refresh(); setRevision((value) => value + 1);
    } catch { setError('No se pudo guardar el cambio. Intentá nuevamente.'); } finally { setBusy(false); }
  }
  async function addNote(event: FormEvent) {
    event.preventDefault(); if (!note.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`${path}/notes`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ body: note }) });
      if (!response.ok) throw new Error();
      setNote(''); setRevision((value) => value + 1);
    } catch { setError('No se pudo guardar la nota. Intentá nuevamente.'); } finally { setBusy(false); }
  }
  return <aside className="conversation-details" aria-label="Ficha y gestión de la conversación">
    <h3>{conversation.kind === 'group' ? 'Datos del grupo' : 'Ficha del contacto'}</h3>
    <p><strong>{conversation.contact_name}</strong><br />{conversation.contact_phone ?? conversation.external_id}</p>
    <div className="details-controls">
      <label>Responsable<select value={conversation.assigned_user_id ?? ''} disabled={busy} onChange={(event) => void update({ assignedUserId: event.target.value || null })}><option value="">Sin asignar</option>{operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.display_name}</option>)}</select></label>
      <label>Estado<select value={conversation.status} disabled={busy} onChange={(event) => void update({ status: event.target.value })}>{conversation.status === 'spam' && <option value="spam">Spam</option>}<option value="open">Abierta</option><option value="pending">En espera</option><option value="resolved">Resuelta</option></select></label>
    </div>
    {conversation.assigned_user_id !== currentUserId && <p className="details-hint">Para responder, asignate esta conversación.</p>}
    {error && <p role="alert" className="chat-alert">{error}</p>}
    <details><summary>Notas internas ({notes.length})</summary><p className="details-hint">Solo visibles en el CRM; no se envían por WhatsApp.</p>
      <form onSubmit={addNote} className="note-form"><label htmlFor="internal-note">Nueva nota</label><textarea id="internal-note" maxLength={4000} rows={2} value={note} onChange={(event) => setNote(event.target.value)} /><button type="submit" disabled={busy || !note.trim()}>Guardar nota</button></form>
      {notes.length === 0 ? <p className="details-hint">Todavía no hay notas.</p> : <ul className="detail-list">{notes.map((item) => <li key={item.id}><p>{item.body}</p><small>{item.author} · {new Date(item.created_at).toLocaleString('es-AR')}</small></li>)}</ul>}
    </details>
    <details><summary>Historial de gestión ({activity.length})</summary>{activity.length === 0 ? <p className="details-hint">Todavía no hay cambios registrados.</p> : <ul className="detail-list">{activity.map((item) => <li key={item.id}><p>{item.actor} cambió {item.field === 'status' ? `el estado: ${statuses[item.old_value ?? ''] ?? item.old_value} → ${statuses[item.new_value ?? ''] ?? item.new_value}` : `el responsable: ${item.old_name ?? 'Sin asignar'} → ${item.new_name ?? 'Sin asignar'}`}</p><small>{new Date(item.created_at).toLocaleString('es-AR')}</small></li>)}</ul>}</details>
  </aside>;
}
