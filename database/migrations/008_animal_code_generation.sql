-- ============================================================================
-- PigTec - Migracion 008: generacion automatica y segura de animal_code
-- ----------------------------------------------------------------------------
-- Archivo:    database/migrations/008_animal_code_generation.sql
-- Motor:      PostgreSQL 15+ en Supabase (proyecto de DESARROLLO: PigTecBD)
-- Depende de: 001_initial_schema.sql (public.animals con animal_code NOT NULL
--             UNIQUE), 004_animals_rls.sql (privilegios/RLS de animals) y
--             005_movements_integrity_rls.sql (guardia trg_animals_derived_guard
--             y privilegios de columna de animals).
-- Estado:     PROPUESTA. NO ejecutada. Requiere revision y aprobacion.
-- ----------------------------------------------------------------------------
-- OBJETIVO
--   Generar `public.animals.animal_code` de forma automatica, unica y transac-
--   cional al registrar un porcino, sin depender del cliente. Formato aprobado
--   por la especificacion maestra (4.1 y decision D-03): `PIG-000001`,
--   `PIG-000002`, ...
--
-- MECANISMO
--   1. Secuencia dedicada `public.animals_animal_code_seq` (nunca MAX()+1; los
--      saltos por operaciones fallidas son aceptables: 4.1).
--   2. Sincronizacion de la secuencia con el MAXIMO codigo existente que ya
--      siga el formato `PIG-<digitos>`, para no colisionar con los animales ya
--      registrados. Se toma un bloqueo de tabla para que ningun alta concurrente
--      se cuele entre el calculo del maximo y el setval.
--   3. Trigger BEFORE INSERT que asigna el codigo SOLO cuando no viene uno
--      explicito (NULL o vacio). Nunca reescribe codigos existentes.
--   4. Trigger BEFORE UPDATE que rechaza cualquier cambio de `animal_code`
--      (permanente e inmutable: 4.1). Defensa en profundidad: la migracion 005
--      ya revoca el privilegio UPDATE de esa columna al rol authenticated y el
--      backend no la expone en PATCH.
--   5. La funcion de generacion es SECURITY DEFINER con search_path fijo: el
--      rol authenticated no necesita USAGE sobre la secuencia.
--
-- QUE NO HACE (a proposito)
--   - NO cambia `animal_code` de los porcinos ya registrados.
--   - NO confunde `animal_code` con `ear_tag_code` (el arete sigue siendo un
--     campo independiente y opcional).
--   - NO altera las migraciones 001-007 ni crea/modifica politicas RLS.
--   - NO concede acceso a anon/PUBLIC ni usa service_role.
--   - NO anade un CHECK de formato `PIG-<digitos>`: podria invalidar codigos
--     historicos legitimos no generados. Queda como correccion pendiente.
--
-- ATOMICIDAD
--   Todo el script corre en una transaccion. Comprueba precondiciones y aborta
--   si ya fue aplicada, para evitar reejecuciones accidentales.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. Comprobaciones previas
--    a) 001 aplicada: public.animals existe, `animal_code` es NOT NULL y tiene
--       una restriccion UNIQUE.
--    b) 008 no aplicada aun: no existen la secuencia, la funcion ni el trigger.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_col_notnull integer;
    v_unique      integer;
    ya_existe     text[];
BEGIN
    IF to_regclass('public.animals') IS NULL THEN
        RAISE EXCEPTION
            'Migracion 008 abortada: no existe public.animals. Aplique primero 001_initial_schema.sql.';
    END IF;

    -- animal_code existe y es NOT NULL.
    SELECT count(*) INTO v_col_notnull
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'animals'
       AND a.attname = 'animal_code'
       AND a.attnum > 0
       AND NOT a.attisdropped
       AND a.attnotnull;

    IF v_col_notnull = 0 THEN
        RAISE EXCEPTION
            'Migracion 008 abortada: public.animals.animal_code no existe o no es NOT NULL.';
    END IF;

    -- animal_code tiene un indice/restriccion UNIQUE de una sola columna.
    SELECT count(*) INTO v_unique
      FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'animals'
       AND i.indisunique
       AND i.indnatts = 1
       AND i.indkey[0] = (
           SELECT a2.attnum
             FROM pg_catalog.pg_attribute a2
            WHERE a2.attrelid = c.oid
              AND a2.attname = 'animal_code'
              AND a2.attnum > 0
              AND NOT a2.attisdropped
       );

    IF v_unique = 0 THEN
        RAISE EXCEPTION
            'Migracion 008 abortada: public.animals.animal_code no tiene una restriccion UNIQUE.';
    END IF;

    -- La migracion no debe haberse aplicado ya.
    SELECT array_agg(objeto ORDER BY objeto) INTO ya_existe
      FROM (
          SELECT 'secuencia public.animals_animal_code_seq' AS objeto
           WHERE to_regclass('public.animals_animal_code_seq') IS NOT NULL
          UNION ALL
          SELECT 'funcion public.assign_animal_code'
           WHERE EXISTS (
               SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = 'assign_animal_code'
           )
          UNION ALL
          SELECT 'trigger trg_animals_assign_code'
           WHERE EXISTS (
               SELECT 1 FROM pg_trigger t
               JOIN pg_class c ON c.oid = t.tgrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public'
                  AND c.relname = 'animals'
                  AND t.tgname = 'trg_animals_assign_code'
                  AND NOT t.tgisinternal
           )
      ) d;

    IF ya_existe IS NOT NULL THEN
        RAISE EXCEPTION
            'Migracion 008 abortada: ya existen objetos de esta migracion (%). Revise el estado antes de continuar.',
            array_to_string(ya_existe, ', ');
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 1. Secuencia dedicada de codigos PigTec
--    Sin MAX()+1. Los saltos por transacciones fallidas son aceptables (4.1).
--    Privilegios: se revoca TODO a PUBLIC/anon/authenticated; la consume la
--    funcion SECURITY DEFINER, no el cliente.
-- ----------------------------------------------------------------------------
CREATE SEQUENCE public.animals_animal_code_seq
    AS bigint
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

REVOKE ALL ON SEQUENCE public.animals_animal_code_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.animals_animal_code_seq FROM anon;
REVOKE ALL ON SEQUENCE public.animals_animal_code_seq FROM authenticated;

-- ----------------------------------------------------------------------------
-- 2. Sincronizacion con los codigos existentes (evita colisiones)
--    Se toma un bloqueo de tabla (SHARE) que impide INSERT/UPDATE/DELETE
--    concurrentes sobre animals mientras se calcula el maximo y se ajusta la
--    secuencia: asi ningun alta puede colarse entre el calculo y el setval.
--    El CASE garantiza que el cast a bigint solo se evalua para codigos que
--    cumplen `PIG-<digitos>` (evita errores de conversion).
-- ----------------------------------------------------------------------------
LOCK TABLE public.animals IN SHARE MODE;

DO $$
DECLARE
    v_max bigint;
BEGIN
    SELECT MAX(
               CASE
                   WHEN a.animal_code ~ '^PIG-[0-9]+$'
                   THEN pg_catalog.substring(a.animal_code, 5)::bigint
                   ELSE NULL
               END
           )
      INTO v_max
      FROM public.animals a;

    IF v_max IS NULL THEN
        PERFORM pg_catalog.setval('public.animals_animal_code_seq', 1, false);
        RAISE NOTICE 'PigTec 008: no hay codigos PIG- existentes; la secuencia empieza en 1.';
    ELSE
        PERFORM pg_catalog.setval('public.animals_animal_code_seq', v_max, true);
        RAISE NOTICE 'PigTec 008: secuencia sincronizada tras el maximo existente (%).', v_max;
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Funcion de asignacion e inmutabilidad de animal_code
--    - INSERT: asigna 'PIG-' || lpad(nextval, 6, '0') SOLO si no viene codigo
--      (NULL o vacio). Un codigo explicito se conserva (no se reescriben los
--      codigos ya registrados ni los cargados por procesos de datos).
--    - UPDATE: rechaza cualquier cambio de animal_code (permanente e inmutable).
--    SECURITY DEFINER + search_path = '' con referencias calificadas: el rol
--    authenticated no necesita privilegios sobre la secuencia.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_animal_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.animal_code IS NULL
           OR pg_catalog.btrim(NEW.animal_code) = '' THEN
            NEW.animal_code := 'PIG-' || pg_catalog.lpad(
                pg_catalog.nextval('public.animals_animal_code_seq')::text,
                6,
                '0'
            );
        END IF;
        RETURN NEW;
    END IF;

    -- UPDATE: animal_code es permanente e inmutable (especificacion 4.1).
    IF NEW.animal_code IS DISTINCT FROM OLD.animal_code THEN
        RAISE EXCEPTION
            'animal_code es inmutable una vez creado'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

-- Funcion de trigger: no se invoca directamente. EXECUTE revocado por completo.
REVOKE ALL ON FUNCTION public.assign_animal_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_animal_code() FROM anon;
REVOKE ALL ON FUNCTION public.assign_animal_code() FROM authenticated;

-- ----------------------------------------------------------------------------
-- 4. Trigger sobre public.animals
--    Orden de disparo (alfabetico) compatible con 005:
--      trg_animals_assign_code -> trg_animals_derived_guard -> trg_animals_updated_at
--    La generacion asigna animal_code antes de que la guardia 6.b evalue el
--    alta; la guardia no depende de animal_code.
-- ----------------------------------------------------------------------------
CREATE TRIGGER trg_animals_assign_code
BEFORE INSERT OR UPDATE ON public.animals
FOR EACH ROW EXECUTE FUNCTION public.assign_animal_code();

-- ----------------------------------------------------------------------------
-- 5. Coherencia de propietarios
--    La funcion es SECURITY DEFINER: consume la secuencia con la identidad de su
--    propietario. Si la secuencia y la funcion no comparten propietario, la
--    generacion fallaria en tiempo de ejecucion. Se aborta (rollback total) para
--    no dejar un trigger roto.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_owner_func name;
    v_owner_seq  name;
BEGIN
    SELECT r.rolname INTO v_owner_func
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
     WHERE n.nspname = 'public' AND p.proname = 'assign_animal_code';

    SELECT r.rolname INTO v_owner_seq
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
     WHERE c.oid = 'public.animals_animal_code_seq'::regclass;

    IF v_owner_func IS DISTINCT FROM v_owner_seq THEN
        RAISE EXCEPTION
            'Migracion 008 abortada: la secuencia (%) y la funcion assign_animal_code (%) deben compartir propietario para que la generacion SECURITY DEFINER pueda consumir la secuencia.',
            v_owner_seq, v_owner_func;
    END IF;
END;
$$;

COMMIT;
-- FIN DE LA MIGRACION 008

-- ============================================================================
-- APLICAR (breve)
--   1) Confirmar en el Dashboard de Supabase que el proyecto es PigTecBD
--      (DESARROLLO). Verificar en el panel ANTES de ejecutar.
--   2) SQL Editor -> pegar TODO este script -> Run como propietario (postgres).
--      Esperado: "Success. No rows returned".
--   3) Si PostgREST sirve esquema cacheado: NOTIFY pgrst, 'reload schema';
--
-- VERIFICACION (solo lectura) - ejecutar despues de aplicar
--   -- Secuencia presente y con el valor correcto (last_value >= max PIG- existente)
--   SELECT last_value, is_called FROM public.animals_animal_code_seq;
--
--   -- Funcion SECURITY DEFINER con search_path fijo y trigger presente
--   SELECT p.proname, p.prosecdef, p.proconfig
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'assign_animal_code';
--   SELECT t.tgname, pg_get_triggerdef(t.oid) AS definicion
--     FROM pg_trigger t
--     JOIN pg_class c ON c.oid = t.tgrelid
--     JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public' AND t.tgname = 'trg_animals_assign_code'
--      AND NOT t.tgisinternal;
--
--   -- Privilegios: la secuencia NO debe concederse a anon/authenticated
--   SELECT c.relname,
--          has_sequence_privilege('anon', c.oid, 'USAGE')          AS anon_usage,
--          has_sequence_privilege('authenticated', c.oid, 'USAGE') AS auth_usage
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public' AND c.relname = 'animals_animal_code_seq';
--     -- esperado: anon_usage = false, auth_usage = false
--
--   -- Columnas de animals con UPDATE para authenticated (animal_code NO debe
--   -- aparecer; se conserva la restriccion de la migracion 005)
--   SELECT column_name
--     FROM information_schema.column_privileges
--    WHERE table_schema = 'public' AND table_name = 'animals'
--      AND grantee = 'authenticated' AND privilege_type = 'UPDATE'
--    ORDER BY column_name;
--
-- PRUEBA FUNCIONAL SUGERIDA (solo PigTecBD, datos SINTETICOS, requiere
-- aprobacion aparte; puede hacerse con BEGIN; ... ROLLBACK;):
--   - INSERT en animals sin animal_code -> la base asigna 'PIG-<max+1>'.
--   - Dos altas simultaneas -> dos codigos distintos (sin colision).
--   - UPDATE de animal_code -> rechazado (inmutable).
--   - Alta con codigo explicito -> se conserva (no se sobrescribe).
-- ============================================================================
