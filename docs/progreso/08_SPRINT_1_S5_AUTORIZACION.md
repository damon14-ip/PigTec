# Sprint 1 — S5: Autorización por roles y estado activo

**Estado:** implementación completada y publicada según el informe de OpenCode del 16-10-2026. **No equivale a validación contra Supabase de producción.**

## Objetivo y alcance
Incorporar autorización reutilizable después de la autenticación JWT de S4. Consultar el perfil propio (`profiles`) con el JWT verificado y respetando RLS. Diferenciar ausencia de autenticación (401), denegación de permisos (403) e indisponibilidad de consulta (503). Sin frontend, migraciones, cambios RLS ni rutas operativas nuevas.

## Implementación
- `backend/src/modules/auth/roles.ts` (nuevo): roles `admin`, `manager`, `operator`, `veterinarian` y `viewer` heredado; `OperationalRole` excluye `viewer`.
- `backend/src/modules/auth/profile-repository.ts` (nuevo): interfaz `ProfileRepository`, lectura de `id, role, is_active` filtrada por `id`, cliente Supabase nuevo con JWT de cada solicitud, comprobaciones de integridad y `ProfileLookupError` genérico para errores de consulta.
- `backend/src/modules/auth/authorize.ts` (nuevo): `createRequireRole` comprueba identidad verificada, perfil, estado activo y rol permitido. Deniega por defecto y almacena perfil autorizado en el contexto de la petición.
- `backend/src/modules/auth/authenticate.ts` (modificado): conserva `request.authToken` únicamente después de verificar el JWT.
- `backend/tests/authorize.test.ts` (nuevo): pruebas con Fastify `inject` para roles, usuarios inactivos, perfiles ausentes, tokens, falsificación de rol, concurrencia y errores.
- `backend/tests/profile-repository.test.ts` (nuevo): consultas, mapeo, validación, error controlado y encabezado Authorization con `fetch` simulado.

## Respuestas de seguridad
| Situación | HTTP | Respuesta genérica |
|---|---:|---|
| Sin autenticación válida | 401 | `unauthorized` |
| Sin perfil, inactivo, `viewer`, rol inválido o no permitido | 403 | `forbidden` |
| Error de consulta/infraestructura al verificar perfil | 503 | `service_unavailable` |

No se confía en roles enviados por el cliente. La consulta usa clave pública/anon y el JWT individual; no se emplea `service_role`. La política `profile_select_own` del esquema inicial permite consultar el perfil propio; esto no sustituye la futura revisión integral de RLS.

## Evidencia reportada
- `npm run typecheck`: correcto.
- `npm run build`: correcto.
- `npm test`: **84/84 pruebas aprobadas** en seis archivos (26 auth, 22 authorize, 16 env, 10 profile-repository, 8 supabase.client, 2 health).
- Fastify `inject`: `/health` → 200; `/auth/me` sin token → 401; con token inválido → 401.
- Pruebas con mocks; **sin conexión real a Supabase**.

## Incidencias y soluciones
| ID | Problema | Resolución | Estado |
|---|---|---|---|
| INC-011 | TS2554: firma de preHandler exigía tres argumentos | Sustituir invocaciones manuales por pruebas Fastify `inject` | Resuelto |
| INC-012 | TS2684: contexto `this` de Fastify | Eliminación del helper manual al migrar a `inject` | Resuelto |
| INC-013 | TS2352: conversión de `void` a `Promise<void>` | Eliminación del helper manual de hooks | Resuelto |
| INC-014 | TS2589/TS2322: tipos genéricos y thenables de supabase-js incompatibles con interfaz estrecha | `PromiseLike` y cast documentado **en prueba** de contexto RLS; requiere vigilancia de mantenimiento | Resuelto en pruebas |
| INC-015 | Error de infraestructura tratado igual que perfil ausente (403) | `ProfileLookupError` + respuesta 503 genérica; `null` sigue significando ausencia de perfil (403) | Resuelto |
| INC-016 | Tipo `Awaited<ReturnType<…>>` innecesariamente complejo | Sustituido por `{ data: SupabaseProfileRow \| null; error: unknown }` | Resuelto |

## Versionado
Commit reportado: `e741ebba58979da496c6f1110335ffcae6e64345` — `feat(backend): add role-based authorization`. Push `2daddf6..e741ebb master -> master`. Git limpio y sincronizado según OpenCode.

## Pendientes y límites
1. El mecanismo RBAC **aún no está conectado a rutas operativas de producción**; integrar cuando se definan los endpoints (S6).
2. No se ha comprobado la consulta real a `profiles` ni las políticas RLS en el proyecto Supabase.
3. No se han implementado solicitudes de registro, aprobaciones, autoaprobación prohibida ni operaciones sobre animales.
4. Mantener revisión de privilegios a nivel PostgreSQL y políticas RLS antes de habilitar operaciones reales.

**Fuente:** informe de OpenCode compartido por el usuario; cifras y commits no reejecutados/verificados de forma independiente en este entorno.
