# Modelo de datos inicial (WIP)

Este esquema cubre el flujo mínimo de una bandeja de WhatsApp con varios números conectados. Está pensado como punto de partida: no modela todavía campañas, automatizaciones, adjuntos almacenados ni historial de asignaciones.

## Relaciones

```text
users ──< channel_accounts
users ──< conversations (asignado)
channel_accounts ──< contact_identities >── contacts
channel_accounts ──< conversations >── contacts
conversations ──< messages
```

`contact_identities` permite que una misma persona tenga una identidad externa por cada número conectado. Por ejemplo, Ana puede aparecer en Ventas Norte y Soporte Sur sin crear dos contactos internos.

## Pertenencia y deduplicación

- Una `channel_account` representa un número de WhatsApp conectado. Su número normalizado es único y su identificador externo, si existe, también lo es dentro del proveedor.
- Cada `conversation` pertenece a una cuenta conectada, a un contacto y a su `external_id`. La pareja `(channel_account_id, external_id)` es única.
- Cada `message` conserva su `channel_account_id` y su `provider_message_id`, únicos en conjunto. Una clave foránea compuesta obliga a que el mensaje y la conversación pertenezcan a la misma cuenta de origen.
- Las identidades de contacto usan la pareja `(channel_account_id, external_id)` para evitar duplicados al importar chats.

## Estados iniciales

| Entidad | Estados |
| --- | --- |
| Usuario | `active`, `disabled` |
| Cuenta conectada | `awaiting_qr`, `connected`, `disconnected`, `revoked` |
| Contacto | `active`, `blocked` |
| Conversación | `open`, `pending`, `resolved`, `spam` |
| Mensaje | dirección `incoming` / `outgoing`; tipo `text`, `image`, `document`, `audio`, `video`, `sticker`, `location`, `contact` o `system` |

## Operación local

Las migraciones están en `apps/api/db/migrations/` y se registran en la tabla `schema_migrations`; no se reaplican si ya fueron ejecutadas. Los datos ficticios son repetibles y usan identificadores deterministas.

```powershell
npm run db:up
npm run db:migrate
npm run db:seed
npm run db:check
```

`db:check` aplica migraciones y datos ficticios antes de ejecutar la prueba de integración. No usar los datos ni las credenciales de desarrollo en producción.
