# Sprint 6 — S6-A.1: resolución de bloqueantes previos a pruebas integrales

**Estado:** completada. **Sin commit, sin push, sin cambios en Supabase y sin
ejecutar SQL remoto.** No se modificó ninguna funcionalidad del sistema. Se
crearon/actualizaron únicamente artefactos de verificación y documentación.

> **Actualización (S6-A.2):** el responsable **sí** ejecutó después el
> verificador de solo lectura en PigTecBD y **confirmó la presencia de los
> mecanismos de 006/007/008** (PostgreSQL 17.11). La contradicción documental
> (**R-01**) queda resuelta y reflejada en `database/migrations/README.md` y en
> `docs/progreso/24_SPRINT_6_S6A2_CIERRE_AUDITORIA_Y_RESPALDO_GIT.md`. La
> ejecución **no** volvió a aplicar las migraciones.

**Objetivo de la etapa:** resolver (o dejar lista la resolución de) los dos
riesgos prioritarios de S6-A — **R-01** (estado documental incierto de las
migraciones 006/007/008) y **R-02** (trabajo sin commit) — antes de las pruebas
integrales.

> **Recordatorio de método:** la existencia de un archivo `.sql` en el
> repositorio **no prueba** que la migración esté aplicada. Este documento
> separa explícitamente **evidencia documental** de **estado real de la base**,
> que solo puede confirmarse ejecutando el script de solo lectura adjunto.

---

## 1. Inventario del repositorio (estado de Git)

Rama única `master`, con `origin` en `https://github.com/damon14-ip/PigTec.git`.
Último commit: **`dfad81c`** (`feat: implement areas and pens API with RLS
policies`). Todo el trabajo posterior está **sin commitear**.

### 1.1 Resumen cuantitativo

| Grupo | Cantidad | Detalle |
|---|---|---|
| Archivos rastreados modificados (`M`) | **13** | ver 1.2 |
| Archivos nuevos sin rastrear (`??`) | **212** | 76 backend, 118 frontend, 7 database, 11 docs |
| Archivos ignorados (`!!`) | **6** | secretos y artefactos: ver 1.4 |
| Commits pendientes de origin | 0 | sin divergencia con `origin/master` |

### 1.2 Archivos rastreados modificados (13)

```
PIGTEC_ESPECIFICACION_MAESTRA.md
backend/.env.example
backend/package-lock.json
backend/package.json
backend/src/app.ts
backend/src/config/env.ts
backend/src/modules/common/data-errors.ts
backend/src/modules/common/http-errors.ts
backend/src/modules/common/postgrest.ts
backend/src/server.ts
backend/tests/env.test.ts
database/migrations/README.md
docs/progreso/00_INDICE_Y_CONVENCIONES.md
```

Contenido funcional relevante (según `git diff --stat`):

- `backend/src/app.ts` (+173): registro de los módulos `animals`, `movements`,
  `litters`, `health-events`, `dashboard`, `reports`, `reports/export` y
  `assistant`, y el plugin CORS.
- `backend/src/config/env.ts` (+14) y `backend/src/config/cors.ts` (nuevo):
  lista blanca `CORS_ALLOWED_ORIGINS` y configuración del asistente.
- `backend/package.json`: `test:integration`, y dependencias `@fastify/cors`,
  `exceljs`, `pdfkit` (+ `@types/pdfkit`).
- `backend/src/modules/common/*`: utilidades compartidas (errores de datos/HTTP,
  cliente PostgREST).
- `backend/src/server.ts`, `backend/tests/env.test.ts`: arranque y pruebas.
- `database/migrations/README.md`: estado de 003/004/005 y «006 propuesta».
- `PIGTEC_ESPECIFICACION_MAESTRA.md` y `docs/progreso/00_...`: actualización
  documental.

### 1.3 Archivos nuevos (sin rastrear) por sprint

Sin rastrear (211 antes de añadir el script de esta etapa):

- **Sprint 3 (porcinos):** `backend/src/modules/animals/*`,
  `backend/src/modules/common/animal.ts`, `backend/tests/animals*.test.ts`,
  `backend/tests/animal-code.migration.test.ts`.
- **Sprint 4 (movimientos/camadas/sanidad):**
  `backend/src/modules/movements/*`, `.../litters/*`, `.../health/*`,
  `backend/src/modules/common/movement.ts`, `.../health-event.ts`, pruebas
  asociadas y `backend/tests/sprint4.*.test.ts`.
- **Sprint 5 (backend de dashboard/reportes/asistente):**
  `backend/src/modules/dashboard/*`, `.../reports/*` (incl. `export/*`),
  `.../assistant/*`, pruebas y `backend/tests/support/*`.
- **Frontend completo (118 archivos, S5-A…S5-E):** `frontend/` entero
  (configuración, `src/`, pruebas, `package.json`, `vite.config.ts`, etc.).
- **Base de datos:** `database/migrations/004…008*.sql` y
  `database/verification/sprint4_transactional_check.sql`.
- **Documentación:** `docs/progreso/12…22*.md` (11 archivos).

### 1.4 Archivos ignorados correctamente (`!!`)

```
backend/.env            (ignorado por .gitignore:5 ".env")
frontend/.env.local     (ignorado por .gitignore:6 ".env.*")
backend/dist/           (ignorado por .gitignore:10 "dist/")
frontend/dist/          (ignorado por .gitignore:10 "dist/")
backend/node_modules/   (ignorado por .gitignore:2 "node_modules/")
frontend/node_modules/  (ignorado por .gitignore:2 "node_modules/")
```

> Nota (LF/CRLF): Git avisa de que convertirá LF a CRLF en varios archivos al
> tocarlos (no hay `.gitattributes`). No es un riesgo; se puede normalizar más
> adelante si se desea.

---

## 2. Informe de seguridad del repositorio (secretos)

**Resultado: correcto. No se detectaron secretos rastreados ni versionados.**

### 2.1 Qué se comprobó

| Comprobación | Método | Resultado |
|---|---|---|
| `.env` / `.env.local` no versionados | `git check-ignore -v` | `.env` y `.env.*` ignorados; `backend/.env` y `frontend/.env.local` figuran como `!!` |
| Único `.env*` rastreado es plantilla | `git ls-files` | Solo `backend/.env.example` y `frontend/.env.example` (valores de EJEMPLO, no reales) |
| Sin JWT/tokens reales en archivos rastreados | `git grep` (patrón `eyJ…`) | 0 coincidencias |
| Sin claves `service_role`/`sbp_`/Groq (`gsk_`) reales | `git grep` (patrones de clave) | 0 coincidencias |
| Sin cadenas `postgres://…:clave@` | `git grep` | 0 coincidencias |
| `service_role` solo como texto/documentación | `git grep` | Solo comentarios y reglas que **prohíben** su uso |
| Historial de Git no introdujo `.env` | `git log --diff-filter=A -- "*.env*"` | Solo se añadió `backend/.env.example` (commit `0820719`) |

### 2.2 Contenido de las plantillas (valores no reales)

- `backend/.env.example`: `SUPABASE_URL=https://example-project.supabase.co`,
  `SUPABASE_ANON_KEY=example-anon-key-not-real`,
  `GROQ_API_KEY=example-groq-api-key-not-real`, `CORS_ALLOWED_ORIGINS`,
  `AI_DAILY_REQUEST_LIMIT`. Ninguno es un valor real.
- `frontend/.env.example`: solo URL del backend local y **clave pública `anon`**
  de ejemplo; prohíbe explícitamente `service_role` y secretos del servidor.

### 2.3 Recomendaciones (no bloqueantes, requieren autorización)

1. Añadir un `.gitattributes` con `* text=auto eol=lf` para eliminar los avisos
   LF→CRLF y fijar una convención de finales de línea.
2. Verificar (fuera del alcance de esta etapa, sin mostrar valores) que
   `backend/.env` y `frontend/.env.local` no hayan sido copiados a ningún
   documento ni compartido por chat/issue. No se han versionado.
3. Confirmar que la clave `anon` del `.env` real es la pública (no
   `service_role`); el código ya prohíbe `service_role` por diseño (prueba
   `supabase.client.test.ts`).

> No se ha leído ni se muestran valores de `backend/.env` ni
> `frontend/.env.local`.

---

## 3. Estado de las migraciones 006/007/008: documental vs real

### 3.1 Evidencia documental (lo que dicen los archivos del repo)

| Fuente | Qué afirma |
|---|---|
| `database/migrations/006_litters_rls.sql` | Cabecera: «**PROPUESTA. NO ejecutada.**» |
| `database/migrations/007_health_events_rls.sql` | Cabecera: «**PROPUESTA. NO ejecutada.**» |
| `database/migrations/008_animal_code_generation.sql` | Cabecera: «**PROPUESTA. NO ejecutada.**» |
| `database/migrations/README.md` | Tabla «Reservado»: 003/004/005 «aplicadas»; **006 «propuesta, NO ejecutada»**; **007 y 008 no se mencionan**. Cierra diciendo que se aplicaron **001–005** |
| `database/verification/sprint4_transactional_check.sql` | Depende de «migraciones **001-008** ya aplicadas» |
| `docs/progreso/16_SPRINT_5_S5C2_PORCINOS.md` | Asume la secuencia `public.animals_animal_code_seq` (**008**) |
| `docs/progreso/18_SPRINT_5_S5D2_CAMADAS_SANIDAD.md` | Cita «la migración **007** no concede UPDATE/DELETE» |
| `docs/progreso/22_SPRINT_6_S6A_AUDITORIA.md` | Marca R-01: estado incierto y README contradictorio |

### 3.2 Conclusión: contradicción documental confirmada (R-01)

- Las **cabeceras de 006/007/008** y el **README** dicen que **no** están
  aplicadas.
- El **guion de verificación de Sprint 4** y los **documentos 16 y 18** asumen
  que **sí** están aplicadas.
- **No existe** en la base de datos un registro de migraciones aplicadas (no hay
  tabla `schema_migrations`; el proyecto aplica SQL manualmente en el SQL
  Editor). Por tanto **la documentación no puede resolver R-01 por sí sola**.

### 3.3 Estado real: pendiente de confirmación en PigTecBD

**Este informe NO afirma que 006/007/008 estén aplicadas.** El estado real se
determinará ejecutando, en modo solo lectura, el script de la sección 5.

Consecuencias según el resultado (ya identificadas en S6-A):

- Si **006 no** está aplicada → las operaciones sobre `litters` (camadas) quedan
  denegadas por RLS.
- Si **007 no** está aplicada → las operaciones sobre `health_events` (sanidad)
  quedan denegadas por RLS.
- Si **008 no** está aplicada → el alta de porcinos sin `animal_code`
  (`POST /animals`) falla, y la Fase 4 (escritura) es inviable.

---

## 4. Propuesta de estrategia de commits (NO ejecutada)

**No se ha ejecutado ningún commit ni push.** La propuesta preserva el trabajo de
Sprint 2 a Sprint 6 agrupándolo en commits **pequeños, coherentes y
compilables**, con los documentos junto al código que describen.

### 4.1 Principios

1. **Commitear por capa y por sprint**, no un único volcado.
2. Cada commit debe dejar backend/frontend **compilables** (dependencias antes
   que consumidores).
3. Las migraciones **propuestas** (006/007/008) se commitean **etiquetadas como
   no aplicadas**; su presencia en Git no implica ejecución.
4. **Docs** (especificación, índice, progreso, auditoría) en un commit propio.
5. **No push** hasta autorización expresa.

### 4.2 Secuencia propuesta (14 commits)

| # | Mensaje propuesto | Contenido principal |
|---|---|---|
| C1 | `docs: registrar Sprints 1-6, especificacion maestra e indice de progreso` | `PIGTEC_ESPECIFICACION_MAESTRA.md`, `docs/progreso/00_...`, `docs/progreso/12…23_*.md` |
| C2 | `feat(backend): registro de rutas, CORS y utilidades comunes` | `src/app.ts`, `src/server.ts`, `src/config/{env,cors}.ts`, `src/modules/common/*`, `package.json`, `package-lock.json`, `.env.example`, `tests/env.test.ts`, `tests/cors.test.ts` |
| C3 | `feat(backend): API de porcinos (Sprint 3)` | `src/modules/animals/*`, `src/modules/common/animal.ts`, `tests/animals*.test.ts`, `tests/animal-code.migration.test.ts` |
| C4 | `feat(backend): API de movimientos (Sprint 4)` | `src/modules/movements/*`, `src/modules/common/movement.ts`, `tests/movements.test.ts`, `tests/movements.contract.test.ts` |
| C5 | `feat(backend): API de camadas y sanidad (Sprint 4)` | `src/modules/litters/*`, `src/modules/health/*`, `src/modules/common/health-event.ts`, `tests/litters.test.ts`, `tests/health-events*.test.ts` |
| C6 | `feat(backend): dashboard, reportes y exportaciones (Sprint 5)` | `src/modules/dashboard/*`, `src/modules/reports/*`, `tests/dashboard*.test.ts`, `tests/reports*.test.ts`, `tests/support/reports-export-fixtures.ts` |
| C7 | `feat(backend): asistente IA de solo lectura (Sprint 5)` | `src/modules/assistant/*`, `tests/assistant*.test.ts` |
| C8 | `test(backend): integracion opt-in de solo lectura/escritura` | `tests/support/e2e.ts`, `tests/sprint4.readonly|write.integration.test.ts`, `tests/sprint4.sql-safety.test.ts`, `tests/movements.integration.test.ts`, `tests/INTEGRATION.md` |
| C9 | `feat(db): RLS de porcinos y movimientos (migraciones 004-005 aplicadas)` | `database/migrations/004_animals_rls.sql`, `005_movements_integrity_rls.sql`, `database/migrations/README.md` |
| C10 | `feat(db): migraciones propuestas 006-008 (no aplicadas) y verificacion SQL` | `database/migrations/006…008*.sql`, `database/verification/sprint4_transactional_check.sql`, `database/verification/s6a1_readonly_migrations_check.sql` |
| C11 | `feat(frontend): base React+Vite con autenticacion, layout y asistente (S5-A)` | configuración, `App.tsx`, `main.tsx`, `styles/`, `config/`, `lib/`, `context/`, `components/{ui,layout,auth,assistant}`, páginas base, `services/{auth,assistant}`, `test/setup.ts` |
| C12 | `feat(frontend): dashboard, areas/corrales y porcinos (S5-B/C)` | `pages/DashboardPage*`, `pages/AreasPensPage*`, `pages/AnimalsPage*`, `components/{dashboard,animals,locations}`, `services/{dashboard,areas,pens,animals}`, `test/dashboard-fixtures.ts` |
| C13 | `feat(frontend): movimientos, camadas y sanidad (S5-D)` | `pages/{Movements,Litters,Health}Page*`, `components/{movements,litters,health}`, `services/{movements,litters,health-events}` |
| C14 | `feat(frontend): reportes y exportaciones (S5-E)` | `pages/ReportsPage*`, `components/reports/*`, `services/{reports,reports-export}`, `test/reports-fixtures.ts` |

> **Alternativa más rápida (si se prefiere):** 3 commits — `docs: …`,
> `feat: backend + db (Sprints 2-6)`, `feat: frontend (Sprint 5)` —. Se pierde
> granularidad, pero reduce el riesgo de conflictos manuales.

### 4.3 Verificación sugerida antes de cada commit (local)

- `backend`: `npm run typecheck`, `npm test`, `npm run build`.
- `frontend`: `npm run typecheck`, `npm test`, `npm run build`.
- Ningún comando con variables `PIGTEC_E2E_*` (no toca la red/Supabase).

> **Requiere autorización.** No se ha ejecutado `git add`, `git commit` ni
> `git push`.

---

## 5. Verificación del estado real en Supabase (solo lectura)

### 5.1 Archivo preparado

**`database/verification/s6a1_readonly_migrations_check.sql`**

- Es **solo lectura**: consulta únicamente **metadatos** de PostgreSQL
  (`pg_catalog`, `information_schema`, funciones `has_*_privilege()`).
- **No** ejecuta `INSERT/UPDATE/DELETE/ALTER/CREATE/DROP/TRUNCATE`, ni llama a
  funciones que modifiquen datos (`nextval`, `setval`, RPC), ni lee filas de
  tablas de negocio.
- Es **una sola sentencia `SELECT`**: el SQL Editor devuelve **una única tabla**
  con columnas `bloque | objeto | estado | detalle`.

> **Honestidad de verificación:** el script **no se ha ejecutado** en esta etapa
> (no hay PostgreSQL local y el proyecto prohíbe ejecutar SQL remoto). Su
> sintaxis y semántica se revisaron manualmente contra el catálogo de
> PostgreSQL; el resultado real solo se conocerá al ejecutarlo en PigTecBD.

### 5.2 Qué comprueba (bloques)

| Bloque | Comprueba |
|---|---|
| 0 | Entorno: `current_database()`, usuario y versión de PostgreSQL (≥ 15) |
| 1 | Existencia de tablas: `litters`, `health_events` y todas las demás |
| 2 | Columnas requeridas de `animals`, `litters` y `health_events` |
| 3 | Secuencia `public.animals_animal_code_seq` (**mecanismo 008**) |
| 4 | Funciones requeridas (`assign_animal_code`, `apply_*`, `guard_*`, `set_updated_at`, `handle_new_user`, `admin_set_profile_access`) con su `SECURITY DEFINER` y `search_path` |
| 5 | Triggers requeridos (`trg_animals_assign_code`, `trg_animals_derived_guard`, `trg_animal_movements_immutable`, `trg_apply_*`, `trg_*_updated_at`, `on_auth_user_created`) |
| 6 | Políticas RLS esperadas, **identificadas por migración (006 y 007 incluidas)** |
| 7 | RLS habilitado (`relrowsecurity`) en las 7 tablas operativas |
| 8 | Privilegios de tabla para `authenticated` y `anon` (incl. ausencia de `DELETE`/`UPDATE`) |
| 9 | Privilegios de columna de `animals` (derivadas `animal_code`/`current_pen_id`/`exit_date`/`entry_date`/`created_by` **sin UPDATE**) |
| 10 | Restricción `UNIQUE` de `animals.animal_code` |

### 5.3 Guía paso a paso para ejecutarlo

1. **Confirma el proyecto correcto.** Abre el panel de Supabase y verifica que el
   proyecto seleccionado es el de **desarrollo** (`PigTecBD`); anota su *project
   ref* de la URL. No sigas si dudas del proyecto.
2. En el menú lateral, entra en **SQL Editor** y pulsa **New query**.
3. Abre el archivo `database/verification/s6a1_readonly_migrations_check.sql` en
   un editor de texto, **copia todo** su contenido y **pégalo** en la consulta.
4. Pulsa **Run** (o `Ctrl+Enter`). Debe devolver **una tabla** con 4 columnas.
5. **Interpreta el resultado:**
   - `estado = PRESENTE` / `OK` / `CONCEDIDO` / `ACTIVADO` → correcto.
   - `estado = FALTA` / `NO CONCEDIDO` → revisar (probable migración no
     aplicada).
   - `estado = N/D` → el objeto padre no existe (no evaluable).
   - `INFO` → informativo.
6. **Veredicto por migración:**
   - **006 aplicada** si en el bloque 6 aparecen
     `litters_select_operational`, `litters_insert_operational` y
     `litters_update_operational` como `PRESENTE`, y el bloque 7 marca
     `litters` `ACTIVADO`.
   - **007 aplicada** si aparecen `health_events_select_operational` y
     `health_events_insert_operational` como `PRESENTE`, y `health_events`
     `ACTIVADO`.
   - **008 aplicada** si el bloque 3 (secuencia), el bloque 4
     (`assign_animal_code`), el bloque 5 (`trg_animals_assign_code`) y el
     bloque 9 están correctos.
7. **Comparte los resultados** sin secretos: exporta/copia la tabla (o haz una
   captura) y entrégala al asistente. Si el SQL Editor solo deja copiar filas,
   basta con las filas de los bloques 3, 5, 6 y 7.
8. *(Opcional)* Si el bloque 3 sale `PRESENTE`, ejecuta por separado la consulta
   comentada al final del script para ver `last_value` de la secuencia (no
   consume valores).

> El script **no** modifica nada. Aun así, ejecútalo solo en el proyecto de
> desarrollo.

### 5.4 Qué se hará con el resultado (según R-01)

- **006/007 aplicadas** → habilitar la Fase 4 por lo que respecta a camadas y
  sanidad.
- **006/007 no aplicadas** → decidir si se autoriza aplicarlas (procedimiento
  manual del responsable) o si se posponen las pruebas que dependen de ellas.
- **008 no aplicada** → no iniciar la Fase 4 (escritura) hasta resolverlo.
- En todos los casos → **corregir la contradicción documental** (sección 6).

---

## 6. Acciones pendientes de autorización

Ninguna de las siguientes se ha ejecutado. Requieren decisión explícita del
responsable.

| # | Acción | Por qué | Riesgo si no se hace |
|---|---|---|---|
| A1 | Ejecutar `s6a1_readonly_migrations_check.sql` en PigTecBD (manual) | Resolver R-01 | Las Fases 3–5 siguen bloqueadas |
| A2 | Autorizar la estrategia de commits y ejecutarla (**sin push**) | Resolver R-02 | Riesgo de pérdida de trabajo |
| A3 | Autorizar `git push` a `origin/master` | Publicar | Trabajo solo en local |
| A4 | Corregir `database/migrations/README.md` (estado real de 006/007/008 tras A1) | Coherencia documental | README seguirá contradiciéndose |
| A5 | Aplicar 006/007/008 (si A1 concluye que faltan) | Desbloquear Fase 4 | Camadas/sanidad/alta de porcinos fallan |
| A6 | Añadir la entrada de este documento a `docs/progreso/00_INDICE_Y_CONVENCIONES.md` | Convención del proyecto | Índice desactualizado |
| A7 | (Opcional) Aprobar `.gitattributes` para normalizar finales de línea | Limpieza | Avisos LF/CRLF persistentes |
| A8 | Autorizar la **Fase 2** (integración de solo lectura con `PIGTEC_E2E_*`) | Continuar pruebas integrales | Pruebas E2E no avanzan |
| A9 | Autorizar la **Fase 3** (guion SQL `BEGIN…ROLLBACK`) | Verificar reglas en base | Reglas no verificadas |
| A10 | Autorizar la **Fase 4** (escritura, `PIGTEC_E2E_WRITE=1`) y el entorno | Pruebas E2E de escritura | Deja filas permanentes |

> **Nota:** A4, A5 y A6 implican modificar archivos existentes o la base de
> datos; **no** se harán sin autorización expresa (regla `AGENTS.md`).

---

## 7. Cierre de la etapa

Se detiene aquí **S6-A.1**. No se avanza a S6-B (seed y ejecución con escritura)
sin autorización. Resumen de entregables:

1. **Informe de seguridad del repositorio** (sección 2) — sin secretos
   versionados.
2. **Propuesta concreta de commits** (sección 4) — 14 commits, sin ejecutar.
3. **Archivo SQL de verificación de solo lectura**
   (`database/verification/s6a1_readonly_migrations_check.sql`).
4. **Instrucciones paso a paso** (sección 5.3).
5. **Lista de acciones pendientes** (sección 6).
