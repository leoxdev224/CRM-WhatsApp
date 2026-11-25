# Proxy por canal de WhatsApp

Cada canal de WhatsApp Web puede salir a internet por su propio proxy, para que cada número use una IP distinta a la del servidor.

## Uso

1. Desconectá el canal (no se puede cambiar el proxy con la sesión activa).
2. En **Administrar canales**, pegá la URL del proxy y tocá **Probar y guardar**:
   - `socks5://usuario:clave@host:puerto` (recomendado; el DNS también se resuelve en el proxy)
   - `http://usuario:clave@host:puerto`
3. El servidor prueba el proxy y muestra la IP de salida. Si no responde, no se guarda.
4. Conectá el canal como siempre.

## Cómo funciona

- Baileys recibe tres agentes por canal: `agent` (WebSocket), `fetchAgent` (subida de media) y `options.dispatcher` (fetch: media, app-state, historial). Así ningún camino sale por la IP del servidor.
- Antes de cada conexión se verifica la IP de salida. **Si el proxy no responde, el canal no se conecta** (no se usa la IP del servidor como respaldo) y se reintenta más tarde.
- Si la IP de salida cambia respecto de la última conocida, se registra `whatsapp_proxy_ip_changed` en el log.
- Cortes de red con el número ya vinculado se reintentan solos: 5 s, 30 s, 2 min y luego cada 10 min. No se reintenta ante cierre de sesión (401), sesión reemplazada (440) ni bloqueo (403).
- La URL completa se guarda cifrada (AES-256-GCM con `WHATSAPP_SESSION_KEY`, ligada al canal). La API y el panel solo muestran `protocolo://host:puerto`.
- Los cambios quedan en la auditoría como `channel.proxy.update`.

## Requisitos

- Node 26 (`.nvmrc`). El chequeo usa el `fetch` global de Node, el mismo que usa Baileys; con versiones anteriores el chequeo falla y el canal no conecta.
- Proxy con IP fija y dedicada (ISP estático), idealmente del mismo país que el número. Ver la investigación del ticket.

## Prueba controlada sugerida

Usar 2 números de prueba durante 2 semanas: vincular, enviar y recibir texto y media, cortar el proxy 10 minutos, cambiar su contraseña y reiniciar la API. Confirmar con el proveedor que todo el tráfico salió por la IP del proxy.
