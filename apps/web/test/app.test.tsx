import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { App, ChannelList } from '../src/App.js';
import { ConversationList } from '../src/Inbox.js';

test('la pantalla inicial muestra el formulario de acceso', () => {
  const html = renderToStaticMarkup(<App />);
  assert.match(html, /Correo electrónico/);
  assert.match(html, /Contraseña/);
  assert.match(html, /<h1>CRM WhatsApp<\/h1>/);
});

test('la bandeja muestra datos de una conversación y su último mensaje', () => {
  const html = renderToStaticMarkup(<ConversationList conversations={[{
    id: '1', kind: 'individual', contact_name: 'Lucía', contact_phone: '+5491100011111', channel_name: 'Ventas', channel_phone: '+5491100022222',
    status: 'open', operator_name: 'María', last_message: 'Hola', last_message_type: 'text', last_message_direction: 'incoming', last_message_at: '2026-01-01T12:00:00Z',
  }]} />);
  for (const text of ['Lucía', 'Ventas', 'Hola', 'Abierta', 'María']) assert.match(html, new RegExp(text));
  assert.match(renderToStaticMarkup(<ConversationList conversations={[]} />), /No hay conversaciones/);
});

test('canales muestran identidad, estado registrado y origen del estado', () => {
  const html = renderToStaticMarkup(<ChannelList channels={[{ id: '1', phone_number: '+5491100000001', display_name: 'Ventas', connection_status: 'connected' }]} />);
  assert.match(html, /Ventas/);
  assert.match(html, /\+5491100000001/);
  assert.match(html, /Conectado/);
  assert.match(html, /las conexiones de WhatsApp Web muestran el estado del servidor/);
  assert.match(renderToStaticMarkup(<ChannelList channels={[]} />), /No hay canales registrados/);
});
