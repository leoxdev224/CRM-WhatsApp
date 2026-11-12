# Diseño: aislamiento multiempresa inicial

## Intención

El CRM empieza con CityWin, pero debe poder alojar otras empresas sin que usuarios, números, contactos, conversaciones o mensajes se mezclen. El flujo actual de una sola empresa debe seguir funcionando.

## Objetivos

- Crear una organización inicial llamada `CityWin`.
- Hacer obligatoria la pertenencia de los datos operativos a una organización.
- Impedir con claves foráneas compuestas que una conversación, un mensaje, una identidad de contacto o una asignación crucen organizaciones.
- Mantener los identificadores externos de WhatsApp únicos dentro de cada organización y cuenta conectada.

## Fuera de alcance

- Invitaciones, alta de nuevas empresas y pantalla de administración.
- Facturación, planes y límites por empresa.
- Cambiar el proveedor o el flujo de conexión de WhatsApp.

## Enfoques considerados

1. Mantener una sola empresa y migrar más adelante. Es menor trabajo ahora, pero una migración posterior sobre conversaciones reales sería más riesgosa.
2. Multiempresa obligatorio desde ahora. Añade una tabla e índices, pero fija la frontera de seguridad antes de recibir datos reales. **Elegido.**
3. Organización opcional. Permite registros sin dueño y complica permisos, por lo que se descarta.

## Diseño elegido

Se añadirá `organizations` con `id`, `name`, `slug`, estado y marcas de tiempo. La migración creará CityWin y asociará a ella los datos existentes de desarrollo.

Las tablas `users`, `channel_accounts`, `contacts` y `conversations` recibirán `organization_id NOT NULL`. `contact_identities` heredará la organización a través de sus referencias compuestas. `messages` continuará vinculada a la conversación y a la cuenta mediante una clave foránea compuesta que incluye también la organización.

Las relaciones de asignación, identidad, conversación y mensaje usarán claves únicas/foráneas compuestas con `organization_id`. Así, la base rechaza una combinación de IDs válida individualmente pero perteneciente a empresas diferentes.

Las semillas pasarán a crear CityWin y todos sus datos ficticios quedarán dentro de esa organización. La prueba de integración comprobará tanto el flujo válido como al menos un intento rechazado de cruce entre organizaciones.

## Consecuencias

La API actual no expone todavía organizaciones ni autenticación; por ahora solo ganamos aislamiento de datos a nivel de PostgreSQL. El futuro ticket de permisos deberá decidir cómo se selecciona la organización de la sesión y limitar todas las consultas a ella.
