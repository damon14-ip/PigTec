# Sprint 5 — S5-D1: interfaz de movimientos y trazabilidad del porcino

**Estado:** implementado y verificado (typecheck, pruebas y build de frontend y
backend). **Sin commit ni push.** No se modificó la base de datos, las
migraciones ni RLS; **no se realizaron escrituras reales en Supabase**; no se
llamó a Groq; no se ejecutaron pruebas E2E que escriban en la base real.

## Alcance

Convertir la pantalla provisional `/movements` en un módulo funcional para
**consultar y registrar movimientos** de porcinos, y añadir la **trazabilidad de
movimientos** dentro del módulo de porcinos, consumiendo exclusivamente los
endpoints existentes del backend. No se implementaron camadas, sanidad ni
reportes; no se tocó el asistente IA.

## Reglas respetadas (contrato real del backend)

- **El historial es INMUTABLE.** El backend no expone `PUT`, `PATCH` ni `DELETE`
  de movimientos (la base 005 deniega `UPDATE`/`DELETE` por privilegios y
  trigger). La interfaz **no** ofrece editar ni eliminar; lo explica.
- **`from_pen_id` NO se envía.** Lo completa el backend con la ubicación vigente
  del porcino (trazabilidad). El formulario solo muestra la ubicación actual
  (lectura) y no permite elegir el origen.
- **`recorded_by` NO se envía.** Lo toma el backend del JWT.
- **La ubicación, el estado y `exit_date` los deriva el trigger de PostgreSQL**
  (`apply_animal_movement`) en la misma transacción del `POST`. El frontend
  **nunca** los calcula ni los fija; tras registrar, vuelve a leer del servidor.
- **`to_pen_id` nulo** solo es coherente en salidas externas (`sale` y
  `transfer` sin destino); el resto de motivos exige corral destino distinto del
  actual.

### Matriz de motivos y roles (espejo de `allowedMovementRoles` y la RLS 005)

Los 9 motivos reales del enum `public.movement_reason`: `weaning`,
`growth_stage`, `fattening`, `breeding`, `health_isolation`, `sale`, `transfer`,
`management`, `other`.

| Motivo | Corral destino | Roles autorizados |
| --- | --- | --- |
| `weaning`, `growth_stage`, `fattening`, `breeding`, `management`, `other` | obligatorio | `admin`, `manager`, `operator` |
| `health_isolation` | obligatorio | `admin`, `manager`, `operator`, `veterinarian` |
| `transfer` (interno, con destino) | obligatorio | `admin`, `manager`, `operator` |
| `transfer` (externo, sin destino) | nulo | `admin`, `manager` |
| `sale` | nulo | `admin`, `manager` |

- El motivo `transfer` es **interno** (con destino) o **externo** (salida) según
  una casilla que solo se muestra a `admin`/`manager`. Para `operator`, el
  traslado es siempre interno y exige destino.
- **Estados que admiten movimientos:** `active` y `missing`. Los estados
  terminales (`sold`, `dead`, `transferred_out`) y la baja lógica (`inactive`) se
  bloquean en el cliente, igual que en el backend.
- La lógica de permisos vive en el **servicio frontend** (espejo del servicio del
  backend) para evitar un ciclo de importación `config ↔ service`.

## UI implementada

### Pantalla `/movements`

- **Tabla** (componente reutilizable `MovementsTable`): fecha y hora, porcino
  (código PigTec), tipo de movimiento, origen, destino y observaciones. Las
  salidas externas muestran «Salida de la granja» en vez de un destino vacío.
- **Barra de herramientas**: búsqueda por porcino (por `animal_code`/arete,
  resuelta contra el catálogo y enviada como `animal_id` real), filtro por tipo,
  filtro por corral (`pen_id`), rango `Desde`/`Hasta` y botón «Actualizar».
- **Paginación** por `limit`/`offset` (tamaño 20). La API **no informa del
  total**: «Siguiente» se habilita cuando la página se completa y la interfaz lo
  aclara de forma explícita; **no se simula un contador**.
- **Estados**: carga, error con «Reintentar», vacío (sin datos frente a sin
  coincidencias) y aviso —sin bloquear— si fallan los catálogos de apoyo.
- **Notificaciones** de éxito/error y refresco del historial y de los catálogos
  tras registrar.

### Formulario «Registrar movimiento» (modal, dinámico por motivo)

- **Porcino** (selección del catálogo) con su **ubicación actual** consultada a
  `GET /animals/:id/location` (solo lectura; texto explícito de que el origen lo
  fija el sistema).
- **Tipo de movimiento** filtrado por el rol del usuario.
- **Corral destino** solo cuando el motivo lo exige: se ofrecen únicamente
  corrales **activos** con **área activa** y **distintos del actual**.
- Avisos contextuales para venta, transferencia externa y aislamiento sanitario.
- **Fecha y hora opcional** (`datetime-local` → ISO 8601 con zona; si se deja
  vacía, la fija el sistema).
- **Observaciones** ≤ 2000 caracteres.
- **Validación previa** con mensajes claros, **doble envío bloqueado** y
  **confirmación explícita** (`ConfirmDialog`) antes de registrar, recordando que
  el historial es permanente.

### Trazabilidad en el detalle del porcino

- Botón **«Ver movimientos»** en el detalle del porcino que abre
  `AnimalMovementsModal`.
- Consume `GET /animals/:id/movements` (solo lectura) y muestra el historial en
  **orden cronológico** (del más antiguo al más reciente), reutilizando
  `MovementsTable` (sin la columna «Porcino»). Incluye estado vacío propio y aviso
  cuando se alcanza el tope de 100 filas.

## Endpoints consumidos (todos reales, existentes)

- `GET /movements` (filtros `animal_id`, `from_pen_id`, `to_pen_id`, `pen_id`,
  `reason`, `recorded_by`, `moved_from`, `moved_to`, `limit` 1..500, `offset`).
- `GET /movements/:id` (servicio; no usado por la UI actual).
- `GET /animals/:id/movements` (filtros `reason`, `moved_from`, `moved_to`,
  `limit`, `offset`) — trazabilidad.
- `POST /movements` (cuerpo estricto: `animal_id`, `reason`, `to_pen_id` —nulo en
  salidas externas—, `moved_at?`, `notes?`).
- Lectura de apoyo: `GET /animals`, `GET /areas`, `GET /pens`,
  `GET /animals/:id/location`.

No existe (ni se inventó) ningún `PUT`/`PATCH`/`DELETE` de movimientos.

## Archivos

**Creados**

- `frontend/src/services/movements.service.ts` (+ `.test.ts`): contrato exacto,
  enums reales, guardas de tiempo de ejecución, constructores de consulta y
  helpers de permisos.
- `frontend/src/components/movements/labels.ts`: formato de fecha/hora local,
  conversión `date`→ISO con zona (`startOfDayIso`/`endOfDayIso`) y
  `buildPenLabelMap`.
- `frontend/src/components/movements/MovementsTable.tsx`: tabla compartida.
- `frontend/src/components/movements/MovementFormModal.tsx`: formulario dinámico
  + confirmación.
- `frontend/src/components/movements/AnimalMovementsModal.tsx`: trazabilidad.
- `frontend/src/pages/MovementsPage.test.tsx`: pruebas de la pantalla.
- `docs/progreso/17_SPRINT_5_S5D1_MOVIMIENTOS.md`: este documento.

**Modificados**

- `frontend/src/pages/MovementsPage.tsx`: pantalla funcional (filtros,
  paginación, catálogos, alta y avisos).
- `frontend/src/components/animals/AnimalDetailModal.tsx`: nuevas props
  `pens`/`areas` + botón «Ver movimientos» + modal anidado.
- `frontend/src/pages/AnimalsPage.tsx`: pasa `pens`/`areas` al detalle.
- `frontend/src/pages/AnimalsPage.test.tsx`: pruebas de trazabilidad.
- `frontend/src/components/ui/ConfirmDialog.tsx`: `message: ReactNode` y
  `confirmVariant` (compatible hacia atrás).
- `frontend/src/styles/global.css`: `.pagination`, `.movement-when`,
  `.movement-notes`, `.field__checkbox`.
- `docs/progreso/00_INDICE_Y_CONVENCIONES.md`: índice y estado del Sprint 5.

**Backend:** sin cambios (los endpoints ya existían y cumplen los requisitos).

## Pruebas automatizadas (con mocks; sin datos reales)

- `frontend/src/services/movements.service.test.ts` (**15 pruebas**): contrato y
  guardas, matrices motivo↔rol, `allowsNullDestination`, `admitsMovements`,
  construcción de consultas.
- `frontend/src/pages/MovementsPage.test.tsx` (**34 pruebas**): listado (fecha,
  porcino, tipo, origen, destino, observaciones); estado vacío; carga; error 503
  con reintento; fallo de red; fallo parcial de catálogos; filtro por tipo,
  corral y rango de fechas; búsqueda por porcino con `animal_id` real; paginación
  `limit`/`offset` sin total; permisos por rol (veterinario, operator, manager,
  transferencia externa); formulario dinámico (ubicación actual, venta sin
  destino, destinos solo activos y distintos del actual, aislamiento);
  validaciones sin llamar a la API; confirmación/cancelación; registro + refresco
  + notificación; fecha en ISO con zona; doble envío; traducción de
  400/401/403/404/409/422/503.
- `frontend/src/pages/AnimalsPage.test.tsx` (**29 pruebas**, +3 de trazabilidad):
  historial cronológico del porcino, estado vacío e historial con reintento.

## Verificación

- **Frontend**: `tsc --noEmit` OK; `vitest run` = **18 archivos / 201 pruebas
  OK**; `vite build` OK (aviso de tamaño de chunk, preexistente).
- **Backend**: `tsc -p tsconfig.json --noEmit` OK; `vitest run` =
  **26 archivos / 476 pruebas OK, 3 archivos / 30 omitidas**. Sin cambios de
  código en backend.

## Limitaciones y pendientes

- **Sin total en la paginación**: la API de movimientos no devuelve el total; la
  interfaz usa `limit`/`offset` y lo advierte. No se simula un contador.
- **Sin búsqueda por texto en el backend**: la búsqueda por porcino exige el
  código PigTec exacto (o elegir de las sugerencias); no hay búsqueda difusa.
- **Capacidad de corral**: el backend **no** la impone; el frontend ofrece
  destinos activos pero **no bloquea** por capacidad (coherente con la decisión
  documentada en S5-C2).
- **Edición/eliminación**: no existen endpoints; el historial es inmutable por
  diseño.
- **`GET /animals` y `GET /pens` sin paginación explícita**: el catálogo de
  apoyo depende del límite por defecto de PostgREST; con inventarios muy grandes
  las etiquetas podrían quedar parciales (documentado, fuera de alcance).
- Se avanzará a la siguiente etapa del Sprint 5 (S5-E, exportaciones) **solo tras
  aprobación**; S5-D1 queda cerrado sin avanzar automáticamente.

## Pasos para validar manualmente (sin escribir datos reales)

1. Levantar backend y frontend con credenciales válidas de desarrollo.
2. **Solo lectura** (rol `viewer`, o el rol que no tenga ningún motivo
   disponible): `/movements` debe mostrarse en «Modo consulta», con tabla,
   búsqueda, filtros y paginación, pero **sin** «Registrar movimiento».
3. **Consulta de trazabilidad** (cualquier rol operativo): en `/animals`, «Ver
   detalle» → «Ver movimientos»; comprobar el orden cronológico, el estado vacío
   para un animal sin movimientos y el reintento ante un error de red simulado.
4. **Filtros y paginación** (solo lectura, no escriben): filtrar por tipo, corral
   y rango de fechas; buscar un porcino por su código PigTec; navegar entre
   páginas y observar el aviso de «sin total».
5. **Permisos del formulario** (abrir «Registrar movimiento» sin guardar):
   - `veterinarian`: solo «Aislamiento sanitario».
   - `operator`: sin venta y sin transferencia externa (traslado siempre interno).
   - `admin`/`manager`: todos los tipos y la casilla de transferencia externa.
6. **Registro real (OPCIONAL y solo con autorización explícita, porque ESCRIBE en
   la base de datos):** elegir un porcino activo, un motivo interno y un corral
   destino activo; revisar la confirmación (que recuerda que el historial es
   permanente), registrar y comprobar la notificación con el código del porcino y
   el refresco del historial y de la ubicación.
7. Verificar que el dashboard sigue funcionando y que el asistente IA responde
   (sin regresiones).
