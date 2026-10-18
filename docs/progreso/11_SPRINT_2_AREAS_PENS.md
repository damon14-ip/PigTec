# Sprint 2 — API de áreas y corrales con RLS

**Estado:** backend implementado, probado localmente y con la migración 003
**aplicada** en PigTecBD (desarrollo). No se ha validado todavía de extremo a
extremo contra Supabase.

## Alcance

- Endpoints REST para **áreas** (`/areas`) y **corrales** (`/pens`): listar,
  consultar por ID, crear, actualizar y **baja lógica** (no hay borrado físico).
- RBAC: lectura para `admin`, `manager`, `operator` y `veterinarian` **activos**;
  escritura y baja lógica solo `admin` y `manager` **activos**. `viewer`, inactivos
  y anónimos quedan fuera.
- Se reutilizan `createAuthenticate` y `createRequireRole` (sin tocar auth). Los
  repositorios usan un cliente Supabase **por petición** con el JWT verificado
  (RLS); nunca `service_role`.

## Migraciones aplicadas en PigTecBD

| Migración | Estado |
|---|---|
| `001_initial_schema.sql` | Aplicada (estructura verificada, S6-B). |
| `002_profile_provisioning.sql` | Aplicada y validada funcionalmente (S6-D). |
| `003_areas_pens_rls.sql` | Aplicada; verificadas sus 6 políticas RLS (3 en `areas`, 3 en `pens`). |

La 003 otorga a `authenticated` `SELECT`/`INSERT`/`UPDATE` (sin `DELETE`);
`anon`/`PUBLIC` sin acceso. Las políticas leen el rol/estado del llamante en
`public.profiles` vía `auth.uid()` (sin recursión y sin escalamiento).

## Pruebas

`npm run typecheck`, `npm test` (134 pruebas en 9 archivos) y `npm run build`
correctos. Las pruebas usan `app.inject` y repositorios simulados: **sin conexión
a Supabase**.

## Limitaciones

- Falta la validación funcional real de `/areas` y `/pens` contra PigTecBD con un
  administrador autenticado (lectura y escritura).
- `DELETE` es baja lógica (`status='inactive'`); no hay reactivación ni borrado.
- No se permite mover un corral entre áreas (`area_id` no editable).
- Listas sin paginación.
