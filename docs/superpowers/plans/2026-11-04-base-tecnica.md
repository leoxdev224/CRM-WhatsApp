# Base técnica — plan de implementación

**Objetivo:** cumplir el ticket 02 con PostgreSQL, Node.js y React, TypeScript en ambos lados y un entorno local reproducible.

**Alcance autorizado:** preparar archivos y verificar el entorno. No ejecutar git add, commit ni push. Repositorio inicialmente vacío; conservar la configuración del IDE.

**Decisiones de implementación:** npm workspaces con `apps/api` y `apps/web`; Fastify para HTTP, pg para PostgreSQL y Vite para React. Un `.env` local en la raíz, excluido de Git; `.env.example` con valores ficticios. PostgreSQL 18 en Docker Compose con volumen persistente y puerto limitado a localhost. Usar la instalación Node 26 disponible y fijar dependencias en package-lock.json.

## Pasos

1. Crear configuración de npm, TypeScript, Vite y Compose, junto con exclusión de secretos y archivos generados.
2. Escribir y ejecutar pruebas que fallen para `/api/health`, `/api/ready`, cierre de conexiones y acceso desde la pantalla inicial.
3. Implementar solo esas comprobaciones y un arranque local con manejo de errores y apagado ordenado.
4. Documentar instalación, variables, comandos, persistencia y límites del entorno.
5. Verificar `npm ci`, `npm run check`, `npm run db:up`, `npm run db:check`, arranque de desarrollo y ejecución de la API compilada. Revisar Git sin modificar su índice.

**Riesgos a comprobar:** PostgreSQL desconectado debe dar 503 sin secretos; puertos ocupados deben informar error; credenciales no deben llegar al frontend; apagar debe liberar el pool; bajar Compose debe conservar el volumen.

**Fuera de alcance:** entidades, migraciones de negocio, autenticación, WhatsApp, campañas, diseño del panel y despliegue productivo.
