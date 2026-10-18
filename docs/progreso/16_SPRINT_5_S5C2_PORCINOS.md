# Sprint 5 — S5-C2: interfaz de gestión de porcinos

**Estado:** implementado y verificado (typecheck, pruebas y build de frontend y
backend). **Sin commit ni push.** No se modificó la base de datos, las
migraciones ni RLS; no se realizaron escrituras reales en Supabase; no se llamó
a Groq; no se ejecutaron pruebas E2E que escriban en la base real.

## Alcance

Sustituir la pantalla provisional `/animals` por un módulo funcional para
**consultar, registrar y editar porcinos**, consumiendo exclusivamente los
endpoints existentes del backend. No se implementaron movimientos, camadas ni
sanidad, y **no se modificó la lógica de movimientos**.

## Decisiones de diseño y reglas respetadas

- **`animal_code` nunca se escribe ni se calcula en el frontend.** Lo genera la
  base de datos (secuencia `public.animals_animal_code_seq`, formato
  `PIG-000001`). El formulario de alta lo explica y **no** incluye un campo para
  escribirlo; la edición lo muestra como dato inmutable.
- **Campos del alta (`POST /animals`)**: `ear_tag_code`, `sex`, `breed`,
  `birth_date`, `origin`, `current_pen_id`, `entry_date` y `notes` (todos
  opcionales en el backend; `sex` se envía siempre, con `unknown` por defecto, y
  `entry_date` se omite si se deja vacío para que la base use la fecha del día).
  **No se envían** `animal_code`, `status`, `exit_date` ni `created_by`.
- **Edición (`PATCH /animals/:id`)**: solo los campos autorizados
  (`ear_tag_code`, `sex`, `breed`, `birth_date`, `origin`, `notes`). **No** se
  envían `current_pen_id`, `status`, `entry_date`, `exit_date` ni `animal_code`.
- **Sin traslados por esta vía.** La ubicación se cambia con movimientos
  (módulo Movimientos); la interfaz no actualiza `current_pen_id` para simular un
  traslado.
- **Cambio de estado (`PATCH /animals/:id/status`)**: solo `active`, `inactive`
  y `missing`. Los estados `sold`, `dead` y `transferred_out` se derivan de
  movimientos/eventos sanitarios y **no se ofrecen**: para un animal en esos
  estados se muestra un aviso de "estado derivado" y no la acción.
- **Parentesco y camadas fuera de alcance.** `mother_id`, `father_id` y
  `litter_id` existen en el modelo, pero su captura pertenece a los flujos de
  genealogía y al módulo Camadas (especificación maestra 4.3). No se incluyen
  aquí para no implementar funciones de otro módulo; la vista de detalle lo
  indica.
- **Búsqueda y filtros compatibles con la API**: texto por `animal_code`/arete
  (equivalente a `?q=`), estado (`?status=`), sexo (`?sex=`), origen
  (`?origin=`) y corral (`?current_pen_id=`). El catálogo se carga completo y se
  filtra en memoria sobre los mismos criterios del backend.
- **Permisos reales (coinciden con el backend)**: lectura para cualquier rol
  operativo activo; escritura (alta, edición y cambio de estado) solo
  `admin`/`manager` (`ANIMAL_WRITE_ROLES`, `canManageAnimals`; espejo de
  `ADMIN_MANAGER` en `animals.routes.ts`). La edición de animales por `operator`
  está pendiente de definición (especificación 5.1), por eso hoy no se habilita.

### Capacidad de corral: decisión confirmada con el usuario

El backend **no impone** la capacidad ni exige que el corral esté activo
(`database/migrations/005_movements_integrity_rls.sql`: *"NO aplica reglas de
capacidad de corrales… no hay una regla de negocio aprobada que la imponga"*).
Siguiendo la instrucción del responsable del proyecto, se implementó:

1. **El selector de corral inicial ofrece únicamente corrales ACTIVOS.**
2. **Se avisa cuando la capacidad registrada está completa o superada, sin
   impedir el guardado.** El aviso indica la ocupación estimada a partir del
   inventario cargado (`GET /animals`) y aclara que la validación obligatoria de
   capacidad está pendiente de aprobación.
3. **Si la capacidad es desconocida, se indica explícitamente** que no puede
   verificarse la disponibilidad; no se asume disponibilidad.
4. No se modifica el backend, ni las migraciones, ni RLS: la regla de capacidad
   obligatoria **sigue pendiente de una decisión de negocio**.

## UI implementada

- **Tabla de porcinos**: código PigTec, arete, sexo, raza, estado, ubicación
  actual (corral resuelto desde el catálogo de corrales), fecha de ingreso y
  acción "Ver detalle".
- **Barra de herramientas**: búsqueda por texto y filtros por estado, sexo,
  origen y corral, más botón "Actualizar".
- **Estados**: carga, error con "Reintentar", ausencia de registros (sin datos
  frente a sin coincidencias).
- **Alta "Nuevo porcino"** en modal: campos del `POST`, aviso de código
  automático, selector de corrales activos, aviso de capacidad y validación
  previa al envío (arete ≤ 100, raza ≤ 200, notas ≤ 2000, fechas válidas).
- **Detalle** (`GET /animals/:id` + `GET /animals/:id/location`) en modal:
  ficha del animal y ubicación actual.
- **Edición** desde el detalle (solo campos autorizados).
- **Cambio de estado administrativo** con confirmación, solo en estados
  administrativos.
- Notificaciones de éxito/error, refresco de la tabla tras cada operación y
  bloqueo del envío mientras la petición está en vuelo.

## Endpoints consumidos (todos reales, existentes)

- `GET /animals` (filtros `q`, `status`, `sex`, `origin`, `breed`,
  `current_pen_id`), `GET /animals/:id`, `GET /animals/:id/location`.
- `POST /animals`, `PATCH /animals/:id`, `PATCH /animals/:id/status`.
- Lectura de apoyo: `GET /areas`, `GET /pens` (para etiquetar y ofrecer
  corrales; no se usó `service_role`).

Nunca se llama a `DELETE /animals` (no existe; la baja es el estado `inactive`).

## Archivos

- `frontend/src/services/animals.service.ts` (+ `.test.ts`): contrato exacto y
  validación en tiempo de ejecución; enums y etiquetas en español.
- `frontend/src/components/animals/AnimalFormModal.tsx`: alta/edición.
- `frontend/src/components/animals/AnimalDetailModal.tsx`: detalle.
- `frontend/src/components/animals/AnimalStatusDialog.tsx`: cambio de estado.
- `frontend/src/components/animals/AnimalStatusBadge.tsx`: badge de estado.
- `frontend/src/pages/AnimalsPage.tsx` (+ `.test.tsx`): pantalla funcional.
- `frontend/src/config/roles.ts`: `ANIMAL_WRITE_ROLES` / `canManageAnimals`.
- `frontend/src/styles/global.css`: variantes de badge de estado y rejilla de
  detalle.

**Backend:** sin cambios (los endpoints ya existían y cumplen los requisitos).

## Pruebas automatizadas (con mocks; sin datos reales)

`frontend/src/pages/AnimalsPage.test.tsx` (24 pruebas) y
`frontend/src/services/animals.service.test.ts` (13 pruebas) cubren:

- listado real con estado y ubicación; estado vacío; filtros por texto, estado y
  corral;
- estados de carga, error 503 con reintento y fallo de red;
- permisos: rol de consulta oculta la escritura; manager la ve;
- alta: sin campo de `animal_code` y con aviso de generación automática; solo
  corrales activos en el selector; aviso de capacidad completa/superada sin
  bloquear; aviso de capacidad no registrada; validación sin llamar a la API;
  registro con `POST`, refresco y notificación del código generado; prevención de
  doble envío;
- detalle: apertura con ubicación, 404 traducido, edición `PATCH` sin
  `current_pen_id`, cambio de estado con confirmación, estado derivado sin acción
  y detalle sin acciones para rol de consulta;
- traducción de 401/403/409/422.

## Verificación

- **Frontend**: `tsc --noEmit` OK; `vitest run` = **16 archivos / 149 pruebas
  OK**; `vite build` OK (aviso de tamaño de chunk, preexistente).
- **Backend**: `tsc` OK; `tsc -p tsconfig.build.json` OK; `vitest run` =
  **26 archivos / 476 pruebas OK** (30 omitidas). Sin cambios de código.

## Limitaciones y pendientes

- **Regla de capacidad obligatoria pendiente de decisión de negocio.** Hoy es
  solo un aviso en la interfaz.
- **`GET /animals` sin paginación explícita**: el listado depende del límite por
  defecto de PostgREST (normalmente 1000 filas). El filtrado en memoria y el
  aviso de capacidad operan sobre ese conjunto; si el inventario supera el
  límite, la cifra debe tratarse como parcial. Documentado, no resuelto (fuera de
  alcance).
- **Parentesco y camadas** (`mother_id`, `father_id`, `litter_id`) no se editan
  en esta pantalla: corresponden al módulo Camadas / flujos de genealogía.
- **Edición por `operator`** no habilitada (decisión técnica pendiente en la
  especificación 5.1).
- No se modificó la especificación maestra. Se propone (para aprobación del
  responsable) añadir una línea en su sección 13 declarando explícitamente la
  capacidad de corrales como **decisión pendiente**.

## Pasos para validar manualmente (sin escribir datos reales)

1. Levantar backend y frontend con credenciales válidas de desarrollo.
2. **Solo lectura** (por ejemplo, rol `operator`/`veterinarian`): `/animals`
   debe mostrarse en "Modo consulta", con tabla, búsqueda y filtros, pero sin
   "Nuevo porcino" ni acciones de escritura en el detalle.
3. **Escritura** (`admin`/`manager`):
   - "Nuevo porcino" → comprobar que **no** hay campo de código y que se explica
     su generación; observar que el selector solo lista corrales **activos**;
     elegir un corral con capacidad completa para ver el aviso (sin bloqueo) y
     uno sin capacidad para ver el aviso correspondiente.
   - Registrar (esto **escribe** en la base de datos real: hacerlo solo con
     autorización explícita), verificar la notificación con el código generado y
     el refresco de la tabla.
   - "Ver detalle" → ficha + ubicación; "Editar" → cambiar notas; "Cambiar
     estado" → confirmar.
4. Verificar que el dashboard sigue funcionando y que el asistente IA responde
   (sin regresiones).
