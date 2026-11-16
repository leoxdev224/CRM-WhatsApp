import type { WAMessage } from '@whiskeysockets/baileys';

export type NormalizedMessage = {
  externalId: string; chatId: string; kind: 'individual' | 'group'; senderId: string | null;
  direction: 'incoming' | 'outgoing'; messageType: 'text' | 'image' | 'document' | 'audio' | 'video' | 'sticker' | 'location' | 'contact';
  body: string | null; occurredAt: string; displayName: string | null;
};

export function normalizeMessage(message: WAMessage): NormalizedMessage | null {
  const { id, remoteJid, fromMe, participant } = message.key;
  if (!id || !remoteJid || typeof fromMe !== 'boolean') return null;
  const group = remoteJid.endsWith('@g.us');
  if (!group && !remoteJid.endsWith('@s.whatsapp.net') && !remoteJid.endsWith('@lid')) return null;
  if (group && !fromMe && !participant) return null;
  const content = message.message;
  if (!content) return null;
  let messageType: NormalizedMessage['messageType']; let body: string | null = null;
  if (typeof content.conversation === 'string') { messageType = 'text'; body = content.conversation; }
  else if (content.extendedTextMessage?.text) { messageType = 'text'; body = content.extendedTextMessage.text; }
  else if (content.imageMessage) { messageType = 'image'; body = content.imageMessage.caption ?? null; }
  else if (content.videoMessage) { messageType = 'video'; body = content.videoMessage.caption ?? null; }
  else if (content.documentMessage) { messageType = 'document'; body = content.documentMessage.caption ?? null; }
  // shortcut: multimedia y ubicaciones no guardan archivos ni datos completos; ampliar al implementar adjuntos.
  else if (content.audioMessage) messageType = 'audio';
  else if (content.stickerMessage) messageType = 'sticker';
  else if (content.locationMessage) messageType = 'location';
  else if (content.contactMessage) messageType = 'contact';
  else return null;
  const timestamp = Number(message.messageTimestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > 253402300799) return null;
  return { externalId: id, chatId: remoteJid, kind: group ? 'group' : 'individual', senderId: group ? participant ?? null : remoteJid,
    direction: fromMe ? 'outgoing' : 'incoming', messageType, body, occurredAt: new Date(timestamp * 1000).toISOString(), displayName: fromMe ? null : message.pushName ?? null };
}
