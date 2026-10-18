-- ============================================================================
-- PigTec - S6-A.1: VERIFICACION DE SOLO LECTURA de las migraciones 006/007/008
-- ----------------------------------------------------------------------------
-- Archivo:    database/verification/s6a1_readonly_migrations_check.sql
-- Proposito:  Comprobar el ESTADO REAL de la base de desarrollo (PigTecBD) y
--             distinguirlo de la evidencia documental. Verifica si estan
--             aplicadas las migraciones propuestas:
--               006 -> RLS de public.litters (camadas).
--               007 -> RLS de public.health_events (sanidad).
--               008 -> generacion automatica de public.animals.animal_code
--                      (secuencia + funcion + trigger).
--             y, de paso, confirma que siguen presentes los objetos de
--             001/002/003/004/005 de los que dependen.
--
-- TIPO:       *** SOLO LECTURA ***
--             Consulta UNICAMENTE METADATOS del catalogo de PostgreSQL
--             (pg_catalog, information_schema y funciones has_*_privilege()).
--             NO ejecuta INSERT, UPDATE, DELETE, ALTER, CREATE, DROP ni
--             TRUNCATE. NO llama a funciones que modifiquen datos
--             (nextval, setval, RPC administrativas, etc.). No lee filas de
--             tablas de negocio.
--
-- QUE NO HACE:
--             - No modifica la base de datos ni ningun objeto.
--             - No revela credenciales ni valores de configuracion.
--             - No confirma ni instala migraciones: solo informa de lo que YA
--               existe en el catalogo.
--
-- COMO SE USA (manual, por el responsable del proyecto):
--   1) Supabase -> proyecto de DESARROLLO (PigTecBD) -> SQL Editor.
--   2) Pegar TODO este script y pulsar Run.
--   3) Todo el archivo es UNA sola sentencia SELECT: el editor devuelve UNA
--      tabla (columnas: bloque | objeto | estado | detalle), ordenada por
--      bloque y objeto.
--   4) Interpretacion rapida:
--        - estado = 'PRESENTE' / 'OK' / 'CONCEDIDO' / 'ACTIVADO'  => correcto.
--        - estado = 'POR COLUMNA'  => correcto POR DISENO (005): el UPDATE de
--          tabla completa sobre public.animals esta revocado a proposito y el
--          UPDATE se concede solo por columna (bloque 9). NO procede ningun
--          `GRANT UPDATE` general sobre animals.
--        - estado = 'FALTA' / 'NO CONCEDIDO'                       => revisar.
--        - 'N/D'    => el objeto padre no existe (no se puede evaluar).
--        - 'INFO'   => dato informativo, no una comprobacion binaria.
--      El veredicto por migracion se lee asi:
--        006 aplicada  <=> bloques 1-2, 6 (litters_*), 7 y 8 (litters) OK.
--        007 aplicada  <=> bloques 1-2, 6 (health_events_*), 7 y 8 OK.
--        008 aplicada  <=> bloque 3 (secuencia), 4 (assign_animal_code),
--                          5 (trg_animals_assign_code) y 9 OK.
--
--      Nota sobre `animals` y UPDATE: el bloque 8 comprueba el privilegio A
--      NIVEL DE TABLA y el bloque 9 el privilegio POR COLUMNA. En `animals` se
--      espera NO tener UPDATE de tabla (005 lo revoca) y SI tener UPDATE en las
--      columnas editables. Un 'POR COLUMNA' en el bloque 8 es el resultado
--      correcto, no una carencia de permisos.
--
-- ADVERTENCIA: ejecutar en el proyecto de DESARROLLO. Este script no escribe
--             nada, pero conviene confirmar el proyecto en el panel antes de
--             pegar cualquier SQL (la identidad del proyecto no se puede
--             deducir de forma inequivoca con SQL).
-- ============================================================================

WITH esperado_funciones(nombre) AS (
    VALUES
        ('set_updated_at'),
        ('apply_animal_movement'),
        ('apply_mortality_event'),
        ('forbid_animal_movement_change'),
        ('guard_animal_derived_change'),
        ('assign_animal_code'),
        ('handle_new_user'),
        ('admin_set_profile_access')
),
esperado_columnas(tabla, columna) AS (
    VALUES
        ('animals', 'animal_code'),
        ('animals', 'ear_tag_code'),
        ('animals', 'sex'),
        ('animals', 'breed'),
        ('animals', 'birth_date'),
        ('animals', 'origin'),
        ('animals', 'mother_id'),
        ('animals', 'father_id'),
        ('animals', 'litter_id'),
        ('animals', 'current_pen_id'),
        ('animals', 'status'),
        ('animals', 'entry_date'),
        ('animals', 'exit_date'),
        ('animals', 'notes'),
        ('animals', 'created_by'),
        ('litters', 'id'),
        ('litters', 'litter_code'),
        ('litters', 'mother_id'),
        ('litters', 'father_id'),
        ('litters', 'birth_date'),
        ('litters', 'total_born'),
        ('litters', 'born_alive'),
        ('litters', 'stillborn'),
        ('litters', 'notes'),
        ('health_events', 'id'),
        ('health_events', 'animal_id'),
        ('health_events', 'event_type'),
        ('health_events', 'occurred_at'),
        ('health_events', 'title'),
        ('health_events', 'description'),
        ('health_events', 'documented_by'),
        ('health_events', 'details'),
        ('health_events', 'attachment_url'),
        ('health_events', 'recorded_by')
),
esperado_triggers(esquema, tabla, nombre) AS (
    VALUES
        ('public', 'animals',         'trg_animals_assign_code'),
        ('public', 'animals',         'trg_animals_derived_guard'),
        ('public', 'animals',         'trg_animals_updated_at'),
        ('public', 'animal_movements','trg_apply_animal_movement'),
        ('public', 'animal_movements','trg_animal_movements_immutable'),
        ('public', 'health_events',   'trg_apply_mortality_event'),
        ('public', 'health_events',   'trg_health_events_updated_at'),
        ('public', 'litters',         'trg_litters_updated_at'),
        ('auth',   'users',           'on_auth_user_created')
),
esperado_politicas(tabla, politica, migracion) AS (
    VALUES
        ('profiles',             'profile_select_own',              '001'),
        ('profile_access_audit', 'profile_access_audit_select_admin','002'),
        ('areas',                'areas_select_operational',        '003'),
        ('areas',                'areas_insert_admin_manager',      '003'),
        ('areas',                'areas_update_admin_manager',      '003'),
        ('pens',                 'pens_select_operational',         '003'),
        ('pens',                 'pens_insert_admin_manager',       '003'),
        ('pens',                 'pens_update_admin_manager',       '003'),
        ('animals',              'animals_select_operational',      '004'),
        ('animals',              'animals_insert_admin_manager',    '004'),
        ('animals',              'animals_update_admin_manager',    '004'),
        ('animal_movements',     'movements_select_operational',    '005'),
        ('animal_movements',     'movements_insert_by_reason',      '005'),
        ('litters',              'litters_select_operational',      '006'),
        ('litters',              'litters_insert_operational',      '006'),
        ('litters',              'litters_update_operational',      '006'),
        ('health_events',        'health_events_select_operational','007'),
        ('health_events',        'health_events_insert_operational','007')
),
esperado_rls(tabla) AS (
    VALUES
        ('profiles'), ('areas'), ('pens'), ('animals'),
        ('litters'), ('animal_movements'), ('health_events')
),
-- Columnas de public.animals: UPDATE permitido (005) / prohibido (derivadas).
-- Se define ANTES de esperado_privilegios porque el bloque 8 lo consulta para
-- distinguir el UPDATE de tabla completa del UPDATE concedido por columna.
esperado_col_update(tabla, columna, puede) AS (
    VALUES
        ('animals', 'ear_tag_code', 'SI'),
        ('animals', 'sex',          'SI'),
        ('animals', 'breed',        'SI'),
        ('animals', 'birth_date',   'SI'),
        ('animals', 'origin',       'SI'),
        ('animals', 'mother_id',    'SI'),
        ('animals', 'father_id',    'SI'),
        ('animals', 'litter_id',    'SI'),
        ('animals', 'status',       'SI'),
        ('animals', 'notes',        'SI'),
        ('animals', 'updated_at',   'SI'),
        ('animals', 'animal_code',  'NO'),
        ('animals', 'current_pen_id','NO'),
        ('animals', 'exit_date',    'NO'),
        ('animals', 'entry_date',   'NO'),
        ('animals', 'created_by',   'NO')
),
esperado_privilegios(tabla, rol, privilegio, esperado) AS (
    VALUES
        ('litters',          'authenticated', 'SELECT', 'CONCEDIDO'),
        ('litters',          'authenticated', 'INSERT', 'CONCEDIDO'),
        ('litters',          'authenticated', 'UPDATE', 'CONCEDIDO'),
        ('litters',          'authenticated', 'DELETE', 'NO CONCEDIDO'),
        ('litters',          'anon',          'SELECT', 'NO CONCEDIDO'),
        ('health_events',    'authenticated', 'SELECT', 'CONCEDIDO'),
        ('health_events',    'authenticated', 'INSERT', 'CONCEDIDO'),
        ('health_events',    'authenticated', 'UPDATE', 'NO CONCEDIDO'),
        ('health_events',    'authenticated', 'DELETE', 'NO CONCEDIDO'),
        ('health_events',    'anon',          'SELECT', 'NO CONCEDIDO'),
        ('animals',          'authenticated', 'SELECT', 'CONCEDIDO'),
        ('animals',          'authenticated', 'INSERT', 'CONCEDIDO'),
        -- 005 revoca el UPDATE de tabla completa sobre animals y concede
        -- UPDATE solo por columna (ver bloque 9). El resultado correcto es
        -- 'POR COLUMNA'; NO proceder con un `GRANT UPDATE` general.
        ('animals',          'authenticated', 'UPDATE', 'POR COLUMNA (005)'),
        ('animals',          'authenticated', 'DELETE', 'NO CONCEDIDO'),
        ('animal_movements', 'authenticated', 'SELECT', 'CONCEDIDO'),
        ('animal_movements', 'authenticated', 'INSERT', 'CONCEDIDO'),
        ('animal_movements', 'authenticated', 'UPDATE', 'NO CONCEDIDO'),
        ('animal_movements', 'authenticated', 'DELETE', 'NO CONCEDIDO'),
        ('areas',            'authenticated', 'SELECT', 'CONCEDIDO'),
        ('areas',            'authenticated', 'DELETE', 'NO CONCEDIDO'),
        ('pens',             'authenticated', 'SELECT', 'CONCEDIDO'),
        ('pens',             'authenticated', 'DELETE', 'NO CONCEDIDO')
)
-- ---------------------------------------------------------------------------
-- 0. ENTORNO (informativo)
-- ---------------------------------------------------------------------------
SELECT '0 Entorno' AS bloque,
       'servidor' AS objeto,
       'INFO' AS estado,
       current_database() || ' | ' || current_user || ' | ' || version() AS detalle

UNION ALL
SELECT '0 Entorno', 'PostgreSQL >= 15 (requerido por security_invoker)',
       CASE WHEN current_setting('server_version_num')::int >= 150000
            THEN 'OK' ELSE 'FALTA' END,
       current_setting('server_version')

-- ---------------------------------------------------------------------------
-- 1. TABLAS REQUERIDAS
-- ---------------------------------------------------------------------------
UNION ALL
SELECT '1 Tablas', 'public.' || t.nombre,
       CASE WHEN to_regclass('public.' || t.nombre) IS NOT NULL
            THEN 'PRESENTE' ELSE 'FALTA' END,
       COALESCE('relkind=' || (SELECT c.relkind::text
                                 FROM pg_catalog.pg_class c
                                WHERE c.oid = to_regclass('public.' || t.nombre)),
                'no existe')
FROM (VALUES ('profiles'), ('areas'), ('pens'), ('animals'),
             ('litters'), ('animal_movements'), ('health_events'),
             ('profile_access_audit'), ('v_animals_current'))
     AS t(nombre)

-- ---------------------------------------------------------------------------
-- 2. COLUMNAS REQUERIDAS (animals / litters / health_events)
-- ---------------------------------------------------------------------------
UNION ALL
SELECT '2 Columnas', c.tabla || '.' || c.columna,
       CASE WHEN col.column_name IS NOT NULL THEN 'PRESENTE' ELSE 'FALTA' END,
       COALESCE(col.data_type
                || CASE WHEN col.is_nullable = 'NO' THEN ' NOT NULL' ELSE ' NULL' END,
                'no existe')
FROM esperado_columnas c
LEFT JOIN information_schema.columns col
       ON col.table_schema = 'public'
      AND col.table_name   = c.tabla
      AND col.column_name  = c.columna

-- ---------------------------------------------------------------------------
-- 3. SECUENCIA DE animal_code (migracion 008)
-- ---------------------------------------------------------------------------
UNION ALL
SELECT '3 Secuencia animal_code', 'public.animals_animal_code_seq',
       CASE WHEN to_regclass('public.animals_animal_code_seq') IS NOT NULL
            THEN 'PRESENTE' ELSE 'FALTA' END,
       COALESCE('relkind=' || (SELECT c.relkind::text FROM pg_catalog.pg_class c
                                WHERE c.oid = to_regclass('public.animals_animal_code_seq')),
                'no existe (008 no aplicada)')

-- ---------------------------------------------------------------------------
-- 4. FUNCIONES REQUERIDAS (001/002/005/008)
-- ---------------------------------------------------------------------------
UNION ALL
SELECT '4 Funciones', 'public.' || f.nombre || '()',
       CASE WHEN EXISTS (SELECT 1
                           FROM pg_catalog.pg_proc p
                           JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                          WHERE n.nspname = 'public' AND p.proname = f.nombre)
            THEN 'PRESENTE' ELSE 'FALTA' END,
       COALESCE((SELECT 'security_definer='
                        || bool_or(p.prosecdef)::text
                        || ', search_path='
                        || COALESCE(min(array_to_string(p.proconfig, ',')),
                                    '(sin fijar)')
                   FROM pg_catalog.pg_proc p
                   JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = f.nombre),
                'no existe')
FROM esperado_funciones f

-- ---------------------------------------------------------------------------
-- 5. TRIGGERS REQUERIDOS (001/002/005/008)
-- ---------------------------------------------------------------------------
UNION ALL
SELECT '5 Triggers', tr.esquema || '.' || tr.tabla || ' -> ' || tr.nombre,
       CASE WHEN EXISTS (
                SELECT 1
                  FROM pg_catalog.pg_trigger tg
                  JOIN pg_catalog.pg_class c     ON c.oid = tg.tgrelid
                  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = tr.esquema
                   AND c.relname = tr.tabla
                   AND tg.tgname = tr.nombre
                   AND NOT tg.tgisinternal)
            THEN 'PRESENTE' ELSE 'FALTA' END,
       CASE WHEN to_regclass(tr.esquema || '.' || tr.tabla) IS NULL
            THEN 'la tabla no existe' ELSE 'OK' END
FROM esperado_triggers tr

-- ---------------------------------------------------------------------------
-- 6. POLITICAS RLS (001/002/003/004/005/006/007)
-- ---------------------------------------------------------------------------
UNION ALL
SELECT '6 Politicas RLS', p.tabla || ' / ' || p.politica || ' [mig ' || p.migracion || ']',
       CASE WHEN EXISTS (
                SELECT 1 FROM pg_catalog.pg_policies pp
                 WHERE pp.schemaname = 'public'
                   AND pp.tablename  = p.tabla
                   AND pp.policyname = p.politica)
            THEN 'PRESENTE' ELSE 'FALTA' END,
       COALESCE((SELECT pp.cmd || ' | roles=' || array_to_string(pp.roles, ',')
                   FROM pg_catalog.pg_policies pp
                  WHERE pp.schemaname = 'public'
                    AND pp.tablename  = p.tabla
                    AND pp.policyname = p.politica),
                'no existe')
FROM esperado_politicas p

-- ---------------------------------------------------------------------------
-- 7. RLS HABILITADO EN LAS TABLAS
-- ---------------------------------------------------------------------------
UNION ALL
SELECT '7 RLS habilitado', 'public.' || r.tabla,
       CASE WHEN c.relrowsecurity THEN 'ACTIVADO'
            WHEN c.oid IS NULL THEN 'FALTA' ELSE 'DESACTIVADO' END,
       COALESCE('relrowsecurity=' || c.relrowsecurity::text, 'la tabla no existe')
FROM esperado_rls r
LEFT JOIN pg_catalog.pg_class c ON c.oid = to_regclass('public.' || r.tabla)

-- ---------------------------------------------------------------------------
-- 8. PRIVILEGIOS DE TABLA (authenticated / anon)
--    Distingue el UPDATE A NIVEL DE TABLA del UPDATE POR COLUMNA: en
--    `animals`, 005 revoca el UPDATE de tabla y concede solo las columnas
--    editables (bloque 9). Un 'POR COLUMNA' aqui es correcto por diseno; NO
--    procede anadir un `GRANT UPDATE` general sobre `animals`.
-- ---------------------------------------------------------------------------
UNION ALL
SELECT '8 Privilegios', pr.tabla || ' -> ' || pr.rol || ' : ' || pr.privilegio,
       CASE
         WHEN to_regclass('public.' || pr.tabla) IS NULL THEN 'N/D'
         WHEN has_table_privilege(pr.rol::name,
                                  ('public.' || pr.tabla)::text,
                                  pr.privilegio::text)
         THEN 'CONCEDIDO'
         WHEN pr.tabla = 'animals' AND pr.privilegio = 'UPDATE'
              AND NOT EXISTS (
                    SELECT 1
                      FROM esperado_col_update cu
                     WHERE cu.tabla = 'animals'
                       AND cu.puede = 'SI'
                       AND NOT has_column_privilege(
                             'authenticated'::name,
                             'public.animals'::text,
                             cu.columna::text,
                             'UPDATE'::text))
         THEN 'POR COLUMNA'
         ELSE 'NO CONCEDIDO'
       END,
       'esperado: ' || pr.esperado
FROM esperado_privilegios pr

-- ---------------------------------------------------------------------------
-- 9. PRIVILEGIOS DE COLUMNA DE public.animals (005: derivadas bloqueadas)
-- ---------------------------------------------------------------------------
UNION ALL
SELECT '9 Columnas UPDATE animals',
       'authenticated : animals.' || cu.columna,
       CASE WHEN to_regclass('public.animals') IS NULL THEN 'N/D'
            WHEN has_column_privilege('authenticated'::name,
                                      'public.animals'::text,
                                      cu.columna::text,
                                      'UPDATE'::text)
            THEN 'CONCEDIDO' ELSE 'NO CONCEDIDO' END,
       CASE WHEN cu.puede = 'SI' THEN 'esperado: CONCEDIDO (editable)'
            ELSE 'esperado: NO CONCEDIDO (derivada/inmutable)' END
FROM esperado_col_update cu

-- ---------------------------------------------------------------------------
-- 10. INDICES UNICOS DE animals.animal_code (001)
-- ---------------------------------------------------------------------------
UNION ALL
SELECT '10 Indices animal_code', 'public.animals (animal_code UNIQUE)',
       CASE WHEN EXISTS (
                SELECT 1
                  FROM pg_catalog.pg_index i
                  JOIN pg_catalog.pg_class c     ON c.oid = i.indrelid
                  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public'
                   AND c.relname = 'animals'
                   AND i.indisunique
                   AND i.indnatts = 1
                   AND i.indkey[0] = (
                       SELECT a.attnum FROM pg_catalog.pg_attribute a
                        WHERE a.attrelid = c.oid
                          AND a.attname = 'animal_code'
                          AND a.attnum > 0
                          AND NOT a.attisdropped))
            THEN 'PRESENTE' ELSE 'FALTA' END,
       'debe existir una restriccion UNIQUE de una sola columna'

                ORDER BY 1, 2;

-- ============================================================================
-- OPCIONAL (ejecutar SOLO si la seccion 3 indica 'PRESENTE'):
--   Valor actual de la secuencia de codigos. Es una LECTURA de la relacion
--   secuencia; NO consume valores (no usa nextval).
-- ----------------------------------------------------------------------------
--   SELECT last_value, is_called FROM public.animals_animal_code_seq;
--
-- OPCIONAL (detalle de politicas): lista todas las politicas de public de golpe.
-- ----------------------------------------------------------------------------
--   SELECT tablename, policyname, cmd, roles
--     FROM pg_catalog.pg_policies
--    WHERE schemaname = 'public'
--    ORDER BY tablename, policyname;
-- ============================================================================
