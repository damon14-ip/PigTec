# Migraciones de base de datos — PigTec

Esta carpeta contiene las migraciones **versionadas** de la base de datos de
PigTec (PostgreSQL en Supabase). La fuente normativa del esquema inicial es
`PorciControl_BD_inicial.txt`; el alcance funcional está en
`PIGTEC_ESPECIFICACION_MAESTRA.md`.

> Regla del proyecto: **no ejecutar** migraciones ni tocar Supabase sin
> aprobación explícita. Ver `AGENTS.md`.

## Convención

- Nombre: `NNN_nombre_corto.sql` (ej. `001_initial_schema.sql`).
- Cada migración es **atómica**: va dentro de `BEGIN; ... COMMIT;`.
- Cada migración es **para una base vacía o en el estado de la anterior**; no se
  reejecuta sobre una base ya migrada (la propia migración lo impide).
- Los cambios posteriores se añaden como migraciones nuevas (`002_...`, `003_...`)
  en vez de editar una ya aplicada.
- No se incluyen datos, usuarios ni secretos en las migraciones de estructura.
- Requisito de motor: **PostgreSQL 15+** (por `security_invoker` en la vista).
  Los proyectos Supabase actuales cumplen esta versión.

## 001_initial_schema.sql — objetos que crea

Números verificados sobre el script (recuento estático, sin ejecutar SQL):

| Categoría | Cantidad |
|---|---|
| Extensiones | **0** (intencional; ver diferencias) |
| Tipos ENUM | 6 |
| Tablas | 7 |
| Claves foráneas (`FOREIGN KEY` en `public`) | **15** |
| Restricciones `CHECK` | 11 |
| Restricciones `UNIQUE` | 4 (+ 4 índices) |
| Claves primarias | 7 |
| Índices en `public` (`pg_indexes`) | 15 |
| Funciones | 3 |
| Triggers | 8 |
| Vistas | 1 |
| Políticas RLS | 1 (`profile_select_own`) |

### Tipos ENUM (6)

| Tipo | Valores |
|---|---|
| `user_role` | admin, manager, operator, veterinarian, viewer |
| `animal_sex` | male, female, unknown |
| `animal_status` | active, sold, dead, transferred_out, missing, inactive |
| `location_status` | active, inactive |
| `movement_reason` | weaning, growth_stage, fattening, breeding, health_isolation, sale, transfer, management, other |
| `health_event_type` | observation, symptom_report, documented_diagnosis, treatment, vaccination, deworming, mortality, recovery, other |

### Tablas (7)

| Tabla | Notas |
|---|---|
| `profiles` | `id` referencia `auth.users(id)`; `role` por defecto `viewer` (heredado). |
| `areas` | `name` único. |
| `pens` | `area_id → areas`; único `(area_id, code)`; `capacity >= 0`. |
| `animals` | `animal_code` único; autorreferencias `mother_id`/`father_id`; `current_pen_id → pens`; `litter_id → litters`; `created_by → profiles`; CHECK de `origin`. |
| `litters` | `litter_code` único; `mother_id`/`father_id → animals`. |
| `animal_movements` | `animal_id → animals`; `from_pen_id`/`to_pen_id → pens`; `recorded_by → profiles`. |
| `health_events` | `animal_id → animals`; `recorded_by → profiles`; `details` JSONB objeto. |

### Claves foráneas (15)

1. `profiles.id → auth.users(id)`
2. `pens.area_id → areas`
3. `animals.mother_id → animals`
4. `animals.father_id → animals`
5. `animals.current_pen_id → pens`
6. `animals.created_by → profiles`
7. `animals.litter_id → litters` (`fk_animals_litter`, añadida tras crear `litters`)
8. `litters.mother_id → animals`
9. `litters.father_id → animals`
10. `animal_movements.animal_id → animals`
11. `animal_movements.from_pen_id → pens`
12. `animal_movements.to_pen_id → pens`
13. `animal_movements.recorded_by → profiles`
14. `health_events.animal_id → animals`
15. `health_events.recorded_by → profiles`

### Restricciones CHECK (11)

- `pens.capacity`.
- `animals`: no ser su propia madre/padre; `exit_date >= entry_date`;
  `chk_animals_origin` (4 valores canónicos o NULL).
- `litters`: `total_born`, `born_alive`, `stillborn` no negativos + coherencia con
  `total_born`.
- `animal_movements`: `to_pen_id` nulo solo para motivos permitidos; `from <> to`.
- `health_events`: `details` es objeto JSON.

### Índices (15 en `pg_indexes`)

7 PK + 4 únicos de constraint (`areas.name`, `pens(area_id, code)`,
`animals.animal_code`, `litters.litter_code`) + `uq_animals_ear_tag_code`
(único parcial) + 3 no únicos (`idx_animal_movements_animal_date`,
`idx_health_events_animal_date`, `idx_health_events_type_date`).

El índice de arete es ahora **único parcial y normalizado**:

```sql
CREATE UNIQUE INDEX uq_animals_ear_tag_code
ON public.animals (lower(btrim(ear_tag_code)))
WHERE ear_tag_code IS NOT NULL AND btrim(ear_tag_code) <> '';
```

### Funciones y triggers (3 + 8)

- `set_updated_at()` + 6 triggers `BEFORE UPDATE` (`profiles`, `areas`, `pens`,
  `litters`, `animals`, `health_events`).
- `apply_animal_movement()` + `trg_apply_animal_movement` (AFTER INSERT en
  `animal_movements`).
- `apply_mortality_event()` + `trg_apply_mortality_event` (AFTER INSERT en
  `health_events`).

### Vista, privilegios y RLS

- Vista `v_animals_current` creada con **`security_invoker = true`**.
- **Privilegios**: `REVOKE ALL` de `anon` y de `PUBLIC`. El acceso de
  `authenticated` queda gobernado por la RLS de las tablas base.
- RLS habilitado en las 7 tablas; única política `profile_select_own` en `profiles`.

## Dependencias entre objetos

```
auth.users ──► profiles ──► animals.created_by
                   │            ▲
areas ──► pens ────┼──► animals.current_pen_id / movements.*_pen_id
                   │
animals ──► animals (mother_id, father_id)
animals ──► litters (mother_id, father_id)
litters ──► animals.litter_id        (ciclo animals <-> litters)
animals ──► animal_movements ──► (trigger) animals
animals ──► health_events    ──► (trigger) animals
animals/pens/areas ──► v_animals_current (security_invoker)
```

El ciclo `animals <-> litters` obliga a crear `animals` sin la FK a `litters`,
crear `litters` y luego añadir `fk_animals_litter`.

## Diferencias intencionales respecto a `PorciControl_BD_inicial.txt`

Todas están aprobadas y documentadas. Se separan en **semánticas** (afectan
reglas de negocio o seguridad) y **no semánticas** (empaquetado/ejecución).

### Semánticas

1. **Vista con `security_invoker = true`** (nuevo). El original creaba la vista
   con privilegios del propietario, lo que podía **evadir RLS**. Ahora respeta la
   RLS de las tablas base. Requiere PostgreSQL 15+.
2. **Privilegios de la vista**: `REVOKE ALL` sobre `anon` y `PUBLIC` (nuevo). El
   original no ajustaba privilegios; el proyecto exige no dar acceso anónimo a
   datos operativos (especificación §8).
3. **Índice de arete normalizado** (cambiado): de `(ear_tag_code)` a
   `(lower(btrim(ear_tag_code)))`. El original solo ignoraba espacios internos y
   distinguía mayúsculas; la especificación 4.1 pide unicidad insensible a caja y
   a espacios externos. La condición parcial no cambia.
4. **CHECK `animals.origin`** (nuevo): admite `born_on_farm`, `purchased`,
   `transferred_in`, `unknown`; **NULL permitido** (ver nota). El original dejaba
   `origin` como `TEXT` libre.

### No semánticas

5. **Extensión `pgcrypto` eliminada**: el original hacía
   `CREATE EXTENSION IF NOT EXISTS pgcrypto`. No es necesaria porque
   `gen_random_uuid()` es del núcleo desde PostgreSQL 13, y se evita operar sobre
   extensiones administradas por Supabase.
6. **Envuelta en `BEGIN; ... COMMIT;`** (ejecución atómica).
7. **Comprobación previa ampliada**: detecta conflictos en los 7 nombres de
   tabla y la vista (cualquier clase de relación en `public`, sin restringir
   `relkind`), 6 tipos, funciones, índices con nombre propio, triggers y
   política; ignora objetos internos de Supabase.
8. **Comprobación de versión** PostgreSQL ≥ 15 (por `security_invoker`).
9. Comentarios ampliados (alcance, reservas, advertencias) y encabezado de versión.

### Comportamiento de NULL en `origin` (decisión explícita)

- `origin` **sigue siendo opcional**; el CHECK es `origin IS NULL OR origin IN (...)`.
- **NULL se permite** y significa "origen **no registrado**". Es válido para
  históricos, compras o transferencias sin información, y evita bloquear datos
  incompletos (coherente con la especificación §4.3 sobre no exigir completitud).
- **`unknown` es un valor explícito distinto de NULL**: indica "se registró el
  origen y se determinó que era desconocido". No se debe colapsar NULL en
  `'unknown'` de forma automática.

## Reservado para migraciones posteriores (NO incluido en 001)

| Migración propuesta | Contenido | Motivo |
|---|---|---|
| 002 | **Aprovisionamiento de perfiles**: trigger en `auth.users` o flujo administrado; asignación de rol explícita (evitar que quede `viewer`). | Requiere decisión de seguridad y pruebas. |
| 003 | **Políticas RLS operativas** por rol + privilegios de columna; ajuste definitivo de privilegios de la vista. | Requiere diseño y pruebas por acción, no solo por tabla. |
| 004 | Revisión adicional de la vista y de `set_updated_at` (`search_path`). | Endurecimiento. |
| 005 | **Endurecer `apply_animal_movement` / `apply_mortality_event`**: `search_path`, coherencia de estado, bloqueo de movimientos tras venta/muerte/salida, idempotencia. | Reglas de negocio sensibles. |
| 006 | Tabla `animal_registration_requests` + generación segura de `animal_code` (`PIG-000001` con secuencia). | Flujo funcional aún sin implementar. |

Correcciones pendientes de evaluar (con datos reales o con aprobación):

- `health_events.documented_by` (hoy `TEXT`): revisar si debe ser FK a `profiles`.
- `animals.animal_code`: evaluar CHECK de formato (`PIG-` + dígitos) si la
  generación queda en base de datos.

## Estrategia de verificación

### Antes de aplicar

1. **Identidad del proyecto (obligatorio, en el Dashboard).** Comprobar en el
   panel de Supabase que el proyecto seleccionado es el de **desarrollo**
   ("PigTecBD") y anotar su **project ref** (aparece en la URL del Dashboard y en
   la cadena de conexión). `current_database()` y `current_user` **no** identifican
   de forma inequívoca el proyecto (en Supabase suelen ser `postgres`/`postgres`),
   así que **no** sirven como control de seguridad. Verificar primero en el panel.
2. **Base vacía (solo lectura).** Confirmar que no existe ningún objeto de
   PigTec. Se consulta `pg_class`/`pg_namespace` **sin restringir `relkind`**,
   igual que la comprobación previa del SQL: así se detecta cualquier clase de
   relación con esos nombres (tabla, vista, vista materializada, tabla foránea,
   partición, etc.), incluso si `information_schema` no la muestra.

```sql
-- Debe devolver 0 filas
SELECT c.relname, c.relkind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('profiles','areas','pens','animals','litters',
                    'animal_movements','health_events','v_animals_current');
```

3. Confirmar que existe el esquema de Auth (lo aporta Supabase, no lo crea la
   migración):

```sql
SELECT to_regclass('auth.users');
```

### Después de aplicar (solo lectura)

```sql
-- 7 tablas
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY 1;

-- 6 tipos ENUM
SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public' AND t.typtype = 'e' ORDER BY 1;

-- 15 claves foráneas
SELECT count(*) FROM pg_constraint
WHERE contype = 'f' AND connamespace = 'public'::regnamespace;

-- 11 CHECK
SELECT count(*) FROM pg_constraint
WHERE contype = 'c' AND connamespace = 'public'::regnamespace;

-- 15 índices (incluye uq_animals_ear_tag_code normalizado)
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' ORDER BY 1;

-- CHECK de origin
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conname = 'chk_animals_origin';

-- 8 triggers (sin duplicaciones; excluye los triggers internos de PostgreSQL)
SELECT c.relname AS tabla, t.tgname AS trigger
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND NOT t.tgisinternal
ORDER BY 1, 2;

-- 3 funciones
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' ORDER BY 1;

-- Vista presente y con security_invoker = true
SELECT viewname FROM pg_views WHERE schemaname = 'public';
SELECT relname, reloptions FROM pg_class WHERE relname = 'v_animals_current';
-- esperado: reloptions = {security_invoker=true}

-- Privilegios de la vista: anon no debe aparecer
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'v_animals_current' ORDER BY 1, 2;

-- RLS activado en las 7 tablas
SELECT relname, relrowsecurity FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1;

-- Única política esperada: profile_select_own
SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public';
```

### Pruebas funcionales

Las funciones `apply_*` y la vista no se pueden probar sin datos. Según la
especificación (D-10), eso se hará con **datos sintéticos claramente marcados**
en una fase posterior, no en esta migración. Alternativa: un `BEGIN; ... ROLLBACK;`
con inserciones temporales que nunca se confirman, siempre con aprobación.

Si algo falla, la transacción revierte por completo: **no queda estado parcial**.
Corregir el script y volver a ejecutar desde una base limpia.

## Estado

`001_initial_schema.sql` es una **propuesta corregida**. No se ha ejecutado ni
conectado a ningún proyecto Supabase.
