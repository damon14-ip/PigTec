# Sprint 1 — S3: Fábrica de clientes Supabase

> **Origen de evidencia:** reportes de ejecución de OpenCode compartidos en la conversación. Los resultados no se han vuelto a ejecutar independientemente en este entorno. Los commits y el estado remoto son los declarados por los registros de Git de OpenCode.

## Objetivo
Preparar clientes Supabase por petición y por identidad, sin consultar servicios reales ni compartir tokens entre usuarios.

## Archivos
- Nuevo `backend/src/supabase/client.ts`: `createSupabaseClient(env, options?)`.
- Nuevo `backend/tests/supabase.client.test.ts`.
- Modificados `backend/package.json` y `backend/package-lock.json`.
- Dependencia `@supabase/supabase-js` 2.118.0 según reporte.

## Diseño
- `apikey` usa `SUPABASE_ANON_KEY`; no `service_role`.
- Con JWT, opción `accessToken` para `Authorization: Bearer <jwt>`.
- Sin JWT, el cliente usa rol anónimo. **No debe concederse acceso operativo a anon mediante RLS.**
- Instancia nueva por invocación, sin cliente compartido mutable.
- Token vacío rechazado para evitar degradación silenciosa a anon.
- Persistencia y renovación de sesión desactivadas en backend.
- Con `accessToken`, `client.auth` no se usa; la verificación de identidad se hace aparte en S4.

## Errores y soluciones
- Un script temporal de sondeo creado fuera de `backend/` no encontraba `@supabase/supabase-js` (`ERR_MODULE_NOT_FOUND`). Se ejecutó desde `backend/` y se eliminó.
- Error TypeScript `TS2552: Cannot find name 'RequestInfo'` en test; se reemplazó por `Parameters<typeof fetch>`.
- Tras ajustar la indentación y tipos, las comprobaciones pasaron.

## Pruebas
**26/26** pruebas, `typecheck` OK, `build` OK, `GET /health` → 200. Pruebas de encabezados, separación de clientes y concurrencia mediante `fetch` simulado, sin red real.

## Git
`b90f892476c3bcbc63876a392cf518877a3385cf` — `feat(backend): add isolated Supabase clients`, subido a `origin/master`.
