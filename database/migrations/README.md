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

## 002_profile_provisioning.sql — propuesta (NO ejecutada)

**Depende de:** `001_initial_schema.sql` ya aplicada (`public.profiles` y
`profile_select_own`). **Estado:** revisada (S6-C) y pendiente de **aprobación** y
ejecución.

> **Alcance de las conclusiones:** las afirmaciones de seguridad y concurrencia
> de esta sección provienen de **revisión estática** del SQL; **no** se han
> ejecutado pruebas funcionales ni de concurrencia en PostgreSQL/Supabase.

### Objetivo

Que todo usuario de Supabase Auth tenga un **perfil sin privilegios**
(`role='viewer'`, `is_active=false`) y que **solo un administrador activo** pueda
asignar rol y estado, con **auditoría persistente**. Modelo interno de KolkaPig:
**sin registro público**.

### Objetos que crea

| Objeto | Tipo | Notas |
|---|---|---|
| `public.profile_access_audit` | tabla | Auditoría de cambios de rol/estado. |
| `idx_profile_access_audit_profile` | índice | Búsqueda por usuario y fecha. |
| `profile_access_audit_select_admin` | política RLS | `SELECT` solo a **administradores activos**; sin políticas de escritura. |
| `public.handle_new_user()` | función (trigger) | `SECURITY DEFINER`, `search_path=''`; crea el perfil `viewer`/inactivo. |
| `on_auth_user_created` | trigger | `AFTER INSERT ON auth.users`. |
| `public.admin_set_profile_access(uuid, user_role, boolean)` | RPC | `SECURITY DEFINER`, `search_path=''`; solo admin activo; audita. |

Además ajusta **privilegios revisados** (no solo tablas): `PUBLIC` y `anon` sin
acceso a `profiles`/auditoría; `authenticated` **solo `SELECT`** en ambas (la
auditoría, además, **sujeta a RLS**); `EXECUTE` de las funciones restringido (la
RPC solo a `authenticated`; la función de trigger a nadie); **la secuencia de
identidad** de la auditoría se revoca a `PUBLIC`/`anon`/`authenticated`; y el
**esquema `public`** se blinda contra `CREATE` (conservando `USAGE`, necesario
para PostgREST).

La RPC usa además un **bloqueo global transaccional** (`pg_advisory_xact_lock`
con una clave fija de PigTec) para serializar toda la gestión de roles. **No crea
objetos persistentes** (no es tabla, ni secuencia, ni función adicional).

### Arquitectura (resumen)

1. **Alta de usuario** → trigger crea perfil `viewer`/`is_active=false`
   (idempotente con `ON CONFLICT (id) DO NOTHING`). No se deriva el rol de
   `raw_user_meta_data`; solo el `full_name` visible.
   - **Usuarios preexistentes** (en `auth.users` antes de instalar el trigger):
     la migración **detecta los perfiles faltantes y los crea** con la misma
     regla `viewer`/inactivo. **No** asigna roles operativos ni activa cuentas;
     requieren una acción explícita del administrador.
2. **Usuario inerte**: `GET /auth/profile` → 403.
3. **Asignación de rol/estado** → solo por `admin_set_profile_access`, que:
   - exige admin **activo** (rol leído de `profiles`, no del JWT); tras bloquear a
     los administradores **revalida al llamante con valores vigentes**, de modo
     que si fue desactivado o degradado por otra transacción **no opera**;
   - valida parámetros y **rechaza activar un `viewer`** (`viewer` ⇒
     `is_active=false` obligatorio);
   - rechaza perfiles inexistentes; impide la **autogestión**;
   - si el rol y el estado pedidos **coinciden** con los actuales, es **no-op**
     (ni `UPDATE` ni auditoría);
   - **protege al último admin activo** (conteo vigente tras el bloqueo);
   - serializa con un **bloqueo global transaccional**
     (`pg_advisory_xact_lock`, clave fija de PigTec) tomado antes de cualquier
     bloqueo de fila; además bloquea las filas de los admins activos
     (`ORDER BY id FOR UPDATE`) como defensa en profundidad;
   - registra auditoría `old → new` en la misma transacción.
4. **Sin escrituras directas**: `profiles` y la auditoría no tienen políticas de
   escritura y se revocan `INSERT/UPDATE/DELETE` al rol `authenticated`; la
   secuencia de la auditoría y el `CREATE` del esquema también quedan revocados.

### Concurrencia y exclusión mutua (READ COMMITTED)

La RPC corre bajo PostgreSQL **READ COMMITTED**. Para evitar carreras al cambiar
roles/estados se combinan dos mecanismos:

1. **Bloqueo global transaccional** `pg_advisory_xact_lock(<clave fija>)`, tomado
   **antes de cualquier bloqueo de fila** y liberado automáticamente en
   `COMMIT`/`ROLLBACK`. Está diseñado para que **solo una** gestión de roles corra
   a la vez, exista o no algún administrador activo.
2. **Bloqueo de filas** de los admins activos en **orden estable por `id`**
   (`ORDER BY id FOR UPDATE`), más la relectura del llamante y el bloqueo del
   destino. Aporta valores vigentes y protege frente a SQL directo privilegiado.

Conclusiones del **análisis estático** (pendientes de prueba funcional en
PostgreSQL; **no** se han ejecutado pruebas de concurrencia reales):

- **Dos admins que intentan degradar/desactivar al otro a la vez**: uno toma el
  bloqueo global y el otro espera; al continuar, el segundo **relee su propio
  estado** y, si perdió privilegios, **aborta** (`42501`). No debería quedar el
  sistema con cero admins activos.
- **Un admin pierde privilegios mientras otra transacción espera bloqueos**: al
  adquirir el bloqueo se **relee** su rol/estado; si ya no es admin activo →
  `no autorizado`.
- **Promoción concurrente de nuevos admins**: queda serializada por el bloqueo
  global; el conteo del último admin se calcula sobre un conjunto estable.
- **Deadlocks**: el orden de bloqueo es uniforme
  (`global → admins por id → llamante → destino`); no se identificaron esperas
  cruzadas entre RPC en el análisis.

El patrón aislado `SELECT ... ORDER BY id FOR UPDATE` sobre los admins activos
**ya** debería serializar entre RPC (todas bloquean el mismo conjunto no vacío);
el bloqueo global lo hace **explícito y más fácil de razonar**, sin depender de
detalles finos de READ COMMITTED/EPQ. Frente a cambios por **SQL directo
privilegiado** (fuera de la RPC) no hay exclusión total; por eso se revocan,
además, las escrituras directas de `authenticated`.

### Seguridad (`SECURITY DEFINER`)

- Solo dos funciones son `SECURITY DEFINER`, ambas con `SET search_path = ''` y
  referencias **totalmente calificadas** (`public.*`, `auth.*`, `pg_catalog.*`).
- Propietario = rol de la migración (`postgres`, con `BYPASSRLS`): imprescindible
  para escribir con RLS activo y sin políticas de escritura. **No transferir la
  propiedad** a un rol menor.
- `EXECUTE`: revocado a `PUBLIC`/`anon`; la RPC solo a `authenticated`.
- No se usa `service_role` en ningún punto.
- **Sin vector de escalamiento identificado (revisión estática)**: `authenticated`
  puede *invocar* la RPC, pero la autorización se resuelve **dentro** de la función
  contra `profiles` (no contra el JWT) y exige admin **activo**; además se bloquea
  la autogestión. Un usuario no admin solo obtiene `42501`.
- `auth.uid()` proviene del JWT **firmado** por Supabase (PostgREST), que el
  cliente no puede falsificar. `search_path=''` + `REVOKE CREATE ON SCHEMA public`
  están pensados para impedir el secuestro de resolución de nombres.
- `handle_new_user()` retorna `trigger` y su `EXECUTE` queda revocado: no es
  invocable como RPC; aun si lo fuera, solo inserta un perfil `viewer`/inactivo.
- Estas afirmaciones son **conclusiones de revisión estática**, no de pruebas
  ejecutadas en PostgreSQL/Supabase.

### Privacidad (PII) y conservación

`public.profile_access_audit` almacena **identificadores personales**
(`profile_id`, `actor_id`) y **correos electrónicos** (`actor_email`,
`target_email`). El acceso es de **solo lectura** y limitado a **administradores
activos** (política RLS). La **política de conservación** (plazo de retención y
anonimización) está **pendiente de aprobación**; hasta entonces, no debe
exportarse ni compartirse fuera del entorno de desarrollo.

### Ajuste manual independiente (NO es SQL)

Desactivar el **registro público** en Supabase Auth (Dashboard → Authentication)
y verificarlo manualmente antes de crear cuentas. El SQL no puede garantizarlo.

### Primer administrador (bootstrap manual y auditable)

**No se introducen funciones públicas que permitan reclamar `admin`.** El
bootstrap lo ejecuta el responsable con acceso directo de propietario, **una sola
vez** y **en una sola transacción**, de modo que el cambio y su registro en
`profile_access_audit` sean **atómicos**. El bloque exacto está en la cabecera de
`002_profile_provisioning.sql` (paso manual 2):

1. Verificar PigTecBD en el Dashboard y desactivar el registro público.
2. Crear el usuario admin (email + contraseña) en el Dashboard; el trigger deja su
   perfil `viewer`/inactivo. Anotar su UUID.
3. Ejecutar el bloque `BEGIN; … DO $bootstrap$ … $bootstrap$; … COMMIT;` que:
   - toma el **mismo bloqueo global** que la RPC (no colisiona con ella);
   - rechaza la ejecución si el perfil **ya es** admin activo, si **ya existe**
     otro admin activo, o si el bootstrap **ya se ejecutó** antes (4 guardas);
   - captura el estado previo, hace el `UPDATE` a `role='admin', is_active=TRUE`
     e **inserta el evento inicial** (`actor = el propio perfil`, `actor_email =
     '(bootstrap manual)'`) en la misma transacción.
4. Verificar con `GET /auth/profile` → 200 con `role=admin`.

Por las guardas, según la **revisión estática**, el bootstrap solo debería
ejecutarse una vez y no debería crear varios administradores raíz (pendiente de
prueba funcional). Sin credenciales incrustadas y sin ningún camino desde el
registro público.

### Verificación (solo lectura, tras aplicar)

```sql
-- Objetos de 002
SELECT to_regclass('public.profile_access_audit');
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND proname IN ('handle_new_user','admin_set_profile_access');

-- Trigger sobre auth.users
SELECT t.tgname FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'auth' AND t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal;

-- RLS activado en la auditoría (la política se consulta más abajo)
SELECT relrowsecurity FROM pg_class WHERE oid = 'public.profile_access_audit'::regclass;

-- Privilegios: authenticated sin escritura en profiles; PUBLIC/anon sin acceso
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'profiles'
ORDER BY 1, 2;

-- EXECUTE de las funciones (esperado: RPC true solo para authenticated; trigger false)
SELECT has_function_privilege('authenticated',
  'public.admin_set_profile_access(uuid, public.user_role, boolean)', 'EXECUTE') AS rpc_auth,
       has_function_privilege('anon',
  'public.admin_set_profile_access(uuid, public.user_role, boolean)', 'EXECUTE') AS rpc_anon,
       has_function_privilege('authenticated',
  'public.handle_new_user()', 'EXECUTE') AS trigger_auth;

-- Secuencia de la auditoría: sin USAGE para PUBLIC/anon/authenticated
SELECT c.relname,
       has_sequence_privilege('anon', c.oid, 'USAGE') AS anon_usage,
       has_sequence_privilege('authenticated', c.oid, 'USAGE') AS auth_usage
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'S'
  AND c.relname = 'profile_access_audit_id_seq';

-- Esquema: CREATE revocado
SELECT has_schema_privilege('anon', 'public', 'CREATE') AS anon_create,
       has_schema_privilege('authenticated', 'public', 'CREATE') AS auth_create;

-- La RPC incorpora el bloqueo global transaccional (verificación del cuerpo)
SELECT prosrc ILIKE '%pg_advisory_xact_lock%' AS usa_bloqueo_global
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'admin_set_profile_access';

-- Política RLS de la auditoría (SELECT solo a authenticated)
SELECT policyname, cmd, roles FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'profile_access_audit';

-- Privilegios de la auditoría: solo SELECT para authenticated; PUBLIC/anon sin nada
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'profile_access_audit'
ORDER BY 1, 2;

-- Usuarios anteriores sin perfil (esperado: 0)
SELECT count(*) AS usuarios_sin_perfil
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;
```

### Escenarios de prueba (usuarios/ datos SINTÉTICOS, solo PigTecBD)

**Aprovisionamiento y acceso**
1. Alta de usuario → perfil `viewer`/`is_active=false`, `full_name` no vacío.
2. Idempotencia: perfil preexistente + alta → sin duplicado ni error.
3. `GET /auth/profile`: `viewer`/inactivo → 403; tras asignación → 200.
4. Catálogo `viewer` del JWT vs `profiles`: el rol se lee de la base, no del token.
   - **Usuarios preexistentes**: tras aplicar 002, ninguna cuenta de `auth.users`
     queda sin perfil; las creadas por el *backfill* son `viewer`/inactivo.

**Autorización y validación**
5. RPC por **no-admin** (operator/veterinarian/viewer) → error `42501` (403).
6. RPC **sin sesión** → error `28000`.
7. RPC con `new_role='viewer'` y `new_is_active=true` → **rechazada** (`viewer`
   nunca activo).
8. RPC con parámetros nulos → error `22004`.
9. **Perfil inexistente** → error `P0002`.
10. **Autogestión** (admin sobre sí mismo) → rechazada.

**Reglas y auditoría**
11. RPC por **admin** → aplica y crea **1 fila** de auditoría con `old/new`.
12. **No-op** (mismos rol y estado) → **sin** `UPDATE` y **sin** fila de auditoría.
13. **Último admin activo** (degradarlo/desactivarlo) → rechazado.
14. **Bootstrap inicial** → existe **1 fila** de auditoría con
    `actor_email='(bootstrap manual)'` y `old_role/new_role` coherentes; una
    **segunda ejecución** del bloque es **rechazada** (guardas: admin existente /
    bootstrap previo).

**Concurrencia y degradación**
15. **Concurrencia de administradores**: dos sesiones intentan degradar/desactivar
    a los dos últimos admins a la vez → solo una procede; la otra es rechazada
    (queda ≥ 1 admin activo).
16. **Degradación del llamante**: mientras una sesión A ejecuta la RPC, otra
    transacción desactiva/degrada al admin A → A **no opera** (revalidación
    vigente tras el bloqueo).

**Aislamiento y datos**
17. Escritura directa (`UPDATE profiles SET role=...` como `authenticated`) →
    rechazada por privilegios/RLS; `nextval` de la secuencia → denegado.
18. Lectura de auditoría por **no-admin** → 0 filas; por **admin activo** → filas.
19. **Borrado de cuenta** → perfil eliminado en cascada; **auditoría conservada**.

*(No se ejecuta ninguna de estas pruebas contra Supabase en esta tarea.)*

### Reversión

Hay **dos procedimientos separados** según si existe auditoría que conservar. En
ambos se mantiene una **postura restrictiva**: **no** se concede nada a `anon` ni
escrituras directas a `authenticated`.

#### Opción A — Desarrollo, sin datos de auditoría (nada que conservar)

Solo si `profile_access_audit` está **vacía** y **no** hay que conservarla. La
comprobación se hace **dentro de la misma transacción** que el `DROP`, con un
bloqueo exclusivo, para que no se cuele un registro entre la comprobación y el
borrado. Si hay filas, **aborta sin borrar nada**:

```sql
BEGIN;
-- Bloqueo exclusivo: impide inserciones concurrentes durante comprobación + DROP.
LOCK TABLE public.profile_access_audit IN ACCESS EXCLUSIVE MODE;

-- Guarda atómica: si hay registros, aborta (no se borra nada).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.profile_access_audit) THEN
        RAISE EXCEPTION
            'Reversion A abortada: profile_access_audit contiene registros. Use la Opcion B (conservar auditoria).';
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.admin_set_profile_access(UUID, public.user_role, BOOLEAN);
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP TABLE IF EXISTS public.profile_access_audit;   -- se pierde tabla/índice/secuencia
-- Postura RESTRICTIVA: no se abren escrituras ni se concede nada a anon.
REVOKE ALL ON public.profiles FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM authenticated;
COMMIT;
```

Nota: si `profile_access_audit` no existe (002 nunca aplicada), `LOCK TABLE`
falla; en ese caso no hay nada que revertir.

#### Opción B — Conservando la auditoría existente (recomendada si hay filas)

**No se elimina ningún registro de auditoría sin autorización explícita.** Primero
**exportar/inspeccionar** la auditoría (contiene PII):

```sql
SELECT * FROM public.profile_access_audit ORDER BY changed_at;   -- exportar/copiar
```

```sql
BEGIN;
-- Se eliminan SOLO trigger y funciones. La tabla de auditoría SE CONSERVA
-- (con sus datos, su RLS y sus privilegios restrictivos intactos).
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.admin_set_profile_access(UUID, public.user_role, BOOLEAN);
DROP FUNCTION IF EXISTS public.handle_new_user();
-- Postura RESTRICTIVA: no se abren escrituras ni se concede nada a anon.
REVOKE ALL ON public.profiles FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM authenticated;
COMMIT;
```

#### Dependencias y consecuencias

- **Opción A**: aborta si hay registros (guarda atómica + `LOCK ... ACCESS
  EXCLUSIVE`). Solo si está vacía procede a borrar la tabla; eliminar datos (PII)
  es **irreversible** y **requiere autorización explícita**.
- **Opción B**: deja la tabla de auditoría **huérfana** (sin escritor) pero
  **legible** por admins activos; sus datos se **preservan**.
- En **ambos** casos, `profiles` conserva `viewer`/inactivo y **no habrá forma de
  asignar roles** hasta reimplantar 002 o un equivalente (intencional).
- La vista `v_animals_current` y el resto de objetos de 001 **no** se tocan.
- La clave de bloqueo global (`pg_advisory_xact_lock`) se libera sola al terminar
  las transacciones; no requiere limpieza.

## Reservado para migraciones posteriores (003+)

| Migración propuesta | Contenido | Motivo |
|---|---|---|
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

### Después de aplicar 001 (solo lectura)

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

-- Única política esperada tras 001: profile_select_own
SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public';
```

> **Alcance de este bloque**: los recuentos anteriores corresponden al estado
> **tras aplicar solo 001**. Tras aplicar **002** se suman: **+1 tabla**
> (`profile_access_audit`), **+1 índice**, **+2 funciones**, **+1 trigger** (en
> `auth.users`, **no** en `public`) y **+1 política RLS**. Los ENUM, CHECK y FK no
> cambian. La verificación de 002 está en su propia sección («Verificación»).

### Pruebas funcionales

Las funciones `apply_*` y la vista no se pueden probar sin datos. Según la
especificación (D-10), eso se hará con **datos sintéticos claramente marcados**
en una fase posterior, no en esta migración. Alternativa: un `BEGIN; ... ROLLBACK;`
con inserciones temporales que nunca se confirman, siempre con aprobación.

Si algo falla, la transacción revierte por completo: **no queda estado parcial**.
Corregir el script y volver a ejecutar desde una base limpia.

## Estado

- `001_initial_schema.sql`: **ejecutada** manualmente por el usuario en el
  proyecto de desarrollo **PigTecBD** y con **estructura verificada** (S6-B).
- `002_profile_provisioning.sql`: **propuesta revisada (S6-C), NO ejecutada**.
  Incorpora bloqueo global transaccional, reglas de rol/estado, creación de
  perfiles para **usuarios preexistentes** (viewer/inactivo), reversión en dos
  opciones y bootstrap auditable. Las conclusiones son de **revisión estática**;
  **faltan pruebas funcionales en PostgreSQL**. Requiere **aprobación explícita**
  antes de aplicarla en PigTecBD. No se ha conectado a Supabase ni se ha
  ejecutado SQL.
