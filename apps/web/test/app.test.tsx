import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { App, ChannelList } from '../src/App.js';

test('la pantalla inicial muestra el formulario de acceso', () => {
  const html = renderToStaticMarkup(<App />);
  assert.match(html, /Correo electrónico/);
  assert.match(html, /Contraseña/);
  assert.match(html, /<h1>CRM WhatsApp<\/h1>/);
});

test('canales muestran identidad, estado registrado y origen del estado', () => {
  const html = renderToStaticMarkup(<ChannelList channels={[{ id: '1', phone_number: '+5491100000001', display_name: 'Ventas', connection_status: 'connected' }]} />);
  assert.match(html, /Ventas/);
  assert.match(html, /\+5491100000001/);
  assert.match(html, /Conectado/);
  assert.match(html, /las conexiones de WhatsApp Web muestran el estado del servidor/);
  assert.match(renderToStaticMarkup(<ChannelList channels={[]} />), /No hay canales registrados/);
});
