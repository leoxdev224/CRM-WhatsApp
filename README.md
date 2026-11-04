# CRM WhatsApp

Base técnica para una bandeja de atención que reunirá conversaciones de varios números de WhatsApp.

Este primer ticket prepara el entorno de desarrollo. Las entidades, migraciones de negocio, usuarios y conexión oficial de WhatsApp se implementarán en tickets posteriores.

## Requisitos

- Node.js **26.8.1** (ver `.nvmrc`) y npm **11 o superior**.
- Docker Desktop iniciado, con contenedores Linux y Docker Compose.
- Puertos locales disponibles: **5173** (React), **3002** (API) y **15432** (PostgreSQL).

## Primer arranque

Desde la raíz del repositorio:

```powershell
Copy-Item .env.example .env
npm ci
npm run db:up
npm run db:check
npm run dev
```

En macOS/Linux, reemplazar el primer comando por `cp .env.example .env`. Copiar el archivo solo la primera vez para conservar los ajustes locales.

- Frontend: [http://127.0.0.1:5173](http://127.0.0.1:5173).
- API activa: [http://127.0.0.1:3002/api/health](http://127.0.0.1:3002/api/health).
- API y conexión real con PostgreSQL: [http://127.0.0.1:3002/api/ready](http://127.0.0.1:3002/api/ready).

La pantalla inicial incluye un enlace a `/api/ready` a través del proxy de Vite. Un resultado `{"status":"ok","database":"connected"}` confirma el recorrido frontend → API → PostgreSQL. Si la base está desconectada, ese endpoint devuelve **503**; `/api/health` sigue informando si el proceso HTTP está activo.

`npm run dev` inicia ambas aplicaciones. `Ctrl+C` las detiene; PostgreSQL sigue en Docker. Para detener la base, usar `npm run db:down`.

## Comandos

| Comando | Resultado |
| --- | --- |
| `npm ci` | Instala las versiones fijadas en `package-lock.json`. |
| `npm run dev` | Inicia API y React con recarga al editar. |
| `npm run dev:api` / `npm run dev:web` | Inicia una sola aplicación. |
| `npm run typecheck` | Revisa los tipos de las dos aplicaciones, sus pruebas y configuración. |
| `npm test` | Ejecuta pruebas básicas de API y React sin requerir PostgreSQL. |
| `npm run build` | Compila API y frontend a sus directorios `dist/`. |
| `npm run check` | Ejecuta revisión de tipos, pruebas y compilación. |
| `npm run db:up` | Inicia PostgreSQL y espera a que esté saludable. |
| `npm run db:check` | Prueba la API con PostgreSQL real y la liberación del pool al apagar. |
| `npm run db:down` | Detiene los contenedores sin eliminar los datos. |

Antes de preparar un commit, ejecutar `npm run check` y, con Docker iniciado, `npm run db:check`.

## Integración continua

GitHub Actions ejecuta el mismo control en cada `push` y `pull request`: instala las dependencias con `npm ci`, ejecuta `npm run check` y comprueba la conexión de la API con una instancia temporal de PostgreSQL. La configuración está en `.github/workflows/ci.yml`; no usa el archivo `.env` ni credenciales locales.

Para comprobar la API compilada: `npm run start --workspace=@crm-whatsapp/api`. Para inspeccionar los archivos compilados de React: `npm run preview --workspace=@crm-whatsapp/web`. El preview solo sirve el frontend estático; el proxy `/api` está configurado para desarrollo. Un despliegue necesitará servir `/api` desde el mismo origen o configurar su proxy.

## Variables de entorno

Un único archivo `.env` en la raíz alimenta Docker Compose y la API. Vite lo lee para configurar su proxy en el servidor de desarrollo.

| Variable | Uso | Valor de ejemplo |
| --- | --- | --- |
| `PGHOST` | Host de PostgreSQL visto desde Node.js en el equipo local. | `127.0.0.1` |
| `PGPORT` | Puerto de PostgreSQL en el equipo local. | `15432` |
| `PGDATABASE` | Base creada al inicializar el volumen. | `crm_whatsapp` |
| `PGUSER` | Usuario creado al inicializar el volumen. | `crm_app` |
| `PGPASSWORD` | Contraseña exclusivamente local; valor ficticio en el ejemplo. | Ver `.env.example`. |
| `API_HOST` | Dirección donde escucha la API y a la que apunta el proxy. | `127.0.0.1` |
| `API_PORT` | Puerto de la API. | `3002` |

- `.env` está excluido de Git; versionar únicamente `.env.example` con valores ficticios.
- Las variables con prefijo `VITE_` se publican en el navegador: nunca poner contraseñas, tokens ni credenciales bajo ese prefijo.
- Reiniciar `npm run dev` al cambiar `.env`.
- Si el puerto de PostgreSQL está ocupado o reservado por Windows, cambiar `PGPORT` en `.env` y volver a ejecutar `npm run db:up`. Se usa 15432 para evitar conflictos con instalaciones locales en 5432.
- Cambiar usuario, base o contraseña en `.env` **no modifica un volumen ya inicializado**; requiere una migración administrativa de la base. No eliminar el volumen para resolverlo si contiene datos que se necesiten conservar.

## Organización

```text
apps/api/       API Fastify, conexión con pg y pruebas
apps/web/       React con Vite, TypeScript y prueba de renderizado
compose.yaml    PostgreSQL 18 con imagen fijada por digest y volumen persistente
.env.example    Plantilla local sin secretos reales
```

PostgreSQL conserva los datos en el volumen `crm-whatsapp_postgres_data`. `npm run db:down` lo conserva. No usar `docker compose down -v` salvo que se quiera **borrar deliberadamente** la base local.

La configuración escucha solo en el equipo local y usa credenciales ficticias de desarrollo. No es una configuración de producción. Mantener las actualizaciones del lockfile, Node.js y el digest de PostgreSQL como cambios explícitos y comprobados.
