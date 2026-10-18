# Sprint 6 — S6-A: Auditoría y preparación de pruebas integrales

**Estado:** auditoría completada. **Sin commit ni push.** **No se escribió en
Supabase**, no se ejecutó SQL, no se tocaron migraciones, RLS ni `.env`, no se
llamó a Groq. Se ejecutaron únicamente verificaciones locales seguras
(`typecheck`, `build` y `npm test` de backend y frontend). **No se implementó
ninguna funcionalidad.**

**Objetivo de la etapa:** decidir si el sistema está listo para ejecutar pruebas
funcionales completas con datos sintéticos en el Supabase de desarrollo
(PigTecBD), y dejar preparado el plan.

> **Actualización (S6-A.2):** el responsable ejecutó el verificador de solo
> lectura y **confirmó que los mecanismos de 006/007/008 están presentes** en
> PigTecBD; **R-01 queda resuelto**. Ver
> `docs/progreso/24_SPRINT_6_S6A2_CIERRE_AUDITORIA_Y_RESPALDO_GIT.md`. El resto
> de este documento refleja el estado de la etapa S6-A.

---

## 0. Resumen ejecutivo

- **Código, compilación y pruebas locales: sanos.** Backend y frontend
  compilan y pasan sus suites (resultados en la sección 10).
- **La arquitectura de seguridad es correcta por diseño y por revisión
  estática:** ninguna capa usa `service_role`; todos los repositorios abren un
  cliente por petición con el JWT del usuario (RLS con su identidad); las rutas
  exigen autenticación y rol; las entradas se validan con Zod estricto; el
  historial no concede `UPDATE`/`DELETE`.
- **Bloqueante principal:** el **estado real de las migraciones 006, 007 y 008
  en PigTecBD no se puede verificar desde el entorno local** y la documentación
  del propio repositorio se contradice (ver riesgo R-01). Si 006/007 no están
  aplicadas, **camadas y sanidad están denegadas por RLS**; si 008 no está
  aplicada, **`POST /animals` sin `animal_code` falla**. Esto condiciona toda la
  fase de escritura.
- **Riesgo alto:** casi todo el trabajo de Sprint 2/5 (incluido **todo `frontend/`**)
  está **sin commitear**. Ver R-02.
- **Riesgo alto:** el historial (movimientos y sanidad) es **inmutable por
  diseño**, de modo que **los datos de escritura de una prueba E2E no se pueden
  limpiar** por API. La estrategia de limpieza es necesariamente limitada
  (sección 5).
- **Conclusión:** el sistema está listo para la **fase 1 (local, sin escritura)**.
  Las fases con escritura **requieren autorización explícita** y, antes, resolver
  R-01 y R-02.

---

## 1. Inventario del sistema (estado actual)

### 1.1 Frontend (`frontend/`, React 19 + TS + Vite 8)

- **Rutas** (`src/App.tsx`): `/login` (`PublicOnlyRoute`), y bajo
  `ProtectedRoute → AppLayout`: `/` (dashboard), `/areas`, `/animals`,
  `/movements`, `/litters`, `/health`, `/reports`, `/users` (además
  `RequireRole(['admin'])`) y `*` (404). **No hay registro público.**
- **Autenticación** (`src/context/AuthProvider.tsx`): sesión de Supabase Auth;
  el **rol se lee del backend** (`GET /auth/profile`), **nunca del JWT**. Un
  perfil no operativo o inactivo se rechaza (fail-closed).
- **Autorización de UI**: `RequireRole` solo protege `/users`; el resto de
  escrituras se ocultan por `profile.role` dentro de cada página (espejo del
  backend). `canManageCatalog`/`canManageAnimals` = admin/manager;
  `canWriteLitters` = admin/manager/operator; sanidad y movimientos por
  tipo/motivo según matriz.
- **Servicios**: uno por módulo (`auth`, `assistant`, `dashboard`, `reports`,
  `reports-export`, `animals`, `areas`, `pens`, `movements`, `litters`,
  `health-events`), todos vía `lib/http.ts` (Bearer JWT, `401`→cierre de sesión,
  descarga de ficheros con `getFile`).
- **Chatbot** (`components/assistant/`): `POST /assistant/chat`; la respuesta se
  renderiza con `AssistantMarkdown` (párrafos, listas y **negrita**; HTML
  escapado; ver 7.3).
- **Páginas operativas funcionales:** dashboard, áreas/corrales, porcinos
  (lista/alta/detalle/edición/estado), movimientos + trazabilidad, camadas,
  sanidad + historial del porcino, reportes + exportaciones.
- **`/users` es un marcador de posición** (`ModulePlaceholder`): no hay gestión
  de usuarios en la UI ni API expuesta.
- **Estado vacío**: presente en todas las listas, gráficos y modales (sección 7.5).

### 1.2 Backend (`backend/`, Node + Fastify + Zod)

- **38 endpoints REST** repartidos en `src/modules/*`. Todos los protegidos
  usan `authenticate` (JWT verificado contra Supabase Auth) + `requireRole`
  (rol y `is_active` **leídos de `public.profiles`** con el JWT del usuario).
- **Repositorios**: un cliente PostgREST **nuevo por petición** con el
  `accessToken` del usuario. La interfaz `PostgrestQuery` **no expone `delete`
  ni `rpc`** (imposible borrar o invocar RPC por construcción). **No existe
  `service_role` en ningún punto** (verificado por búsqueda y por prueba
  automatizada). El único cliente compartido es un cliente **anon** usado solo
  para verificar el JWT (`auth.getUser`).
- **Validación**: esquemas Zod estrictos (`.strict()`), rechazan campos no
  permitidos (`animal_code`, `status`, `current_pen_id`, `recorded_by`, etc.).
- **Autorización por acción** además del rol de ruta: matriz por **motivo** de
  movimiento y por **tipo** de evento sanitario.
- **Fallos controlados**: repositorio ausente o con error → `503`
  (fail-closed); nunca se inventan cifras.

### 1.3 Migraciones y RLS (`database/migrations/`)

| Migración | Contenido | Estado declarado en el repo |
|---|---|---|
| 001 | Esquema inicial + RLS base + `profile_select_own` | Aplicada (S6-B) |
| 002 | Aprovisionamiento de perfiles + RPC admin + auditoría | Aplicada y validada |
| 003 | RLS de `areas`/`pens` | Aplicada (6 políticas) |
| 004 | RLS de `animals` | Aplicada |
| 005 | Integridad de movimientos + columnas derivadas + RLS | Aplicada |
| 006 | RLS de `litters` | **«Propuesta, NO ejecutada»** en el README de migraciones |
| 007 | RLS de `health_events` | **Sin entrada en el README de migraciones** |
| 008 | Generación de `animal_code` (secuencia + trigger) | **Sin entrada en el README de migraciones** |

> **Contradicción documental (R-01):** `database/migrations/README.md` afirma que
> 006 está «propuesta, NO ejecutada» y no menciona 007/008; en cambio,
> `database/verification/sprint4_transactional_check.sql` y
> `docs/progreso/18_...` asumen 001–008 ya aplicadas. **No hay forma de
> confirmarlo sin acceso SQL (solo lectura) al proyecto.**

### 1.4 Módulos operativos, dashboard, reportes y exportaciones

- **Dashboard** (`GET /dashboard/summary`): 5 indicadores + 3 gráficos, lectura
  agregada; ocupación por exploración acotada; `null` = no calculable (nunca 0).
- **Reportes** (`GET /reports/summary`): indicadores, distribuciones (conteos
  exactos por enum), series y tablas; filtros `from`/`to`,
  `movement_reason`, `health_event_type`, `sex`, `origin`; máx. 12 meses.
- **Exportaciones** (`GET /reports/export/excel`, `GET /reports/export/pdf`):
  Excel de 7 hojas y 5 PDF (KPG-RG), generados **en el backend con el JWT**,
  saneado anti-fórmulas, avisos de truncamiento y estados vacíos explícitos.
- **Asistente** (`POST /assistant/chat`): 1) respuesta local determinista; 2)
  consulta de datos determinista (resumen por estado, ficha por código,
  movimientos recientes); 3) proveedor Groq con cuota diaria. Solo lectura.

---

## 2. Flujos críticos de extremo a extremo (a comprobar)

| # | Flujo | Endpoints | Rol(es) | Tocará BD |
|---|---|---|---|---|
| F1 | Autenticación y autorización | `GET /auth/me`, `GET /auth/profile` | cualquiera / operativo | lectura |
| F2 | Áreas y corrales | `GET/POST/PATCH/DELETE /areas`, `/pens` | lectura operativa; escritura admin/manager | lectura + escritura |
| F3 | Porcinos | `GET/POST/PATCH /animals`, `PATCH /animals/:id/status`, `/location` | lectura operativa; escritura admin/manager | lectura + escritura |
| F4 | Movimientos y trazabilidad | `GET /movements`, `GET /animals/:id/movements`, `POST /movements` | operativo; motivo↔rol | lectura + escritura |
| F5 | Camadas | `GET/POST/PATCH /litters`, `/offspring` | lectura operativa; escritura admin/manager/operator | lectura + escritura |
| F6 | Sanidad | `GET/POST /health-events`, `/animals/:id/health-events` | operativo; tipo↔rol | lectura + escritura |
| F7 | Dashboard | `GET /dashboard/summary` | operativo | lectura |
| F8 | Reportes | `GET /reports/summary` | operativo | lectura |
| F9 | Exportaciones Excel/PDF | `GET /reports/export/excel`, `/pdf` | operativo | lectura |
| F10 | Asistente | `POST /assistant/chat` | operativo | lectura / Groq |

**Criterios transversales de aprobación (todos los flujos):** sin JWT `401`;
`viewer` o inactivo `403`; cuerpo inválido `400` (antes de tocar la BD); datos
ajenos o no visibles `404`/vacío; fallo de datos `503` sin inventar cifras;
nunca `5xx` por un error de validación.

---

## 3. Matriz de pruebas integrales

Leyenda de tipo: **LOCAL** = se puede ejecutar ya sin escribir ni tocar Supabase ·
**R** = integración de solo lectura (opt-in) · **W** = integración con escritura
(opt-in, requiere autorización) · **SQL** = verificación transaccional manual
`BEGIN…ROLLBACK` · **MOCK** = ya cubierta por pruebas automatizadas con dobles.

| Flujo | Caso | Tipo | Prueba / método existente | Criterio |
|---|---|---|---|---|
| F1 | `401` sin token / token inválido | LOCAL | `sprint4.readonly.integration` + `auth.*` | `401` |
| F1 | Perfil activo de cada rol | R | `GET /auth/profile` (E2E read) | `200` + rol correcto |
| F1 | `viewer`/inactivo denegado | R | E2E read (con `PIGTEC_E2E_VIEWER_TOKEN`) | `403` |
| F2 | Listar áreas/corrales | R | E2E read | `200` |
| F2 | Alta/edición/baja lógica | W | `sprint4.write.integration`; validar `canManageCatalog` | `201`/`200` |
| F2 | `operator` no escribe catálogo | MOCK | `areas.test`, `pens.test` | `403` |
| F3 | Alta sin `animal_code` → `PIG-XXXXXX`, `created_by` del JWT | W + SQL | `sprint4.write.integration` (1), `sprint4_transactional_check` (2) | código `PIG-\d{6}`, inmutable |
| F3 | `animal_code` inmutable | W | write (8), SQL (10) | `400`/rechazo |
| F3 | Estados derivados no editables | MOCK + SQL | `animals.test`, SQL (0.b, guardia) | rechazo |
| F4 | Movimiento interno deriva `current_pen_id` | W + SQL | write (2), SQL (4) | ubicación cambia |
| F4 | Movimiento inválido no altera al animal | W + SQL | write (3), SQL (5–8, 8.b) | `400`/`422`, sin rastro |
| F4 | Matriz motivo↔rol (venta solo admin/manager, etc.) | MOCK | `movements.test` | `403` correcto |
| F4 | Historial inmutable | SQL | SQL (9a, 9b) | rechazo |
| F5 | Camada válida (madre hembra / padre macho) | W (o SQL) | write (4), SQL (12) | `201` |
| F5 | Cantidades incoherentes / sexos incorrectos | W + SQL | write (5), SQL (11) | `400`/rechazo |
| F5 | **Requiere RLS 006** | W | — | ver R-01 |
| F6 | Evento por rol/tipo; mortalidad deriva `dead` | W (o SQL) | write (6, 7), SQL (13) | `201`; `dead`+`exit_date`+`pen=NULL` |
| F6 | Segundo evento sobre muerto | W | write (7) | `400` |
| F6 | **Requiere RLS 007** | W | — | ver R-01 |
| F7 | Indicadores/gráficos con datos | R | `GET /dashboard/summary` | cifras coherentes; capacidad parcial sin % |
| F7 | Base vacía → 0 confirmados | MOCK | `dashboard.service.test`, `DashboardPage.test` | `0`, no `—` |
| F8 | Agregados y filtros | R | `GET /reports/summary` | sumas cuadran |
| F8 | Rango invertido / >12 meses | MOCK | `reports.test`, `reports.service.test` | `400` |
| F9 | Excel 7 hojas / PDF 5 tipos | R | descargar y abrir | cabeceras, KPG-RG, totales |
| F9 | Fórmulas inertes, conjunto vacío | MOCK | `reports-export.service.test` | ya cubierto |
| F10 | Resumen/ficha/movimientos con datos reales | R | `POST /assistant/chat` | respuestas coherentes |
| F10 | Solo lectura, sin cuota en local/data | MOCK | `assistant.data.test` | sin escritura |

---

## 4. Escenario mínimo y coherente de datos SINTÉTICOS

Marcas obligatorias: nota y/o nombre con **`[SINT S6-A]`** y un `RUN_ID`
(`S6A-<timestamp>`). Nunca mezclar con datos reales. Orden de creación
respetando claves foráneas y reglas de negocio.

### 4.1 Catálogo

| Entidad | Datos | Para qué |
|---|---|---|
| Área | `[SINT S6-A] Área <RUN_ID>` | contenedor |
| Corral A | `code=VS-A`, `capacity=20`, activo | capacidad completa |
| Corral B | `code=VS-B`, `capacity=10`, activo | segundo destino |
| Corral C | `code=VS-C`, **sin capacidad**, activo | **capacidad parcial** (no calcular %) |
| Corral D | `code=VS-D`, **inactivo** | probar reglas de destino/estado |

### 4.2 Porcinos (padres antes que crías; `animal_code` autogenerado)

| Alias | sexo | origin | estado inicial | corral | uso |
|---|---|---|---|---|---|
| F1 | female | born_on_farm | active | A | madre de L1 |
| F2 | female | purchased | active | A | madre de L2 |
| M1 | male | born_on_farm | active | B | padre de L1 |
| M2 | male | unknown | active | B | padre opcional |
| X1 | unknown | transferred_in | active | — | luego `missing` |
| Y1 | male | born_on_farm | active | A | se vende (deriva `sold`) |
| Z1 | unknown | unknown | active | — | mortalidad (deriva `dead`) |
| N1 | female | born_on_farm | active | A | recién nacida, `litter_id = L1` |

### 4.3 Camadas (madre hembra / padre macho)

- **L1**: `mother=F1`, `father=M1`, `total_born=12`, `born_alive=10`,
  `stillborn=2`, `birth_date` = hoy−10 d. → **completa**.
- **L2**: `mother=F2`, sin padre, `total_born=8`, sin `born_alive`/`stillborn`
  → **incompleta** (para probar el flag `complete=false`).

### 4.4 Movimientos (matriz motivo↔rol)

| Motivo | Actor | De→A | Efecto |
|---|---|---|---|
| `weaning` | operator | F1 A→B | interno válido |
| `health_isolation` | veterinarian | F2 A→C | aislamiento |
| `management` | manager | M1 B→C | interno |
| `sale` | admin | Y1 A→∅ | deriva `sold`, sin destino |
| `transfer` (con destino) | manager | M2 B→A | interno con destino |

### 4.5 Eventos sanitarios (matriz tipo↔rol)

| Tipo | Actor | Sobre |
|---|---|---|
| `observation` | operator | F1 |
| `treatment` | veterinarian | F2 |
| `vaccination` | veterinarian | N1 |
| `mortality` | manager/veterinarian | Z1 |
| `symptom_report` | operator | X1 (missing) |

**Cobertura resultante:** estado de porcinos (active/sold/dead/missing), sexo,
origen (4 valores + NULL), ocupación por corral, **capacidad parcial**,
movimientos por mes/motivo, eventos por tipo, camadas completas e incompletas,
y datos para Excel/PDF y para el asistente.

### 4.6 Propuesta de seed (NO ejecutar sin autorización)

`database/seeds/` está vacío. Se propone, para **S6-B**, un seed idempotente
parametrizado por `RUN_ID` con estas reglas:

```sql
-- PROPUESTA. NO ejecutada. Solo en PigTecBD. Requiere autorización.
-- Marca común: '[SINT S6-A]' y RUN_ID. Orden: areas -> pens -> animals
-- (padres antes) -> litters -> movements -> health_events.
-- INSERT ... ; (usar CTE o variables para capturar los UUID devueltos).
```

> El seed **debe** ejecutarse con la identidad de un admin/manager real vía API
> (no con `service_role`) para que las pruebas ejerciten también la RLS. La
> alternativa sin escribir es el guion `BEGIN…ROLLBACK` de la sección 5.

---

## 5. Plan de ejecución por fases

### Fase 0 — Resolución de bloqueantes (previa, sin código)
- **Resultado esperado:** confirmar (solo lectura, en el SQL Editor o el
  Dashboard, con autorización) si 006/007/008 están aplicadas; y decidir qué
  hacer con el trabajo sin commitear.
- **Criterio de aprobación:** el responsable confirma que PigTecBD tiene 006,
  007 y 008 aplicadas (o autoriza aplicarlas), y decide sobre el commit.
- **Bloquea:** Fases 2 y 3.

### Fase 1 — Verificación local (sin Supabase) — **se puede ejecutar YA**
- `typecheck`, `build` y `npm test` de backend y frontend (ya ejecutados; ver
  sección 10).
- Arranque local de backend + frontend con credenciales de desarrollo (solo
  navegación; no escribe).
- **Resultado esperado:** todo verde; sin accesos no autorizados.
- **Criterio de aprobación:** 0 fallos de compilación/typecheck/pruebas.

### Fase 2 — Integración de SOLO LECTURA (opt-in)
- `PIGTEC_E2E_BASE_URL` + `PIGTEC_E2E_TOKEN` (+ `PIGTEC_E2E_VIEWER_TOKEN`),
  `npm run test:integration`. No escribe.
- Lectura manual de `/dashboard`, `/reports`, exportaciones y asistente.
- **Resultado esperado:** `401`/`403` correctos; datos reales coherentes; las
  exportaciones descargan y se abren.
- **Criterio de aprobación:** suite de lectura en verde; sin efectos secundarios.

### Fase 3 — Verificación de reglas en base (SQL transaccional, manual)
- Ejecutar `database/verification/sprint4_transactional_check.sql`
  (`BEGIN…ROLLBACK`) **como propietario**, tras confirmar PigTecBD.
- **Resultado esperado:** lista `OK n: …` completa y `ROLLBACK`.
- **Criterio de aprobación:** todos los `OK`; aviso de saltos de secuencia
  aceptado (documentado).
- **Nota:** consume 2 valores de la secuencia aunque revierta (admitido).

### Fase 4 — Integración CON ESCRITURA (opt-in, autorización explícita)
- `PIGTEC_E2E_WRITE=1`, token admin/manager; `movements.integration` y
  `sprint4.write.integration`.
- **Resultado esperado:** alta/movimiento/camada/sanidad según contrato.
- **Criterio de aprobación:** suites en verde; datos marcados `[PRUEBA E2E …]`.
- **Advertencia:** deja **filas permanentes e inmutables** (sección 6/5.7).

### Fase 5 — Flujos de UI con datos sintéticos
- Navegar cada módulo con el escenario de la sección 4; comprobar estados
  vacíos, parciales, permisos por rol y exportaciones.
- **Criterio de aprobación:** sin regresiones; la UI coincide con el backend.

### 6.6 Limpieza de datos sintéticos

**Hechos que condicionan la limpieza (verificados por revisión estática):**
- `animal_movements`: sin `UPDATE`/`DELETE` y con trigger de inmutabilidad que
  **rechaza el `DELETE` incluso para el propietario**. **No se puede limpiar.**
- `health_events`: sin `UPDATE`/`DELETE` para `authenticated`; el propietario
  podría borrar, pero **no se recomienda** (historial).
- `litters`, `animals`, `areas`, `pens`: **sin privilegio `DELETE`** en RLS; el
  backend solo hace **baja lógica** (`status='inactive'`). `ON DELETE RESTRICT`
  impide además borrar catálogo referenciado.
- Conclusión: **una corrida E2E de escritura no es reversible por API.** La
  “limpieza” real solo puede ser: (a) usar un **proyecto de desarrollo
  dedicado**, (b) baja lógica de animales/áreas/corrales marcados, o (c) un
  `DELETE` manual del **propietario** con autorización explícita (y, para
  movimientos, inhabilitando el trigger: **no recomendado**).

**Consulta de identificación de datos sintéticos (solo lectura, para acotar la
limpieza a lo marcado; nunca borra nada por sí sola):**

```sql
-- Localizar SOLO lo marcado [SINT S6-A] o [PRUEBA E2E …]
SELECT 'area' AS t, id, name FROM public.areas WHERE name LIKE '%[SINT S6-A]%' OR name LIKE '%[PRUEBA E2E%'
UNION ALL SELECT 'pen', id, code FROM public.pens WHERE code LIKE '%E2E-%' OR name LIKE '%[SINT S6-A]%'
UNION ALL SELECT 'animal', id, animal_code FROM public.animals WHERE notes LIKE '%[SINT S6-A]%' OR ear_tag_code LIKE 'E2E%'
UNION ALL SELECT 'litter', id, coalesce(litter_code,'') FROM public.litters WHERE notes LIKE '%[SINT S6-A]%' OR notes LIKE '%[PRUEBA E2E%'
UNION ALL SELECT 'health', id, title FROM public.health_events WHERE notes IS NULL AND title LIKE '%[SINT S6-A]%' OR title LIKE '%[PRUEBA E2E%';
```

**Reglas de una eventual limpieza (requiere autorización, la ejecuta el
propietario):** borrar **solo** filas identificadas por la marca; respetar el
orden `health_events → animal_movements(no posible) → litters → animals → pens →
areas`; nunca borrar datos sin marca; no usar `service_role` desde la app; y
documentar las filas borradas. **Los movimientos quedarán.** Por ello la
recomendación es **no** usar escritura sobre un entorno compartido.

---

## 6. Protección de las operaciones de escritura (revisión)

Todas las escrituras (sección 1.2) están protegidas por **cuatro capas**:

| Capa | Mecanismo | Estado |
|---|---|---|
| Autenticación | `authenticate` exige JWT válido de Supabase Auth | OK (fail-closed) |
| Autorización | `requireRole` lee rol+`is_active` de `profiles`; matrices por acción | OK |
| Validación | Zod `.strict()`; rechaza campos derivados y desconocidos | OK |
| RLS | cliente por petición con el JWT; políticas por tabla (003–007) | OK **si 003–007 están aplicadas** (ver R-01) |
| Integridad | triggers de derivación + guardia de columnas + inmutabilidad | OK (005/008, si aplicadas) |

No se encontró ningún camino con `service_role`, SQL arbitrario ni escritura
desde el asistente (solo herramientas de lectura).

---

## 7. Problemas conocidos revisados

### 7.1 Métricas de capacidad parcial — **correcto**
Dashboard y reportes no calculan porcentaje si falta capacidad en algún corral
activo (`partial:true`, porcentaje `null`); la tabla por corral lo advierte. En
granjas muy grandes la exploración acotada puede truncarse y marcar la métrica
como no calculable. No es un defecto a corregir: es honestidad de datos. Mejora futura: vista/RPC (requiere migración).

### 7.2 «Resumen general de la granja» del chatbot — **inconsistencia de UX (R-05)**
La sugerencia de la UI (`AssistantPanel.tsx` línea 31) **no coincide** con
ninguna frase de `SUMMARY_PHRASES` (`assistant.data-answers.ts`), por lo que
**no se responde de forma determinista**: cae al proveedor Groq y, si no hay
clave configurada, devuelve `502`. Además, el resumen determinista solo cubre
**porcinos por estado** (no corrales, movimientos ni sanidad). Acción propuesta
(no implementada): alinear la sugerencia con una frase reconocida (p. ej.
«resumen de porcinos por estado») y/o ampliar el resumen. **Requiere
aprobación.**

### 7.3 Respuestas Markdown escapadas — **mayormente resuelto, con límites (R-06)**
`AssistantMarkdown` renderiza párrafos, listas (`-`, `*`, `•`) y negrita,
**decodifica entidades** y **quita escapes** (`\*\*texto\*\*`), y **escapa el
HTML** (sin XSS, verificado por prueba). **No soporta** código en línea
(`` ` ``), cursiva con un asterisco, encabezados, enlaces ni tablas: se muestran
literales. Impacto: cosmético. Las respuestas deterministas (listas con `- `)
se ven bien.

### 7.4 Consistencia de fechas — **inconsistencia real (R-04)**
Almacenamiento en UTC (correcto). Pero: **dashboard y reportes** interpretan
`from`/`to` como **días UTC** y muestran UTC; **movimientos, camadas y sanidad**
convierten `datetime-local` local ↔ ISO y muestran hora **local**
(`America/Lima`, UTC−5). Un registro de las 20:00 locales del día 15 es
`01:00Z` del día 16: puede caer en el día equivocado en reportes/dashboard.
Acción propuesta (no implementada): fijar una convención única (día local) en el
backend de reportes.

### 7.5 Estados vacíos — **correcto**
Presentes en listas, gráficos, tablas y modales, con distinción «sin datos» vs
«sin coincidencias». Los documentos Excel/PDF muestran cabeceras y un mensaje
explícito cuando el conjunto está vacío.

### 7.6 Otros
- **R-07** `/users` es un marcador; el flujo de solicitudes de alta de
  `operator` (`animal_registration_requests`, migración pendiente) **no existe**.
- **R-08** Cuota del asistente **en memoria por proceso** (no compartida; se
  reinicia con el servidor; reset 00:00 UTC).
- **R-09** Bundle del frontend ~1 MB (aviso de Vite); duplicación de helpers de
  fecha (`lib/dates.ts` vs `components/movements/labels.ts`); `Header.tsx`
  menciona `GET /auth/me` aunque el código usa `/auth/profile` (doc).
- **R-10** `GET /animals` no pagina explícitamente en algunos catálogos de apoyo.

---

## 8. Riesgos priorizados

| ID | Prioridad | Riesgo | Impacto | Mitigación propuesta |
|---|---|---|---|---|
| R-01 | **Crítico / bloqueante** | Estado real de 006/007/008 incierto; README contradictorio | Sin 006/007 camadas y sanidad quedan denegadas por RLS; sin 008 falla el alta de porcinos (E2E de escritura inviable) | **Resuelto en S6-A.2:** presencia de 006/007/008 confirmada en PigTecBD (solo lectura) y README actualizado |
| R-02 | **Crítico** | **Frontend completo y gran parte del backend sin commitear** (último commit `dfad81c`) | Pérdida de trabajo | Commit revisado (requiere aprobación; **no** se hizo) |
| R-03 | **Alto** | Historial inmutable ⇒ los datos de escritura E2E **no se limpian** | Datos permanentes en el entorno | Preferir proyecto de desarrollo dedicado; baja lógica; autorización explícita |
| R-04 | **Alto** | UTC vs `America/Lima` entre reportes/dashboard y módulos | Métricas/registros en el día equivocado | Fijar convención de día local en reportes |
| R-05 | Medio | Sugerencia del chatbot no reconocida → depende de Groq / `502` | UX confusa | Alinear sugerencia con frase reconocida |
| R-06 | Medio | Markdown parcial (backticks, cursiva, enlaces, tablas) | Cosmético | Ampliar el renderizador (opcional) |
| R-07 | Medio | Sin gestión de usuarios en UI ni flujo de solicitudes de alta | Flujos de F1/F3 incompletos de extremo a extremo | Planificar Etapa 2 |
| R-08 | Medio | Cuota del asistente por proceso | Límite real multiplicado por instancia | Contador compartido antes de escalar |
| R-09 | Bajo | Bundle grande, helpers duplicados, doc `auth/me` | Mantenibilidad | Refactor posterior |
| R-10 | Bajo | Catálogos sin paginación | Etiquetas parciales con inventario grande | Paginación explícita |

---

## 9. Acciones que requieren autorización explícita del usuario

1. Confirmar **en solo lectura** el estado de 006/007/008 en PigTecBD (o
   autorizar su aplicación) — **desbloquea las Fases 3–5**.
2. Decidir sobre el **commit** del trabajo pendiente (R-02). *(No se hizo.)*
3. Autorizar la **integración de escritura** (`PIGTEC_E2E_WRITE=1`) y el uso de
   un token admin/manager, asumiendo que **dejará datos permanentes**.
4. Autorizar la ejecución del guion **`BEGIN…ROLLBACK`** de verificación SQL.
5. Aprobar cualquier **corrección** sobre R-04 (fechas), R-05 (chatbot) o R-06
   (Markdown), que hoy **no** se han implementado.
6. Decidir el **entorno** de las pruebas con escritura (proyecto dedicado vs
   PigTecBD) y la estrategia de limpieza (sección 6.6).

---

## 10. Verificación local ejecutada (evidencia real)

Comandos ejecutados en el árbol de trabajo actual (sin variables
`PIGTEC_E2E_*`, por lo que las suites de integración quedan omitidas):

| Comando | Directorio | Resultado |
|---|---|---|
| `npm run typecheck` | `backend` | OK |
| `npm test` | `backend` | **31 archivos / 580 pruebas OK; 3 archivos / 30 omitidas** |
| `npm run build` | `backend` | OK |
| `npm run typecheck` | `frontend` | OK |
| `npm test` | `frontend` | **26 archivos / 339 pruebas OK** |
| `npm run build` | `frontend` | OK (aviso de chunk ~1 MB, preexistente) |

**Clasificación de las 34 suites del backend:**
- **29 con mocks** (sin red): 16 construyen la app con repositorios inyectados,
  4 prueban servicios directos, 6 prueban repositorios con clientes falsos, 1
  usa `Fastify()` con middleware inyectado, 1 usa `fetch` simulado, 1 prueba
  configuración pura.
- **1 de lectura real (opt-in):** `sprint4.readonly.integration.test.ts`
  (requiere `PIGTEC_E2E_BASE_URL` + `PIGTEC_E2E_TOKEN`).
- **2 de escritura real (opt-in):** `movements.integration.test.ts` y
  `sprint4.write.integration.test.ts` (además `PIGTEC_E2E_WRITE=1`).
- **2 estáticas** (sin BD): `animal-code.migration.test.ts`,
  `sprint4.sql-safety.test.ts`.

Ninguna prueba sin guardas toca la base en un `npm test` limpio.

---

## 11. Orden recomendado de ejecución

1. **Fase 0** — R-01 y R-02 (confirmar migraciones; decidir commit).
2. **Fase 1** — local (ya verde).
3. **Fase 2** — integración de solo lectura (opt-in).
4. **Fase 3** — verificación SQL transaccional (manual, propietario).
5. **Fase 4** — integración con escritura (opt-in, autorización).
6. **Fase 5** — flujos de UI con datos sintéticos.

Se detiene aquí **S6-A**. No se avanza a S6-B (seed y ejecución) sin aprobación.
