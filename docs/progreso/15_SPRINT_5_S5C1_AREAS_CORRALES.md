# Sprint 5 — S5-C1: interfaz de gestión de áreas y corrales

**Estado:** implementado y verificado (typecheck, pruebas y build de frontend y
backend). **Sin commit ni push.** No se modificó la base de datos, las
migraciones ni RLS; no se realizaron escrituras reales en Supabase; no se llamó
a Groq.

## Alcance

Sustituir la pantalla informativa `/areas` por un módulo funcional para
**consultar, registrar y editar áreas y corrales**, y corregir la presentación
"parcial" de la capacidad en el dashboard. No se implementaron porcinos,
movimientos, camadas ni sanidad.

## Decisiones de diseño

- **Endpoints reales del backend, sin inventar campos.** Un área tiene
  `name`, `description`, `status`, `created_at`, `updated_at` (**no existe
  `code`**). Un corral tiene `area_id`, `code`, `name`, `capacity`, `notes`,
  `status` y marcas de tiempo.
- **`DELETE` = baja lógica** (`status='inactive'`). El backend no expone
  reactivación, así que la interfaz **solo ofrece "Desactivar"** y únicamente
  sobre registros activos. No se borra ninguna fila.
- **Edición de corral sin reasignar área**: el `PATCH` del backend no acepta
  `area_id`; la interfaz no lo permite.
- **Catálogo cargado completo y filtrado en memoria** (estado, área y texto).
  Son los mismos criterios que admite el backend (`?status=`, `?area_id=`), no
  se inventan filtros nuevos.
- **Permisos reales**: lectura para cualquier rol operativo activo; escritura
  (alta, edición y baja lógica) solo `admin`/`manager` (`CATALOG_WRITE_ROLES`,
  `canManageCatalog`). El backend sigue siendo la autoridad (403).
- **Extensión del cliente HTTP**: se añadieron `patch` y `delete` a `ApiClient`
  (con `DELETE` documentado como baja lógica).
- **Corrección de honestidad del dashboard**: se agregó `partial: boolean` a
  `DashboardCapacitySummary`. `usageRate` es `null` cuando la capacidad está
  incompleta o el listado se truncó; la interfaz muestra "capacidad parcial /
  no calculable" en lugar de un porcentaje engañoso. Sin cambios de BD.

## Endpoints consumidos

- `GET /areas`, `GET /areas/:id`, `POST /areas`, `PATCH /areas/:id`,
  `DELETE /areas/:id` (baja lógica).
- `GET /pens`, `GET /pens/:id`, `POST /pens`, `PATCH /pens/:id`,
  `DELETE /pens/:id` (baja lógica).
- `GET /dashboard/summary` (lectura; corrección de capacidad).

Códigos traducidos a español: 401, 403, 404, 409, 422, 503 y error de red.

## Archivos principales

- `frontend/src/pages/AreasPensPage.tsx` (+ `.test.tsx`, 24 pruebas).
- `frontend/src/components/locations/{AreaFormModal,PenFormModal,StatusBadge}.tsx`.
- `frontend/src/components/ui/{Modal,ConfirmDialog}.tsx`.
- `frontend/src/services/{areas.service,pens.service,location-status}.ts` (+ pruebas).
- `frontend/src/lib/http.ts` (+ pruebas): `patch`/`delete`.
- `frontend/src/config/roles.ts`: `CATALOG_WRITE_ROLES` / `canManageCatalog`.
- `backend/src/modules/dashboard/dashboard.service.ts`: campo `partial`.
- `frontend/src/styles/global.css`: pestañas, barra de herramientas, badges, modal.

## Pruebas

- Frontend: listado, estados vacío/carga/error, filtros, permisos por rol, alta,
  edición, baja con confirmación, doble envío, refresco tras éxito y traducción
  de 401/403/404/409/422/503.
- Backend: `dashboard.service.test.ts` y `dashboard.test.ts` actualizados para
  `partial` / `usageRate = null`.

## Verificación

- `frontend`: typecheck OK, 14 archivos / 112 pruebas OK, build OK.
- `backend`: typecheck OK, build OK, 26 archivos / 476 pruebas OK (30 omitidas).

## Pendientes

- Validar en el navegador con datos reales (requiere autorización de escritura).
- La **regla de capacidad de corrales** sigue pendiente de decisión de negocio
  (ver S5-C2).
