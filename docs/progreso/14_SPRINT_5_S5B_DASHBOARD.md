# Sprint 5 — S5-B: dashboard con indicadores y gráficos reales

**Estado:** implementado y verificado (typecheck, pruebas y build de backend y
frontend). **Sin commit ni push.** No se modificó la base de datos, las
migraciones ni las políticas RLS; no se realizaron escrituras en Supabase; no se
llamó a Groq.

## Alcance

Conectar el dashboard con datos reales: cinco indicadores calculados en el
backend y tres gráficos responsive, sin inventar cifras y respetando los
permisos existentes. No se implementaron exportaciones ni el CRUD de los
módulos.

## Decisiones de diseño

- **Endpoint agregado `GET /dashboard/summary`.** Devuelve todos los
  indicadores en una sola respuesta, calculada en el backend con el JWT del
  usuario (RLS). El navegador nunca descarga los registros.
- **Read model dedicado** (`dashboard.repository.ts`): combina lecturas ya
  existentes. Se usan **conteos exactos** de PostgREST
  (`count: 'exact', head: true`) para no traer filas.
- **Corrales ocupados:** PostgREST no permite `DISTINCT` sin un RPC/vista (no
  se pueden crear objetos en la base en esta etapa). Se resuelve con una
  exploración **paginada y acotada** de `animals.current_pen_id` de los activos
  (`MAX_PEN_SCAN = 10000`). Si se alcanza el límite, el resultado se marca como
  parcial y la ocupación se presenta como **no calculable** (nunca como exacta).
- **Sin divisiones por cero:** `ocupación = ocupados/total` y
  `uso de capacidad = alojados/capacidad` son `null` si el denominador es 0 o si
  la métrica no es calculable.
- **Definiciones (documentadas, sin inventar esquema):**
  - *Porcino activo*: `animals.status = 'active'`.
  - *Corrales*: solo `pens.status = 'active'`; *ocupado* = tiene ≥1 porcino
    activo con ese `current_pen_id`.
  - *Capacidad*: suma de `pens.capacity` de los corrales activos con capacidad
    registrada.
  - *Movimientos del mes*: `animal_movements.moved_at` dentro del mes actual
    (UTC). *Eventos sanitarios del mes*: `health_events.occurred_at`.
  - *Camadas*: total y las registradas en el mes por `litters.birth_date`.
  - *Periodo del gráfico de movimientos*: 6 meses recientes, terminando en el
    mes actual.
- **Recharts** (`recharts@^3.10.1`) para los tres gráficos, por ser compatible
  con React 19 y Vite 8.

## Endpoints

- **Nuevo:** `GET /dashboard/summary` (solo lectura). `preHandler`:
  autenticación JWT + rol operativo **activo** (admin, manager, operator,
  veterinarian). `viewer`, usuarios inactivos y peticiones sin token reciben
  401/403. Sin parámetros de entrada.
- **Reutilizados (indirectamente), vía repositorios:** `animals`, `pens`,
  `animal_movements`, `health_events`, `litters` (RLS con el JWT del usuario).
- No se usó `service_role` ni se expusieron claves privadas.

## Indicadores implementados

1. **Porcinos activos** (`animals.active`), con total registrado.
2. **Ocupación de corrales**: corrales activos, ocupados y porcentaje; y, si hay
   capacidad registrada, alojados frente a capacidad y su utilización.
3. **Movimientos del mes** (`moved_at`).
4. **Eventos sanitarios del mes** (`occurred_at`).
5. **Camadas registradas**: total y del mes.

## Gráficos implementados

- **A. Distribución de porcinos por estado** (barras, 6 estados del enum, con
  leyenda y total).
- **B. Ocupación de corrales** (ocupados vs. libres, con nota de utilización de
  capacidad cuando existe).
- **C. Movimientos por mes** (barras, periodo reciente de 6 meses
  explícitamente indicado).

Los tres tienen título, descripción, etiquetas y **estado vacío** ("Aún no hay…",
"Sin datos suficientes…").

## Archivos

**Backend (creados)**
- `backend/src/modules/dashboard/dashboard.repository.ts`
- `backend/src/modules/dashboard/dashboard.service.ts`
- `backend/src/modules/dashboard/dashboard.routes.ts`
- `backend/tests/dashboard.service.test.ts`
- `backend/tests/dashboard.test.ts`

**Backend (modificados)**
- `backend/src/app.ts` (opción `dashboardRepository` y registro de rutas)
- `backend/src/server.ts` (creación del repositorio con el cliente por solicitud)

**Frontend (creados)**
- `frontend/src/services/dashboard.service.ts`
- `frontend/src/components/dashboard/ChartCard.tsx`
- `frontend/src/components/dashboard/chart-utils.ts`
- `frontend/src/components/dashboard/AnimalStatusChart.tsx`
- `frontend/src/components/dashboard/PensOccupancyChart.tsx`
- `frontend/src/components/dashboard/MovementsByMonthChart.tsx`
- `frontend/src/services/dashboard.service.test.ts`
- `frontend/src/pages/DashboardPage.test.tsx`
- `frontend/src/test/dashboard-fixtures.ts`

**Frontend (modificados)**
- `frontend/src/pages/DashboardPage.tsx` (indicadores y gráficos reales)
- `frontend/src/components/ui/StatCard.tsx` (estados de actualización y "Sin
  datos suficientes"; se eliminó "Pendiente")
- `frontend/src/styles/global.css` (rejilla de gráficos, leyendas, estados)
- `frontend/src/test/setup.ts` (stub de `ResizeObserver` para Recharts)
- `frontend/package.json` y `frontend/package-lock.json` (dependencia Recharts)

## Comportamiento con base de datos vacía

- Los cinco indicadores muestran **0** (conteo confirmado), no cifras ficticias.
- La ocupación se muestra como **"Sin corrales registrados"** (no 0 %) y la
  utilización de capacidad como "sin capacidad registrada".
- Los tres gráficos muestran su estado vacío.
- Se añade un aviso informativo aclarando que los ceros son conteos reales.

## Pruebas y evidencia

| Verificación | Comando | Resultado |
|---|---|---|
| Backend · typecheck | `npm run typecheck` | Correcto |
| Backend · pruebas | `npm test` | **474 aprobadas**, 30 omitidas (26 archivos) |
| Backend · build | `npm run build` | Correcto (`dist/`) |
| Frontend · typecheck | `npm run typecheck` | Correcto |
| Frontend · pruebas | `npm test` | **68 aprobadas** (11 archivos) |
| Frontend · build | `npm run build` | Correcto (`dist/`) |

Cobertura de pruebas añadida:
- Autenticación (401) y permisos (403 para `viewer` e inactivo; 200 para los
  cuatro roles operativos).
- Cálculo de indicadores y distribución por estado.
- Ocupación **sin dividir por cero** (sin corrales, sin capacidad) y exploración
  parcial.
- Fechas y agrupación mensual (periodo de 6 meses, rango del mes).
- **Base de datos vacía** (backend y frontend).
- **Fallos de API** (503 → estado de error con reintento).
- Fallo del repositorio → 503 (no se inventa un resumen).
- Renderizado del frontend (indicadores, gráficos, estados vacíos, actualización).

## Restricciones respetadas

No se insertaron, modificaron ni eliminaron datos; no se modificó la base de
datos ni las migraciones; no se ejecutaron escrituras en Supabase; no se crearon
estadísticas ficticias; no se llamó a Groq; no se hizo commit ni push; no se
implementaron CRUD ni exportaciones.

## Limitaciones pendientes

- **Validación manual en el navegador** con una cuenta real (login → dashboard).
- **Tamaño del bundle**: Recharts eleva el chunk principal (~884 kB, gzip
  ~256 kB); conviene dividir el código (`import()` dinámico) en una etapa
  posterior.
- La ocupación depende de una exploración acotada (no hay `DISTINCT` en
  PostgREST sin RPC/vista). Para volúmenes muy altos quedaría como "no
  calculable"; una vista/RPC sería la solución definitiva (requiere aprobación
  de migración).
- Los rangos de fecha usan **UTC**; si el negocio requiere zona horaria local
  (America/Lima), habrá que fijarlo de forma explícita.

## Verificación manual en el navegador

1. Backend: `cd backend` → `npm run dev` (escucha en `http://127.0.0.1:3000`).
2. Frontend: `cd frontend` → `npm run dev` (`http://127.0.0.1:5173`).
3. Iniciar sesión con una cuenta operativa real.
4. En el dashboard: comprobar los cinco indicadores, el aviso de actualización y
   los tres gráficos. Pulsar **Actualizar** y verificar la hora de "Actualizado".
5. Con la base vacía: verificar que los valores son **0** y que los gráficos
   muestran sus estados vacíos.
6. Probar en móvil/tablet (la rejilla pasa a una columna) y confirmar que la
   navegación, la autenticación y el chatbot siguen funcionando.
