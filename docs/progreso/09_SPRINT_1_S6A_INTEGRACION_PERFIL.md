# Sprint 1 — S6-A: Integración del endpoint de perfil autenticado

**Estado:** implementación completada y publicada según el informe de OpenCode. **No equivale a validación contra Supabase de producción.**

## Objetivo y alcance
Conectar el repositorio de perfiles de S5 con el arranque real del backend y exponer `GET /auth/profile`. S6-A es **solo código**: no crea políticas RLS, no aplica migraciones y no conecta rutas operativas (áreas, corrales, animales, solicitudes). La preparación de Supabase de desarrollo, el aprovisionamiento de perfiles y el diseño de RLS quedan para **S6-B**.

## Arquitectura

- **Inyección de dependencias:** `buildApp({ tokenVerifier, profileRepository })`. Ambos son opcionales y, si se omiten, se sustituyen por implementaciones que **rechazan** (fail-closed).
- **Repositorio real en `server.ts`:** un cliente Supabase **nuevo por solicitud** con el JWT verificado de esa petición:
  `createSupabaseProfileRepository((accessToken) => createSupabaseClient(env, { accessToken }))`.
- **Seguridad JWT/RLS:** solo `anon key` (header `apikey`) + JWT del usuario (`Authorization: Bearer <jwt>`). **Nunca `service_role`**. La consulta a `profiles` se ejecuta con la identidad del usuario, de modo que PostgreSQL aplica `profile_select_own` (`id = auth.uid()`): solo el perfil propio.
- **Sin estado compartido:** el repositorio no guarda JWT; el token vive en el contexto de la petición (`request.authToken`) y se descarta al terminarla.

## Archivos modificados (5)

| Archivo | Cambio |
|---|---|
| `backend/src/app.ts` | `BuildAppOptions.profileRepository`; registro de `authRoutes` con verificador y repositorio; repositorio por defecto fail-closed. |
| `backend/src/modules/auth/auth.routes.ts` | Nueva ruta `GET /auth/profile` protegida con `createAuthenticate` + `createRequireRole`. |
| `backend/src/modules/auth/profile-repository.ts` | Nuevo `createRejectingProfileRepository()` (fail-closed, responde 503). |
| `backend/src/server.ts` | Crea el `ProfileRepository` real con `createSupabaseClient(env, { accessToken })` y lo inyecta. |
| `backend/tests/auth.profile.test.ts` | 15 pruebas de la ruta (nuevo). |

## Ruta `GET /auth/profile`

- **PreHandler:** `[createAuthenticate(verificador), createRequireRole({ repository, allowedRoles: OPERATIONAL_ROLES })]`.
- **Solo roles operativos** (`admin`, `manager`, `operator`, `veterinarian`); `viewer` y roles desconocidos quedan excluidos.
- **Perfil activo obligatorio** (`is_active === true`).
- **Respuesta (solo campos seguros):** `{ id, role, is_active }`. No incluye JWT, credenciales ni datos internos.

| Situación | HTTP | Cuerpo |
|---|---:|---|
| Perfil activo con rol operativo | 200 | `{ id, role, is_active }` |
| Sin autenticación válida | 401 | `{ error: "unauthorized" }` |
| Sin perfil, inactivo, `viewer`, rol inválido o no autorizado | 403 | `{ error: "forbidden" }` |
| Fallo al comprobar el perfil (infraestructura) | 503 | `{ error: "service_unavailable" }` |

## Comportamiento fail-closed

- `buildApp()` sin verificador → verificador que rechaza; sin repositorio → repositorio que lanza `ProfileLookupError` → **503**, nunca concede.
- Ante cualquier incertidumbre (perfil ausente, inactivo, rol desconocido, error de consulta) **no se autoriza**.
- El rol **nunca** se acepta desde cuerpo, encabezados (`x-role`) o parámetros: se lee de `profiles`.

## Evidencia reportada

- `npm run typecheck`: correcto.
- `npm run build`: correcto.
- `npm test`: **99/99 pruebas aprobadas** en **siete archivos** (26 auth, 15 auth.profile, 22 authorize, 16 env, 10 profile-repository, 8 supabase.client, 2 health). Las 4 variantes de rol de `auth.profile` se generan en bucle.
- Fastify `inject`: `/health` → 200; `/auth/me` sin token → 401; `/auth/profile` sin token → 401; con repositorio por defecto → 503 (fail-closed); con perfil activo → 200 `{ "id":"u-admin","role":"admin","is_active":true }`.
- Pruebas con mocks; **sin conexión real a Supabase**.

## Problemas técnicos y soluciones

| ID | Problema | Resolución | Estado |
|---|---|---|---|
| INC-017 | `SupabaseClient` (genéricos profundos de supabase-js) no es asignable a la interfaz estrecha del repositorio al cablear producción | Adaptador de tipos: un único cast documentado en `server.ts` (`createSupabaseClient(env, { accessToken }) as unknown as SupabaseProfileClient`); en runtime la cadena `from().select().eq().maybeSingle()` es idéntica | Resuelto |
| INC-018 | Riesgo de autorizar si `buildApp` se usa sin repositorio real | `createRejectingProfileRepository()` por defecto: lanza `ProfileLookupError` → HTTP 503, sin conceder acceso | Resuelto |

Sin otros errores bloqueantes: `typecheck`, `build` y pruebas pasaron en el primer intento tras los cambios.

## Versionado

Commit: `31483638fdf0d776d2e40468833bb2c1610ad1dd` — `feat(backend): integrate authenticated profile endpoint`. Push `2898e5a..3148363 master -> master`. Cinco archivos, 354 inserciones, 6 eliminaciones. Árbol limpio y sincronizado según OpenCode.

## Pendientes y límites (S6-B)

1. **Aprovisionamiento de perfiles:** no existe trigger en `auth.users` ni flujo administrado. Sin fila en `profiles`, o con `role` por defecto `viewer`, `GET /auth/profile` responde 403.
2. **Preparar Supabase de desarrollo** (proyecto separado) y **verificar** `profiles` y `profile_select_own` reales.
3. **Diseñar RLS** de tablas operativas (hoy sin políticas) y resolver la vista `v_animals_current` y los triggers `apply_*`.
4. `GET /auth/profile` devuelve `is_active` en snake_case; confirmar convención de API.
5. El cast de `server.ts` es el único punto de conversión de tipos; vigilarlo al actualizar supabase-js.

**Fuente:** informe de OpenCode compartido por el usuario; cifras y commits no reejecutados/verificados de forma independiente en este entorno.
