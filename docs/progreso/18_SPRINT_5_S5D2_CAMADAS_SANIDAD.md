# Sprint 5 — S5-D2: interfaz de camadas y sanidad

**Estado:** implementado y verificado (typecheck, pruebas y build de frontend y
backend). **Sin commit ni push.** No se modificó la base de datos, las
migraciones ni RLS; **no se realizaron escrituras reales en Supabase**; no se
llamó a Groq; no se ejecutaron pruebas E2E que escriban en la base real.

## Alcance

Convertir las pantallas provisionales `/litters` (Camadas) y `/health`
(Sanidad) en módulos funcionales, y añadir el **historial sanitario del
porcino** dentro del detalle del porcino, consumiendo exclusivamente los
endpoints existentes del backend. **No se modificó el backend** (todos los
endpoints ya existían). No se implementaron reportes ni exportaciones; no se
tocó el asistente IA.

## Reglas respetadas (contrato real del backend)

### Camadas

- **La camada NO se elimina.** El backend no expone `DELETE`; la interfaz **no**
  ofrece borrado y lo explica.
- **La interfaz NO crea porcinos individuales** a partir de una camada: el
  vínculo camada↔cría se gestiona desde el módulo de porcinos (backend
  `PATCH /animals/:id` con `litter_id`). El detalle de la camada solo consulta
  `GET /litters/:id/offspring`.
- **`total_born`/`born_alive`/`stillborn`**: en el **alta** el esquema rechaza
  `null`, así que los conteos vacíos **se omiten** del cuerpo; en la **edición**
  el esquema acepta `null` y exige al menos un campo, por lo que vaciar un conteo
  envía `null`.
- **Escritura solo para `admin`, `manager` y `operator`.** El `veterinarian`
  consulta (sin alta ni edición). La lógica de permisos vive en el **servicio
  frontend** (espejo del backend) para evitar un ciclo de importación
  `config ↔ service`.

### Sanidad

- **El historial es INMUTABLE.** El backend no expone `PUT`/`PATCH`/`DELETE`
  (la migración 007 no concede `UPDATE`/`DELETE`). La interfaz **no** ofrece
  editar ni eliminar; lo explica de forma explícita.
- **`recorded_by` NO se envía.** Lo toma el backend del JWT.
- **`details` NO se edita.** Es un objeto JSON de claves libres y el esquema del
  proyecto no fija claves concretas (el backend lo deja en `{}` por defecto); el
  detalle solo lo muestra si viene con datos.
- **Solo se ofrecen porcinos que admiten eventos** (`active` / `missing`). Un
  porcino vendido, fallecido, transferido o dado de baja no admite nuevos
  eventos.
- **La mortalidad la deriva el trigger de PostgreSQL** (`apply_mortality_event`:
  estado `dead`, `exit_date` y `current_pet_id = null`). El frontend **solo
  advierte** y **nunca** fija el estado; tras registrar, vuelve a leer del
  servidor.

#### Matriz de tipos de evento y roles (espejo de `allowedHealthEventRoles`)

Los 9 tipos reales del enum `public.health_event_type`: `observation`,
`symptom_report`, `documented_diagnosis`, `treatment`, `vaccination`,
`deworming`, `mortality`, `recovery`, `other`.

| Tipo de evento | Roles autorizados |
| --- | --- |
| `observation`, `symptom_report`, `other` | `admin`, `manager`, `operator`, `veterinarian` |
| `documented_diagnosis`, `treatment`, `vaccination`, `deworming`, `recovery` | `veterinarian` |
| `mortality` | `admin`, `manager`, `veterinarian` |

- El selector de tipo del formulario se filtra por el rol del usuario.
- La mortalidad pide **confirmación en rojo** con un aviso del carácter
  definitivo de la operación.

## UI implementada

### Pantalla `/litters` (Camadas)

- **Tabla** (`LittersTable`): código de camada, madre (código PigTec), padre,
  fecha de parto, total nacidos / vivos / mortinatos y acciones.
- **Barra de herramientas**: búsqueda por madre (por `animal_code`, resuelta
  contra el catálogo y enviada como `mother_id` real), rango de fechas de parto
  (`birth_from`/`birth_to`) y botón «Actualizar».
- **Paginación** por `limit`/`offset` (tamaño 20). La API **no informa del
  total**: «Siguiente» se habilita cuando la página se completa y la interfaz lo
  aclara; **no se simula un contador**.
- **Estados**: carga, error con «Reintentar», vacío (sin datos frente a sin
  coincidencias) y aviso —sin bloquear— si falla el catálogo de apoyo.
- **Formulario «Registrar camada»** (modal): madre (solo hembras), padre opcional
  (solo machos), código de camada opcional, fecha de parto, conteos y
  observaciones. Validación de que **los vivos no superan el total**; confirmación
  explícita, doble envío bloqueado y refresco del listado.
- **Edición** (modal): campos permitidos (madre/padre, fecha, conteos,
  observaciones) con confirmación; envía `PATCH /litters/:id`.
- **Detalle** (modal): datos de la camada y **descendencia** vía
  `GET /litters/:id/offspring`, con estado vacío propio.

### Pantalla `/health` (Sanidad)

- **Tabla** (`HealthEventsTable`, reutilizable): fecha y hora, porcino (código
  PigTec), tipo (con distintivo visual observación / clínico / mortalidad),
  título y descripción.
- **Barra de herramientas**: búsqueda por porcino (por `animal_code`/arete,
  resuelta contra el catálogo y enviada como `animal_id` real), filtro por tipo,
  rango `Desde`/`Hasta` y «Actualizar».
- **Paginación** `limit`/`offset` (tamaño 20), sin total.
- **Estados**: carga, error con «Reintentar», vacío (sin datos frente a sin
  coincidencias) y aviso si falla el catálogo de apoyo.
- **Formulario «Registrar evento sanitario»** (modal): porcino (solo los que
  admiten eventos), tipo (según rol), título obligatorio, fecha y hora opcional
  (`datetime-local` → ISO 8601 con zona), descripción, «documentado por» y
  referencia/adjunto. Validaciones, **confirmación** (en rojo para mortalidad),
  doble envío bloqueado y refresco del listado **y del catálogo de porcinos**.
- **Detalle** (modal): `GET /health-events/:id`, con datos adicionales de
  `details` si existen y recordatorio de que el historial es permanente.

### Historial sanitario en el detalle del porcino

- Botón **«Ver sanidad»** en el detalle del porcino que abre
  `AnimalHealthEventsModal`.
- Consume `GET /animals/:id/health-events` (solo lectura) y muestra el historial
  en **orden cronológico** (del más antiguo al más reciente), reutilizando
  `HealthEventsTable` (sin la columna «Porcino»). Incluye estado vacío propio,
  aviso al alcanzar el tope de 100 filas y acceso al detalle de cada evento.

## Endpoints consumidos (todos reales, existentes)

**Camadas**

- `GET /litters` (filtros `mother_id`, `father_id`, `birth_from`, `birth_to`,
  `limit` 1..500, `offset`).
- `GET /litters/:id`.
- `GET /litters/:id/offspring`.
- `POST /litters`.
- `PATCH /litters/:id`.

**Sanidad**

- `GET /health-events` (filtros `animal_id`, `event_type`, `recorded_by`,
  `occurred_from`, `occurred_to`, `limit` 1..500, `offset`).
- `GET /health-events/:id`.
- `GET /animals/:id/health-events` (filtros `event_type`, `occurred_from`,
  `occurred_to`, `limit`, `offset`).
- `POST /health-events`.

**Lectura de apoyo:** `GET /animals` (identificación por código PigTec).

No existe (ni se inventó) ningún `DELETE` de camadas ni `PUT`/`PATCH`/`DELETE` de
eventos sanitarios.

## Archivos

**Creados**

- `frontend/src/lib/dates.ts` (+ `.test.ts`): utilidades de fecha compartidas
  (formato de fecha local, `datetime-local`↔ISO con zona, límites del día local,
  validaciones).
- `frontend/src/services/litters.service.ts` (+ `.test.ts`): contrato exacto de
  camadas, enums, guardas de tiempo de ejecución, constructores de consulta y
  `canWriteLitters`.
- `frontend/src/services/health-events.service.ts` (+ `.test.ts`): contrato
  exacto de eventos sanitarios, enums, matrices tipo↔rol, guardas, constructores
  de consulta y `admitsHealthEvents`.
- `frontend/src/components/litters/LittersTable.tsx`.
- `frontend/src/components/litters/LitterFormModal.tsx` (alta + edición +
  confirmación).
- `frontend/src/components/litters/LitterDetailModal.tsx` (detalle +
  descendencia).
- `frontend/src/components/health/HealthEventsTable.tsx`.
- `frontend/src/components/health/HealthEventFormModal.tsx` (tipos por rol +
  confirmación, aviso de mortalidad).
- `frontend/src/components/health/HealthEventDetailModal.tsx`.
- `frontend/src/components/health/AnimalHealthEventsModal.tsx` (historial del
  porcino).
- `frontend/src/pages/LittersPage.test.tsx`.
- `frontend/src/pages/HealthPage.test.tsx`.
- `docs/progreso/18_SPRINT_5_S5D2_CAMADAS_SANIDAD.md`: este documento.

**Modificados**

- `frontend/src/pages/LittersPage.tsx`: pantalla funcional (filtros, paginación,
  catálogos, alta, edición y avisos).
- `frontend/src/pages/HealthPage.tsx`: pantalla funcional (filtros, paginación,
  catálogos, alta y avisos).
- `frontend/src/components/animals/AnimalDetailModal.tsx`: botón «Ver sanidad» +
  `AnimalHealthEventsModal`.
- `frontend/src/pages/AnimalsPage.test.tsx`: pruebas del historial sanitario.
- `frontend/src/styles/global.css`: badges `.badge--observation`,
  `.badge--clinical`, `.badge--mortality` y `.health-notes`.
- `docs/progreso/00_INDICE_Y_CONVENCIONES.md`: índice y estado del Sprint 5.

**Backend:** sin cambios (los endpoints ya existían y cumplen los requisitos).

## Pruebas automatizadas (con mocks; sin datos reales)

- `frontend/src/services/litters.service.test.ts` (**12 pruebas**): contrato,
  guardas, filtros, `canWriteLitters` y construcción de consultas.
- `frontend/src/services/health-events.service.test.ts` (**16 pruebas**):
  contrato, guardas, enumeraciones, matrices tipo↔rol, `admitsHealthEvents` y
  construcción de consultas.
- `frontend/src/lib/dates.test.ts` (**9 pruebas**): formato, validaciones y
  conversiones de fecha.
- `frontend/src/pages/LittersPage.test.tsx` (**28 pruebas**): listado y estado
  vacío; carga; error 503 con reintento; fallo de red; fallo parcial del catálogo;
  filtro por madre y rango de fechas; paginación `limit`/`offset` sin total;
  permisos por rol (veterinario y operator); formulario (hembras como madre,
  machos como padre, validación vivos ≤ total, confirmación/cancelación);
  registro + refresco + notificación; doble envío; edición (`PATCH`); detalle y
  descendencia; traducción de 400/401/403/404/409/422/503.
- `frontend/src/pages/HealthPage.test.tsx` (**32 pruebas**): listado y estado
  vacío; inmutabilidad (sin editar/eliminar); carga; error 503 con reintento;
  fallo de red; fallo parcial del catálogo; filtros por porcino, tipo y rango de
  fechas; búsqueda con código inexistente; paginación; tipos de evento por rol
  (operator, veterinario, manager); porcinos admitidos; validaciones;
  confirmación/cancelación; registro + refresco + notificación; doble envío;
  aviso y confirmación en rojo de mortalidad; detalle (y su error 404);
  historial del porcino (orden cronológico y estado vacío); traducción de
  400/401/403/404/409/422/503.
- `frontend/src/pages/AnimalsPage.test.tsx` (**31 pruebas**, incluidas 2 del
  historial sanitario): «Ver sanidad» abre el historial del porcino y estado
  vacío.

## Verificación

- **Frontend**: `tsc --noEmit` OK; `vitest run` = **23 archivos / 300 pruebas
  OK**; `vite build` OK (aviso de tamaño de chunk, preexistente).
- **Backend**: `tsc -p tsconfig.json --noEmit` OK; `vitest run` = **26 archivos /
  476 pruebas OK, 3 archivos / 30 omitidas** (pruebas de integración real
  *opt-in*, desactivadas por defecto); `tsc -p tsconfig.build.json` OK. Sin
  cambios de código en backend.

## Limitaciones y pendientes

- **Sin total en la paginación**: ni camadas ni eventos sanitarios devuelven el
  total; la interfaz usa `limit`/`offset` y lo advierte. No se simula un contador.
- **Sin búsqueda por texto en el backend**: la búsqueda por porcino/madre exige
  el código PigTec exacto (o elegir de las sugerencias); no hay búsqueda difusa.
- **Vínculo camada↔cría**: la interfaz **no** asocia crías a una camada; se
  gestiona desde el módulo de porcinos (el `AnimalFormModal` actual no expone
  `litter_id`/`mother_id`/`father_id`, por lo que hoy no hay camino en la UI para
  esa asociación). Documentado como pendiente, coherente con el alcance.
- **`details` de sanidad**: no editable (claves libres sin contrato definido);
  solo se muestra si viene con datos.
- **Edición/eliminación**: camadas no se eliminan y el historial sanitario es
  inmutable; no existen endpoints.
- **`GET /animals` sin paginación explícita**: el catálogo de apoyo depende del
  límite por defecto de PostgREST; con inventarios muy grandes las etiquetas
  podrían quedar parciales (documentado, fuera de alcance).
- Se avanzará a la siguiente etapa del Sprint 5 (S5-E, exportaciones) **solo tras
  aprobación**; S5-D2 queda cerrado sin avanzar automáticamente.

## Pasos para validar manualmente (sin escribir datos reales)

1. Levantar backend y frontend con credenciales válidas de desarrollo.
2. **Camadas — solo lectura**: `/litters` debe mostrar tabla, búsqueda por madre,
   filtro por rango de fechas y paginación; el `veterinarian` **no** ve
   «Registrar camada» ni «Editar» (modo consulta).
3. **Camadas — detalle**: «Ver detalle» abre la camada y su descendencia; probar
   una camada sin crías (estado vacío) y un error de red simulado (reintento).
4. **Sanidad — solo lectura**: `/health` debe mostrar el historial con tipo
   (distintivo) y filtros por porcino, tipo y rango de fechas; comprobar que **no
   hay** botones de editar ni eliminar.
5. **Sanidad — permisos del formulario** (abrir «Registrar evento» sin guardar):
   - `operator`: solo observación / reporte de síntomas / otro.
   - `veterinarian`: además, clínicos (tratamiento, vacunación, etc.) y mortalidad.
   - `manager`/`admin`: todos, incluida mortalidad.
6. **Sanidad — historial del porcino**: en `/animals`, «Ver detalle» → «Ver
   sanidad»; comprobar el orden cronológico y el estado vacío.
7. **Registro real (OPCIONAL y solo con autorización explícita, porque ESCRIBE en
   la base de datos):** registrar una camada y/o un evento sanitario de
   observación; revisar la confirmación, registrar y comprobar la notificación y
   el refresco del listado. **No** usar mortalidad en datos reales sin
   intención, porque deriva el estado del porcino.
8. Verificar que el dashboard, los movimientos y el asistente IA siguen
   funcionando (sin regresiones).
