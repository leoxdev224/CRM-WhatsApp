# Aislamiento multiempresa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aislar los datos operativos por organización, creando CityWin como organización inicial sin cambiar el flujo local existente.

**Architecture:** PostgreSQL pasa a tener una frontera explícita mediante `organizations`. Las tablas con datos de negocio incorporan `organization_id`, y las relaciones de identidad, conversación y mensaje se refuerzan con claves únicas y foráneas compuestas para impedir referencias entre organizaciones.

**Tech Stack:** PostgreSQL 18, SQL, Node.js 26, TypeScript, `pg`, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-10-multiempresa-design.md`

## Global Constraints

- Usar PostgreSQL y migraciones SQL existentes; no incorporar un ORM ni dependencias nuevas.
- Crear `CityWin` como la organización inicial y hacer obligatoria la pertenencia de los datos operativos.
- Mantener los identificadores externos de WhatsApp únicos dentro de su organización y cuenta conectada.
- La base debe rechazar relaciones válidas individualmente que crucen organizaciones.
- No implementar administración, altas de empresas, facturación ni conexión real de WhatsApp.

## Review Focus

- Migrar una base que ya aplicó `001` y `002`: la nueva migración debe preservar sus registros y ser registrable por `schema_migrations`.
- Dos organizaciones con el mismo teléfono externo: la deduplicación debe seguir respetando la cuenta y organización correctas.
- Asignar una conversación al usuario de otra organización: PostgreSQL debe rechazarlo.
- Crear una identidad de contacto mezclando organizaciones: PostgreSQL debe rechazarlo.
- Insertar un mensaje con conversación o cuenta de otra organización: PostgreSQL debe rechazarlo.

---

## Estructura de archivos

- Crear `apps/api/db/migrations/003_add_organizations.sql`: crea organizaciones, migra los registros actuales a CityWin y refuerza claves/índices.
- Modificar `apps/api/db/seeds/001_development.sql`: siembra CityWin y asocia cada registro de desarrollo.
- Modificar `apps/api/test/database.test.ts`: verifica el flujo CityWin y los rechazos de cruces entre organizaciones.
- Modificar `docs/data-model.md`: documenta la nueva frontera de organización.

### Task 1: Migración de organizaciones y frontera de datos

**Files:**
- Create: `apps/api/db/migrations/003_add_organizations.sql`
- Test: `apps/api/test/database.test.ts`

**Interfaces:**
- Consumes: tablas y datos de `001_initial_crm.sql` y `002_fix_phone_number_validation.sql`.
- Produces: tabla `organizations`; columnas `organization_id` no nulas en `users`, `channel_accounts`, `contacts` y `conversations`; claves compuestas para las relaciones aisladas.

- [ ] **Step 1: Escribir la prueba de migración y aislamiento**

Extender la prueba de integración para consultar que la conversación de semilla pertenece a `CityWin` y preparar una segunda organización de prueba con IDs explícitos.

- [ ] **Step 2: Ejecutar la prueba para comprobar que falla**

Run: `npm run db:check`

Expected: FAIL porque `organizations` y `organization_id` todavía no existen en la base migrada.

- [ ] **Step 3: Crear `003_add_organizations.sql`**

Crear `organizations(id UUID PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, status TEXT CHECK (status IN ('active', 'disabled')), created_at, updated_at)`. Insertar `CityWin` con un UUID determinista y slug `citywin`; añadir `organization_id` nullable temporalmente, completar con CityWin y luego cambiar a `NOT NULL`.

Reemplazar las restricciones necesarias por claves compuestas que incluyan `organization_id`: usuario asignado de conversación, cuenta/contacto de conversación, identidad de contacto y pareja conversación/cuenta de mensaje. Mantener la deduplicación de identificadores externos con la cuenta y organización correspondiente.

- [ ] **Step 4: Ejecutar la prueba para comprobar que pasa**

Run: `npm run db:check`

Expected: PASS y la semilla de conversación se asocia a `CityWin`.

- [ ] **Step 5: Preparar el commit para revisión del usuario**

Proponer: `feat(db): aislar datos por organización`

### Task 2: Semillas repetibles y rechazo de cruces

**Files:**
- Modify: `apps/api/db/seeds/001_development.sql`
- Modify: `apps/api/test/database.test.ts`

**Interfaces:**
- Consumes: `organizations` y las claves compuestas de Task 1.
- Produces: semillas de CityWin idempotentes y cobertura de restricciones multiempresa.

- [ ] **Step 1: Escribir los casos que cruzan organizaciones**

Agregar a `database.test.ts` tres `assert.rejects`: asignar una conversación de CityWin a un usuario de la segunda organización, insertar una identidad con contacto/cuenta de organizaciones distintas e insertar un mensaje con una conversación/cuenta de organizaciones distintas.

- [ ] **Step 2: Ejecutar la prueba para comprobar que falla**

Run: `npm run db:check`

Expected: FAIL porque alguna combinación entre organizaciones todavía es aceptada o las semillas no incluyen `organization_id`.

- [ ] **Step 3: Actualizar la semilla de desarrollo**

Insertar/actualizar primero la organización `CityWin`; incluir su `organization_id` explícito en usuarios, cuentas, contactos y conversaciones. Ajustar los `ON CONFLICT` para conservar la repetibilidad.

- [ ] **Step 4: Completar las restricciones mínimas de la migración**

Si un caso de Step 1 no es rechazado, ajustar exclusivamente la clave única o foránea compuesta de `003_add_organizations.sql` que lo permite; no añadir validación de aplicación para sustituir una restricción de base de datos.

- [ ] **Step 5: Ejecutar las verificaciones**

Run: `npm run check && npm run db:check`

Expected: PASS; migraciones y semillas repetibles, tipos, pruebas y compilación correctos.

- [ ] **Step 6: Preparar el commit para revisión del usuario**

Proponer: `test(db): cubrir aislamiento entre organizaciones`

### Task 3: Documentar la nueva frontera

**Files:**
- Modify: `docs/data-model.md`
- Test: `apps/api/test/database.test.ts`

**Interfaces:**
- Consumes: esquema final de Tasks 1 y 2.
- Produces: documentación exacta de CityWin, relaciones y límites actuales.

- [ ] **Step 1: Actualizar el diagrama y las reglas de pertenencia**

Anteponer `organizations` al diagrama y explicar que cada consulta futura de la API debe filtrarse por la organización de la sesión. Expresar que el aislamiento se comprueba con claves foráneas compuestas, no solo mediante convención de código.

- [ ] **Step 2: Verificar la documentación contra la prueba de integración**

Run: `npm run db:check`

Expected: PASS; el ejemplo CityWin y los límites descritos coinciden con la semilla y las restricciones comprobadas.

- [ ] **Step 3: Preparar el commit para revisión del usuario**

Proponer: `docs(db): documentar aislamiento multiempresa`

## Autorrevisión

- Cobertura del spec: CityWin, pertenencia obligatoria, claves compuestas, semillas y una prueba de cruces están cubiertos por Tasks 1 y 2; documentación por Task 3.
- Tipos e interfaces: no se agregan interfaces TypeScript públicas; el contrato es el esquema SQL y la prueba de integración.
- Review Focus: cada condición tiene un caso de integración en Task 1 o 2.
- Proporción: el plan define cambios y pruebas, sin preescribir el SQL completo.
