# Sprint 6 — S6-A.2: cierre de auditoría y respaldo Git

**Estado:** completada. **Sin commit, sin push, sin SQL remoto, sin cambios en
Supabase y sin tocar `.env`.** No se aplicaron migraciones, no se
insertó/modificó/eliminó ningún dato, no se usó `service_role` y no se ejecutó
ninguna prueba E2E de escritura. **No se implementó ninguna funcionalidad.**

**Objetivo:** cerrar los bloqueantes de auditoría (R-01 y R-02) dejando listo el
respaldo del trabajo en Git, **sin ejecutarlo**, para aprobación del responsable.

**Restricciones respetadas:** el asistente **no** se conectó a Supabase ni
ejecutó SQL; la verificación de presencia de 006/007/008 la ejecutó **el
responsable** de forma manual y de **solo lectura**.

---

## 1. Cierre de R-01 — presencia de 006/007/008 confirmada (solo lectura)

### 1.1 Qué ocurrió

El responsable ejecutó **manualmente**, en el SQL Editor del proyecto de
desarrollo **PigTecBD**, el verificador de solo lectura
`database/verification/s6a1_readonly_migrations_check.sql`. **No** se ejecutó SQL
desde el entorno del asistente.

### 1.2 Resultado reportado y conclusiones

| Área verificada | Resultado |
|---|---|
| Motor | PostgreSQL **17.11** |
| Tablas, columnas, funciones y triggers esperados | **PRESENTE** |
| Migración **006** (camadas) | Políticas de `litters` presentes, **RLS activado** y privilegios esperados |
| Migración **007** (sanidad) | Políticas de `health_events` presentes, **RLS activado** y privilegios esperados |
| Migración **008** (`animal_code`) | Secuencia `public.animals_animal_code_seq`, función `assign_animal_code()` y trigger `trg_animals_assign_code` presentes; **índice UNIQUE** de `animal_code` presente |

**Conclusión:** los **mecanismos** de 006/007/008 **están presentes** en
PigTecBD. Esto **resuelve R-01** (contradicción documental). **No** implica que
se hayan vuelto a aplicar: en esta etapa **no** se ejecutó DDL/DML.

### 1.3 Única diferencia del verificador: `UPDATE` de tabla vs. `UPDATE` por columna

El verificador marcó una diferencia en el bloque de privilegios:
`authenticated` **no** tiene `UPDATE` **de tabla completa** sobre `animals`, pero
**sí** `UPDATE` sobre las columnas editables. Se revisó el diseño y **es
correcto**:

- La migración **004** concedió `SELECT, INSERT, UPDATE` sobre `animals` a
  `authenticated` a nivel de tabla.
- La migración **005** **revoca** ese `UPDATE` de tabla y lo sustituye por
  `GRANT UPDATE (ear_tag_code, sex, breed, birth_date, origin, mother_id,
  father_id, litter_id, status, notes, updated_at)`.
- El resto de columnas (`animal_code`, `current_pen_id`, `exit_date`,
  `entry_date`, `created_by`, `created_at`, `id`) quedan sin `UPDATE`: solo los
  triggers `SECURITY DEFINER` pueden cambiarlas.

Por tanto, **no procede** ningún `GRANT UPDATE` general sobre `animals` (1.4).

### 1.4 Documentación corregida

- `database/migrations/README.md`: la tabla de migraciones pasa 006/007/008 de
  «no ejecutada / sin entrada» a **«mecanismos presentes en PigTecBD»**, con una
  subsección que distingue **presencia verificada** de **nueva ejecución**; la
  sección «Estado» y el cierre «001–005» se actualizan.
- `docs/progreso/23_SPRINT_6_S6A1_RESOLUCION_BLOQUEANTES.md`: nota de
  actualización (R-01 resuelto).
- `docs/progreso/00_INDICE_Y_CONVENCIONES.md`: Sprint 6 y entrada del presente
  documento.

---

## 2. Verificador SQL corregido (`s6a1_readonly_migrations_check.sql`)

Se corrigieron **dos defectos** del script y se guarda la versión corregida:

### 2.1 Error SQL real (agregado con columna no agrupada)

En el bloque 4 (funciones), la subconsulta mezclaba un agregado (`bool_or`) con
una columna **no** agrupada (`p.proconfig`) dentro de `array_to_string`. En
PostgreSQL eso es un **error** (`column "p.proconfig" must appear in the GROUP BY
clause or be used in an aggregate function`). Corrección:

```sql
-- antes:  || COALESCE(array_to_string(p.proconfig, ','), '(sin fijar)')
-- ahora:  || COALESCE(min(array_to_string(p.proconfig, ',')), '(sin fijar)')
```

### 2.2 Distinción `UPDATE` de tabla vs. `UPDATE` por columna

- Se reordena la CTE `esperado_col_update` **antes** de `esperado_privilegios`
  (ahora se consulta mutuamente).
- En `esperado_privilegios`, la expectativa de `animals / authenticated / UPDATE`
  pasa a explicitar que el resultado correcto es **`POR COLUMNA (005)`** (no un
  `GRANT` general).
- En el **bloque 8** el `CASE` distingue:
  - `CONCEDIDO` → privilegio **a nivel de tabla**;
  - `POR COLUMNA` → sin `UPDATE` de tabla pero con `UPDATE` en **todas** las
    columnas editables (comprobado contra el bloque 9) → **correcto por diseño**;
  - `NO CONCEDIDO` → falta también a nivel de columna (revisar).
- La cabecera del script documenta la interpretación de `POR COLUMNA` y aclara
  que **no** se debe recomendar `GRANT UPDATE` general.

> **Honestidad:** el script corregido **no** se ha ejecutado desde el asistente
> (no hay PostgreSQL local y el proyecto prohíbe el SQL remoto). El resultado
> real ya reportado por el responsable corresponde a la versión previa; los
> cambios afectan a la **presentación/ lógica de comprobación**, no a la
> conclusión de presencia.

---

## 3. Revisión de `PATCH /animals` (sin modificar permisos remotos)

**Archivos revisados:** `backend/src/modules/animals/animals.routes.ts`,
`animals.service.ts`, `animals.schemas.ts`, `animals.repository.ts`; y la
migración `database/migrations/005_movements_integrity_rls.sql`.

### 3.1 Qué columnas escribe realmente

| Ruta | Campos que envía a PostgREST | Columnas de `animals` |
|---|---|---|
| `PATCH /animals/:id` | `ear_tag_code, sex, breed, birth_date, origin, mother_id, father_id, litter_id, notes` | las mismas |
| `PATCH /animals/:id/status` | `status` | `status` |

### 3.2 Contraste con los privilegios por columna (005)

Columnas con `UPDATE` concedido a `authenticated`:
`ear_tag_code, sex, breed, birth_date, origin, mother_id, father_id, litter_id,
status, notes, updated_at`.

Columnas **sin** `UPDATE`: `animal_code, current_pen_id, exit_date, entry_date,
created_by, created_at, id`.

### 3.3 Resultado: **compatible**

- **Todas** las columnas que `PATCH /animals` escribe están dentro del conjunto
  concedido por 005. **No hay incompatibilidad.**
- El esquema es `strictObject`: **rechaza** campos prohibidos (`animal_code`,
  `status`, `current_pen_id`, `entry_date`/`exit_date`, `created_by`, `id`) con
  `400` **antes** de tocar la base; además exige al menos un campo.
- `status` se cambia solo por el endpoint dedicado y limitado a
  `active`/`inactive`/`missing`; los estados derivados (`sold`/`dead`/
  `transferred_out`) los fijan los triggers de movimientos/mortalidad.
- No se detectó ningún camino que intente escribir una columna no autorizada.

**Acción:** ninguna sobre permisos remotos. La única diferencia del verificador
es de **presentación** (bloque 8) y ya se corrigió el script.

---

## 4. Revisión de Git y seguridad del repositorio

### 4.1 Estado (`master`, `origin` = `https://github.com/damon14-ip/PigTec.git`)

Último commit: **`dfad81c`**. Todo el trabajo posterior está **sin commitear**.

| Grupo | Cantidad |
|---|---|
| Archivos rastreados modificados (`M`) | **13** |
| Archivos nuevos sin rastrear (`??`, `-uall`) | **213** |
| Archivos ignorados (`!!`) | **6** |

**Modificados (13):** `PIGTEC_ESPECIFICACION_MAESTRA.md`, `backend/.env.example`,
`backend/package.json`, `backend/package-lock.json`, `backend/src/app.ts`,
`backend/src/config/env.ts`, `backend/src/server.ts`,
`backend/src/modules/common/{data-errors,http-errors,postgrest}.ts`,
`backend/tests/env.test.ts`, `database/migrations/README.md`,
`docs/progreso/00_INDICE_Y_CONVENCIONES.md`.

**Nuevos (213) por carpeta de primer nivel:** `backend` 76, `database` 7,
`docs` 12 (13 tras añadir este documento), `frontend` 118.

**Ignorados correctamente (6):** `backend/.env`, `frontend/.env.local`,
`backend/dist/`, `frontend/dist/`, `backend/node_modules/`,
`frontend/node_modules/`. Verificado con `git check-ignore -v`:
`.gitignore:5:.env` y `.gitignore:6:.env.*`.

### 4.2 `.gitignore`

Correcto y suficiente: ignora `node_modules/`, `.env`/`.env.*` (conservando
`!.env.example`), `dist/`/`build/`/`coverage/`, logs, basura de SO/editores y
temporales. **No hay `.gitattributes`** → persisten avisos LF→CRLF (no es un
riesgo; se puede normalizar después con aprobación).

### 4.3 Búsqueda de secretos — **sin resultados**

Análisis sobre **todo** el árbol (rastreado y sin rastrear), excluyendo
`node_modules`, `dist`, `.git` y los `.env` reales:

| Patrón | Resultado |
|---|---|
| JWT (`eyJ…`), `sbp_…`, `gsk_…`, `sk-…` | **0 coincidencias** |
| Cadenas `postgres://…:clave@` | 1 coincidencia **de documentación**: el literal de ejemplo `postgres://…:clave@` en `docs/progreso/23_…` (no hay credencial) |
| `service_role` | Solo como **texto** en comentarios, reglas que lo **prohíben** y pruebas que lo bloquean |

Las plantillas `backend/.env.example` y `frontend/.env.example` contienen
**únicamente valores de ejemplo** (`example-project.supabase.co`,
`example-anon-key-not-real`, `example-groq-api-key-not-real`). **No** se leyó ni
se muestran valores de `backend/.env` ni `frontend/.env.local`.

**Conclusión: no hay secretos en el material a incluir en los commits.**

---

## 5. Pruebas locales ejecutadas (evidencia real)

Comandos ejecutados en el árbol de trabajo actual, **sin** variables
`PIGTEC_E2E_*` (las suites de integración quedan omitidas; ninguna toca la red):

| Comando | Directorio | Resultado |
|---|---|---|
| `npm run typecheck` | `backend` | **OK** (sin errores) |
| `npm test` | `backend` | **31 archivos OK / 3 omitidos; 580 pruebas OK / 30 omitidas** |
| `npm run build` | `backend` | **OK** |
| `npm run typecheck` | `frontend` | **OK** (sin errores) |
| `npm test` | `frontend` | **26 archivos OK; 339 pruebas OK** |
| `npm run build` | `frontend` | **OK** (aviso de chunk ~1,010 kB, preexistente) |

Coincide con lo registrado en S6-A (22_…, sección 10). No se ejecutó ninguna
prueba de escritura ni E2E.

---

## 6. Plan de commits (NO ejecutado — para aprobación)

### 6.1 Ajuste de orden (y por qué)

El orden sugerido era *documentación → backend+migraciones → frontend*. Ese orden
deja los dos primeros commits **inconsistentes**: la documentación (incluido
`database/migrations/README.md` y el verificador SQL) **afirma la presencia de
006/007/008** y describe módulos del backend, pero los archivos `.sql` y el
código llegarían **después**. Para que cada commit sea coherente por sí mismo se
propone **invertir el orden: primero el código y las migraciones, al final la
documentación** (los documentos describen hechos ya presentes en el árbol).

> Si se prefiere el orden original (docs primero), es aceptable: la
> inconsistencia es **descriptiva** (Markdown que menciona archivos aún no
> commiteados) y no rompe ninguna compilación.

### 6.2 Commits propuestos

**Commit 1 — backend y migraciones**

```
git add backend/ database/migrations/
git commit -m "feat: backend de Sprint 2-5 y migraciones 004-008 (RLS e integridad)"
```

Incluye: `backend/**` completo (13 modificados + 76 nuevos) y
`database/migrations/004…008*.sql` + `database/migrations/README.md`
(actualizado). Backend compila y pasa sus pruebas con este contenido.

**Commit 2 — frontend**

```
git add frontend/
git commit -m "feat(frontend): interfaz web de Sprint 5 (S5-A a S5-E)"
```

Incluye: `frontend/**` (118 archivos nuevos). Compila y pasa sus pruebas.

**Commit 3 — documentación y verificaciones**

```
git add PIGTEC_ESPECIFICACION_MAESTRA.md docs/progreso/ database/verification/
git commit -m "docs: auditoria S6-A, resolucion S6-A.1/S6-A.2 y verificacion de presencia"
```

Incluye: `PIGTEC_ESPECIFICACION_MAESTRA.md`, `docs/progreso/00_…` (modificado),
`docs/progreso/12…24_*.md` (13 nuevos) y `database/verification/*.sql`
(2: verificador corregido + guion transaccional de Sprint 4).

> **No push.** No se ejecutó `git add` ni `git commit` en esta etapa.

### 6.3 Verificación previa a cada commit (recomendada)

```powershell
# 1) Inventario exacto de lo que se va a incluir
git add --dry-run backend/ database/migrations/
# 2) Confirmar que no entra ningun .env real
git diff --cached --name-only | Select-String '\.env'   # solo .env.example
# 3) Pruebas locales (ya ejecutadas: todas OK)
#    backend:  npm run typecheck; npm test; npm run build
#    frontend: npm run typecheck; npm test; npm run build
```

---

## 7. Riesgos y acciones pendientes

| ID | Prioridad | Estado / riesgo | Acción |
|---|---|---|---|
| R-01 | Crítico | **Resuelto** (presencia de 006/007/008 confirmada; docs corregidas) | — |
| R-02 | **Crítico** | **Pendiente**: todo el trabajo sigue **sin commitear** | Aprobar y ejecutar el plan de la sección 6 |
| R-03 | Alto | Historial inmutable: los datos de escritura E2E **no se limpian** | Decidir entorno de pruebas (S6-B) |
| R-04 | Alto | UTC vs `America/Lima` entre reportes/dashboard y módulos | Aprobar corrección (no implementada) |
| R-05 | Medio | Sugerencia del chatbot no reconocida → depende de Groq / `502` | Aprobar corrección |
| R-06 | Medio | Markdown parcial (backticks, cursiva, enlaces, tablas) | Opcional |
| R-07 | Medio | Sin gestión de usuarios ni flujo `animal_registration_requests` | Planificar Etapa 2 |
| R-08 | Medio | Cuota del asistente por proceso | Contador compartido antes de escalar |
| R-09 | Bajo | Bundle ~1 MB, helpers de fecha duplicados, doc `GET /auth/me` | Refactor posterior |
| R-10 | Bajo | Catálogos sin paginación explícita | Paginación explícita |
| — | Info | Avisos LF→CRLF (sin `.gitattributes`) | Opcional: añadir `.gitattributes` |

**Acciones que requieren autorización explícita:**

1. **Ejecutar el plan de commits** (sección 6) — **sin push**.
2. Autorizar un eventual **`git push`** a `origin/master`.
3. Autorizar la **Fase 2** (integración de solo lectura con `PIGTEC_E2E_*`).
4. Autorizar la **Fase 3** (guion SQL `BEGIN…ROLLBACK`).
5. Autorizar la **Fase 4** (escritura, `PIGTEC_E2E_WRITE=1`) y elegir entorno.
6. Aprobar (o no) las correcciones opcionales R-04/R-05/R-06 y `.gitattributes`.

---

## 8. Cierre

Se detiene aquí **S6-A.2**. No se avanza a **S6-B** (seed y ejecución con
escritura) sin autorización. Entregables:

1. **Documentación actualizada**: `database/migrations/README.md`,
   `docs/progreso/23_…` y `docs/progreso/00_…`, más este `24_…`.
2. **Verificador SQL corregido** (error de agregado + distinción tabla/columna).
3. **Revisión de `PATCH /animals`**: compatible, sin cambios de permisos.
4. **Resultados de pruebas locales**: todo verde (sección 5).
5. **Plan de tres commits** con inventario y comandos (sección 6).
6. **Riesgos pendientes** y acciones que requieren autorización (sección 7).
