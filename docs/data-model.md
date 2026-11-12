# Modelo de datos inicial (WIP)

Este esquema cubre el flujo mínimo de una bandeja de WhatsApp con varios números conectados y varias empresas. CityWin es la organización inicial. Está pensado como punto de partida: no modela todavía campañas, automatizaciones, adjuntos almacenados ni historial de asignaciones.

## Relaciones

```text
organizations ──< users
organizations ──< channel_accounts
organizations ──< contacts
organizations ──< conversations
users ──< channel_accounts
users ──< conversations (asignado)
channel_accounts ──< contact_identities >── contacts
channel_accounts ──< conversations >── contacts
conversations ──< messages
```

`contact_identities` permite que una misma persona tenga una identidad externa por cada número conectado. Por ejemplo, Ana puede aparecer en Ventas Norte y Soporte Sur sin crear dos contactos internos.

## Pertenencia y deduplicación

- Cada registro operativo pertenece obligatoriamente a una `organization`. Las futuras consultas de la API deben filtrar siempre por la organización de la sesión.
- Una `channel_account` representa un número de WhatsApp conectado. Su número normalizado y su identificador externo, si existe, son únicos dentro de una organización.
- Cada `conversation` pertenece a una organización, una cuenta conectada, un contacto y su `external_id`. La terna `(organization_id, channel_account_id, external_id)` es única.
- Cada `message` conserva su organización, `channel_account_id` y su `provider_message_id`, únicos en conjunto. Una clave foránea compuesta obliga a que el mensaje y la conversación pertenezcan a la misma cuenta y organización de origen.
- Las identidades de contacto usan la terna `(organization_id, channel_account_id, external_id)` para evitar duplicados al importar chats y las claves foráneas compuestas impiden mezclar contactos o cuentas de organizaciones distintas.

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
