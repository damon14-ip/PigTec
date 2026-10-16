# Sprint 1 — S4: Autenticación JWT con Supabase Auth

> **Origen de evidencia:** reportes de ejecución de OpenCode compartidos en la conversación. Los resultados no se han vuelto a ejecutar independientemente en este entorno. Los commits y el estado remoto son los declarados por los registros de Git de OpenCode.

## Objetivo
Verificar tokens Bearer y ofrecer `GET /auth/me`, sin implementar todavía roles ni permisos.

## Archivos
- `backend/src/modules/auth/token-verifier.ts`: interfaces, `createSupabaseTokenVerifier`, verificador de rechazo por defecto.
- `backend/src/modules/auth/authenticate.ts`: extracción Bearer y preHandler de Fastify.
- `backend/src/modules/auth/auth.routes.ts`: `GET /auth/me`.
- `backend/tests/auth.test.ts`: pruebas.
- Modificados `backend/src/app.ts` y `backend/src/server.ts`.

## Diseño
- Verificación real prevista mediante `supabase.auth.getUser(jwt)` usando cliente anónimo dedicado, no cliente con `accessToken`.
- Verificador inyectable; pruebas con mocks sin red.
- `buildApp()` sin verificador real rechaza autenticación (fail-closed).
- Respuesta autenticada mínima `{id,email?}`; nunca confía en `x-role` o body.
- Token ausente, inválido o expirado → HTTP 401 genérico.
- `GET /health` público.
- No se verificó un JWT real contra el proyecto Supabase; las pruebas son simuladas.

## Errores encontrados y solución
1. En una ejecución de PowerShell se intentó usar `&&` como separador y produjo error de sintaxis. Se repitió con `;`.
2. Primera comprobación HTTP obtuvo 404 en `/auth/me` porque compilación y arranque se ejecutaron en paralelo y el servidor tomó un `dist` anterior. Se repitió de forma secuencial: `/auth/me` sin token devolvió 401.
3. El parser inicial Bearer admitía espacios internos. Se endureció con regex anclada y rechazo de caracteres de control; se añadieron tests.
4. Se añadió rechazo de identidad de Supabase con `id` vacío, no textual, con espacios internos o caracteres de control, con error genérico saneado.

## Validación final
`npm run typecheck` OK; `npm run build` OK; **52/52 pruebas** en 4 archivos; Fastify inject `GET /health` → 200 y `GET /auth/me` sin token → 401.

## Git
`8fe606155bebd6483562cd4c9571e6664baa9fd2` — `feat(backend): add Supabase JWT authentication`, subido a `origin/master`. Árbol reportado limpio y sincronizado.

## Pendientes
S5: cargar rol y estado activo desde `profiles` de forma segura, RBAC y RLS. No se debe tratar la mera autenticación como permiso operativo.
