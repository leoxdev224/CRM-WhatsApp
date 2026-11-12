import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from '../src/App.js';

test('la pantalla inicial muestra el formulario de acceso', () => {
  const html = renderToStaticMarkup(<App />);
  assert.match(html, /Correo electrónico/);
  assert.match(html, /Contraseña/);
  assert.match(html, /<h1>CRM WhatsApp<\/h1>/);
});
