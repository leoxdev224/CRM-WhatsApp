import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from '../src/App.js';

test('la pantalla inicial permite comprobar la API a través del proxy', () => {
  const html = renderToStaticMarkup(<App />);
  assert.match(html, /href="\/api\/ready"/);
  assert.match(html, /<h1>CRM WhatsApp<\/h1>/);
});
