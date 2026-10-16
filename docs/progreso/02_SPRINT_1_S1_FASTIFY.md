# Sprint 1 — S1: Backend Fastify inicial

> **Origen de evidencia:** reportes de ejecución de OpenCode compartidos en la conversación. Los resultados no se han vuelto a ejecutar independientemente en este entorno. Los commits y el estado remoto son los declarados por los registros de Git de OpenCode.

## Objetivo
Crear una base backend compilable, comprobable y sin conexión a Supabase.

## Implementación
- `backend/package.json` y `backend/package-lock.json`: dependencias y scripts `dev`, `build`, `start`, `test`, `test:watch`, `typecheck`.
- `backend/tsconfig.json`, `backend/tsconfig.build.json`, `backend/vitest.config.ts`.
- `backend/src/app.ts`: función `buildApp()`.
- `backend/src/server.ts`: arranque Fastify.
- `backend/src/modules/health/health.routes.ts`: `GET /health`.
- `backend/tests/health.test.ts`: pruebas mediante `app.inject()`.
- Entorno reportado: Node v22.17.0, npm 11.10.0.

## Pruebas
`npm run typecheck` OK; `npm run build` OK; `npm test` **2/2**; HTTP `GET /health` → **200** `{"status":"ok"}`.

## Errores y soluciones
No se informaron errores bloqueantes durante S1. La carpeta `backend/` estuvo inicialmente sin seguimiento Git; se incorporó después mediante commit.

## Git
`865a136` — `feat(backend): initial Fastify server and health tests`. Posteriormente se confirmó presente en `origin/master`.

## Límites
Sin frontend, Supabase, autenticación, migraciones ni credenciales reales.
