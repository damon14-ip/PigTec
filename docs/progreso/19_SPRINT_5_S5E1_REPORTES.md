# Sprint 5 — S5-E1: módulo de reportes y análisis

**Estado:** implementado y verificado (typecheck, pruebas y build de frontend y
backend). **Sin commit ni push.** No se modificó la base de datos, las
migraciones ni RLS; **no se realizaron escrituras en Supabase**; no se llamó a
Groq; no se ejecutaron pruebas E2E contra la base real. **No se implementaron
exportaciones (Excel/PDF): eso corresponde a S5-E2 y no se inició.**

## Alcance

Convertir la pantalla provisional `/reports` en un módulo funcional de
**reportes y análisis**, con indicadores, distribuciones, series, tablas y
gráficos calculados exclusivamente con **datos reales** del backend. Para ello:

- se añadió **un único endpoint de lectura agregado** en el backend,
  `GET /reports/summary`, que reúne todas las estadísticas en una respuesta;
- se implementó la pantalla `/reports` con filtros reales, estados de carga,
  error y vacío, y avisos de datos parciales;
- todo cálculo ocurre en el **backend con el JWT del usuario y RLS**; el
  navegador **no descarga los registros**, solo el resumen agregado.

No se tocaron los módulos operativos existentes (porcinos, movimientos,
camadas, sanidad, áreas y corrales) ni el asistente IA. No se crearon objetos en
la base de datos (ni RPC ni vistas).

## Decisiones de diseño

### Un endpoint agregado, sin objetos nuevos en la base

PostgREST (tal como se usa hoy) **no permite `GROUP BY`/`DISTINCT`** sin un
RPC/vista, y en esta etapa **no se pueden crear objetos** en la base. Por eso:

- las **distribuciones por categoría** (estado, sexo, origen, motivo de
  movimiento, tipo de evento) se calculan con **conteos exactos** de PostgREST
  (`count: 'exact', head: true`), **una consulta por valor de enum**, sin traer
  filas;
- las **dos únicas lecturas con filas** son exploraciones **paginadas y
  acotadas**: `animals.current_pen_id` (ocupación por corral) y las columnas de
  conteo de `litters` (sumas de nacimientos). Si se alcanza el tope, el
  resultado se marca como **parcial** y **nunca** se presenta como exacto;
- el **inventario total** se obtiene sumando los conteos por estado (partición
  exacta del mismo conjunto).

Límites definidos: `MAX_PENS = 1000`, `MAX_PEN_SCAN = 10000`,
`MAX_LITTER_SCAN = 5000` y páginas de `PAGE_SIZE = 500`.

### Honestidad de los datos

- `0` = la consulta **confirmó** que no hay registros.
- `null` = **no calculable** (nunca se sustituye por 0).
- Nunca se divide por cero: las tasas son `null` si el denominador es 0.
- Si una exploración se trunca, la métrica afectada se marca como parcial y no
  se presenta como exacta.

Casos concretos:

- **Origen "sin registrar"** (`animals.origin IS NULL`): se deriva como
  `total − suma(orígenes canónicos)`; no se cuenta de más.
- **Ocupación/capacidad de corrales**: sólo se cuentan los corrales **activos** y
  los ocupantes se cuentan **sólo en corrales activos**, de modo que la tabla por
  corral casa con `housedAnimals` (sin doble conteo). Con capacidad **incompleta**
  no se calcula el porcentaje de utilización (sería engañoso).
- **Movimientos**: cada mes se **recorta a los límites del periodo**, por lo que
  `sum(byMonth) === movements.total` (sin doble conteo ni días fuera del rango).
- **Eventos sanitarios**: `healthEvents.total` es la suma de `byType`.
- **Camadas**: las sumas usan sólo los conteos presentes; `complete` sólo es
  `true` si **todas** las camadas traen los tres conteos y no hubo truncamiento;
  el promedio de nacidos vivos por camada sólo se calcula cuando `complete` y
  `total > 0`.

### Periodo y zona horaria

- Filtros `from`/`to` en `YYYY-MM-DD`. Por defecto: **últimos 6 meses**
  (incluido el mes actual), terminando hoy.
- Máximo **12 meses**; un rango mayor se rechaza con `400`.
- Las fechas se interpretan como días **UTC** (`T00:00:00.000Z` …
  `T23:59:59.999Z`), igual que la especificación maestra; la zona horaria local
  (`America/Lima`) queda como **pendiente documentado**.

### Filtros

Se exponen **exactamente** los filtros que ya admite el backend en sus endpoints
operativos; no se inventaron criterios:

| Filtro de reportes | Espejo en el backend | Sección que acota |
| --- | --- | --- |
| `movement_reason` | `reason` (`GET /movements`) | movimientos |
| `health_event_type` | `event_type` (`GET /health-events`) | sanidad |
| `sex` | `sex` (`GET /animals`) | inventario de porcinos |
| `origin` | `origin` (`GET /animals`) | inventario de porcinos |
| `from` / `to` | rango de fechas | periodo (todas las series) |

### Seguridad y solo lectura

- `GET /reports/summary` exige un **rol operativo activo** (admin, manager,
  operator, veterinarian) vía el mismo `authenticate` + `requireRole` del
  proyecto. Sin token → `401`; `viewer` o usuario inactivo → `403`.
- El repositorio crea un cliente PostgREST **por petición con el JWT verificado**
  (RLS con la identidad del usuario). **Nunca** se usa `service_role`.
- El repositorio agregado **no expone ninguna operación de escritura** y su
  implementación por defecto es **fail-closed**: sin repositorio inyectado,
  responde `503`; si el repositorio falla, `503` (no se inventan cifras).

## Endpoint backend

`GET /reports/summary` — solo lectura. Respuesta (resumen):

```
{
  generatedAt, 
  period:  { from, to, fromIso, toIso, months[], maxMonths },
  filters: { movementReason, healthEventType, sex, origin },
  animals:      { total, byStatus[], bySex[], byOrigin[] (incluye null) },
  pens:         { total, occupied, occupancyRate, capacity{...}, truncated, byPen[] },
  movements:    { total, byMonth[], byReason[] },
  litters:      { total, truncated, complete, totalBorn, bornAlive, stillborn, averageBornAlive, recent[] },
  healthEvents: { total, byType[] }
}
```

## UI implementada (`/reports`)

- **Filtros**: `Desde`/`Hasta`, motivo de movimiento, tipo de evento sanitario,
  sexo y origen; se aplican **al cambiar** y con el botón «Actualizar», más
  «Limpiar». Un rango invertido se advierte y **no** se consulta (evita el `400`).
- **Indicadores** (`StatCard`): porcinos registrados (+ activos), corrales
  activos (+ ocupación/capacidad), movimientos del periodo, eventos sanitarios y
  camadas del periodo (+ promedio de nacidos vivos).
- **Gráficos** (Recharts, reutilizando los del dashboard):
  `AnimalStatusChart`, `PensOccupancyChart` y `MovementsByMonthChart`, más el
  nuevo `CategoryBarChart` genérico para sexo, origen, motivos y tipos de evento.
- **Tablas**: `PensOccupancyTable` (ocupación/capacidad por corral) y
  `ReportLittersTable` (camadas recientes del periodo).
- **Estados**: carga, error con «Reintentar», base vacía (0 confirmados) y
  **aviso de datos parciales** cuando se trunca la ocupación o las sumas de
  camadas.
- **Sección de exportaciones**: se mantiene como **referencia de S5-E2**
  (pendiente), sin prometer funcionalidad ya disponible.
- Se conserva la **referencia documental de KolkaPig** (códigos KPG-RG) al final.

## Archivos

**Backend — creados**

- `backend/src/modules/reports/reports.repository.ts`: repositorio de lectura
  agregado (conteos exactos + exploraciones acotadas; fail-closed por defecto).
- `backend/src/modules/reports/reports.service.ts`: lógica pura de periodo,
  agregación y banderas de honestidad (fecha `now` inyectable).
- `backend/src/modules/reports/reports.schemas.ts`: esquema Zod estricto de la
  consulta.
- `backend/src/modules/reports/reports.routes.ts`: `GET /reports/summary` con
  autenticación y rol operativo.
- `backend/tests/reports.service.test.ts` (**20 pruebas**).
- `backend/tests/reports.test.ts` (**18 pruebas**).

**Backend — modificados**

- `backend/src/app.ts`: opción `reportsRepository` y registro de `reportsRoutes`.
- `backend/src/server.ts`: creación de `createSupabaseReportsRepository(dataClient)`
  con el cliente por identidad (nunca `service_role`).

**Frontend — creados**

- `frontend/src/services/reports.service.ts` (+ `.test.ts`): contrato exacto de
  `GET /reports/summary`, guardas de tiempo de ejecución y constructor de consulta.
- `frontend/src/components/reports/CategoryBarChart.tsx`: gráfico de barras
  genérico para una distribución por categoría (reutiliza `ChartCard`).
- `frontend/src/components/reports/PensOccupancyTable.tsx`.
- `frontend/src/components/reports/ReportLittersTable.tsx`.
- `frontend/src/test/reports-fixtures.ts`: resúmenes de prueba (base vacía y
  granja con datos).
- `frontend/src/pages/ReportsPage.test.tsx` (**8 pruebas**).
- `docs/progreso/19_SPRINT_5_S5E1_REPORTES.md`: este documento.

**Frontend — modificados**

- `frontend/src/pages/ReportsPage.tsx`: pantalla funcional (filtros, indicadores,
  gráficos, tablas y estados), conservando la referencia KPG-RG.
- `frontend/src/config/navigation.ts`: descripción del módulo de reportes
  actualizada a «Indicadores, series y exportaciones».
- `docs/progreso/00_INDICE_Y_CONVENCIONES.md`: índice y estado del Sprint 5.

No se añadieron estilos nuevos: se reutilizan `chart-grid`, `stat-grid`,
`toolbar`, `data-table`, `card`, `report-grid`, `table-empty`, `chart-note`, etc.

## Pruebas automatizadas (con mocks; sin datos reales)

- `backend/tests/reports.service.test.ts` (**20 pruebas**): base vacía (ceros
  confirmados y `null`); periodo por defecto de 6 meses en UTC; distribuciones
  por estado/sexo/origen (incluido «sin registrar» derivado); propagación de los
  filtros de inventario; ocupación por corral; capacidad parcial (sin porcentaje);
  capacidad completa; truncamiento (métricas y tabla no calculables); ocupantes
  de corrales inactivos ignorados; recorte mensual sin doble conteo; filtro de
  motivo; camadas (sumas, incompletas, truncadas); validación del periodo
  (invertido/máximo/`maxMonths`); propagación de fallos.
- `backend/tests/reports.test.ts` (**18 pruebas**): `401` sin token; `403` para
  `viewer` e inactivo; `200` para admin/manager/operator/veterinarian; resumen
  con todas las secciones; consulta con el JWT del usuario (identidad RLS);
  propagación de filtros; solo lectura (sin create/update/insert/delete);
  validación de la consulta (`400` por enum/campo/formato inválidos; `400` por
  rango invertido y por rango > 12 meses); `503` sin repositorio y ante fallo.
- `frontend/src/services/reports.service.test.ts` (**9 pruebas**): contrato
  (válido, base vacía, tipos/enums/tasas/negativos inválidos), constructor de
  consulta (sin y con filtros) y consulta (URL, `ApiError`, respuesta inválida).
- `frontend/src/pages/ReportsPage.test.tsx` (**8 pruebas**): resumen con datos
  (indicadores, gráficos y tablas); base vacía (0 confirmados y estados vacíos);
  datos parciales (avisos de truncamiento); filtros (reconsulta con el filtro
  real); rango invertido (no consulta y advierte); «Actualizar»; error 503 con
  reintento; estado de carga.

## Verificación

- **Backend**: `tsc -p tsconfig.json --noEmit` **OK**;
  `vitest run` = **28 archivos / 514 pruebas OK, 3 archivos / 30 omitidas**
  (integración real *opt-in*, desactivadas por defecto);
  `tsc -p tsconfig.build.json` **OK**.
- **Frontend**: `tsc --noEmit` **OK**; `vitest run` = **25 archivos / 317
  pruebas OK**; `vite build` **OK** (aviso de tamaño de chunk, preexistente).

> El repositorio tiene cambios sin confirmar de etapas anteriores; estas pruebas
> se ejecutaron contra el estado actual del árbol de trabajo, no contra un commit.

## Limitaciones y pendientes

- **UTC vs. hora local**: las fechas se interpretan en UTC; falta alinear la
  presentación/filtros con `America/Lima` (pendiente transversal del proyecto).
- **Coste de las distribuciones**: cada distribución implica una consulta por
  valor de enum (sin `GROUP BY`/RPC). Es exacto y no descarga filas, pero no es
  la opción más barata; se revisará si se autoriza crear una vista/RPC.
- **Topes de exploración**: con granjas muy grandes, la ocupación por corral o
  las sumas de camadas pueden truncarse y se marcan como parciales (nunca se
  presentan como exactas).
- **Camadas recientes**: sólo se devuelven las 20 más recientes del periodo.
- **Sin PDF/Excel**: no implementados (S5-E2). La sección lo indica.
- Se avanzará a **S5-E2** (exportaciones) **solo tras aprobación**; S5-E1 queda
  cerrado sin avanzar automáticamente.

## Pasos para validar manualmente (solo lectura)

1. Levantar backend y frontend con credenciales de desarrollo.
2. `/reports`: comprobar indicadores, gráficos y tablas con datos reales; que un
   `0` sea un conteo y no una estimación.
3. Probar los filtros (fechas, motivo, tipo de evento, sexo, origen) y
   «Limpiar»; comprobar que un rango invertido se advierte sin consultar.
4. Revisar los estados vacíos (granja sin datos en el periodo) y, si aplica, el
   aviso de **datos parciales**.
5. Confirmar con `viewer` (o usuario inactivo) que la sección responde `403`, y
   sin sesión `401`.
6. Verificar que el resto de módulos y el asistente IA siguen funcionando (sin
   regresiones).
