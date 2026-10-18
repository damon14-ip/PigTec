-- ============================================================================
-- PigTec - Verificacion TRANSACCIONAL de Sprint 4 (NO es una migracion)
-- ----------------------------------------------------------------------------
-- Archivo:    database/verification/sprint4_transactional_check.sql
-- Depende de: migraciones 001-008 ya aplicadas en PigTecBD.
-- Estado:     GUION DE VERIFICACION MANUAL. El asistente NO lo ejecuta.
-- ----------------------------------------------------------------------------
-- QUE HACE
--   Comprueba, en UNA sola transaccion y SIN confirmarla, el comportamiento
--   real de la base para el Sprint 4 del backend:
--     0.a Precondiciones: existen los objetos de 001/005/008 que la prueba
--         ejercita (si falta alguno, el resultado seria enganoso).
--     0.b Privilegios: la secuencia de codigos y su funcion NO son usables por
--         `authenticated`/`anon`; las columnas derivadas de `animals` NO son
--         escribibles; el historial de movimientos y el sanitario no conceden
--         UPDATE ni DELETE.
--     1. Generacion automatica de `animals.animal_code` (PIG-000001) y su
--        inmutabilidad (migracion 008).
--     2. Derivacion de `animals.current_pen_id` por el trigger del movimiento
--        y rechazo de movimientos invalidos (migracion 005).
--     3. Inmutabilidad del historial de `animal_movements` (005).
--     4. Coherencia de cantidades de `litters` (001) y registro de una camada.
--     5. Derivacion de `animals.status = 'dead'`, `exit_date` y
--        `current_pen_id = NULL` por el trigger de mortalidad (005), con la
--        fecha de salida tomada del propio evento.
--     6. Compatibilidad 005 <-> 008: el UPDATE derivado de un movimiento
--        dispara el trigger de 008 y NO regenera un `animal_code` existente.
--     7. Integridad final: las operaciones rechazadas no dejan filas; solo
--        persisten las validas y el animal queda en el estado esperado.
--
-- COMO SE EJECUTA (manual, por el responsable)
--   SQL Editor de Supabase -> pegar TODO el script -> Run como propietario
--   (postgres). El guion se ejecuta entre BEGIN y ROLLBACK: NUNCA confirma la
--   transaccion. Al terminar veras en los mensajes ("Notices") una lista
--   `OK n: ...`. Si algo falla, aparece `FALLO n: ...` y se revierte TODO.
--
-- COMO SE EVITAN LOS FALSOS POSITIVOS
--   - Cada operacion que DEBE ser rechazada se ejecuta dentro de un bloque
--     `BEGIN ... EXCEPTION WHEN check_violation`. Si PostgreSQL no la rechaza,
--     el guion lanza `RAISE EXCEPTION 'FALLO n'` (SQLSTATE P0001, que NO es
--     `check_violation`): el manejador no lo captura y la prueba falla de forma
--     visible.
--   - En NINGUN bloque se captura `WHEN OTHERS`: un error inesperado (NOT NULL,
--     clave foranea, privilegios, etc.) aborta el guion en lugar de contarse
--     como exito.
--   - Cada caso invalido aisla la regla que debe rechazarlo (p. ej. el origen
--     incoherente usa un destino ACTIVO distinto del origen y del corral
--     actual), de modo que el rechazo no venga de otra restriccion.
--   - El paso 8.b y el paso 15 cuentan las filas persistidas: una operacion
--     invalida que hubiera "pasado" no podria ademas haber dejado rastro.
--
-- SEGURIDAD Y DATOS
--   - Los datos creados son SINTETICOS y estan marcados con '[PRUEBA E2E SQL]'.
--   - Solo se insertan filas NUEVAS y solo se modifican las filas creadas por
--     este guion (filtradas por el UUID que devuelve cada INSERT). Ningun dato
--     preexistente se lee, se modifica ni se borra.
--   - Nada queda en la base: la transaccion se revierte al final.
--   - No se toca ningun dato existente, ni cuentas, ni .env, ni migraciones.
--   - Los eventos de RLS/RBAC por HTTP se comprueban aparte con
--     `npm run test:integration` (modo solo lectura primero).
--
-- LIMITE CONOCIDO 1: LAS SECUENCIAS NO SE REVIERTEN CON ROLLBACK
--   `ROLLBACK` deshace las FILAS, pero NO devuelve los valores ya consumidos de
--   una secuencia: `nextval()` es no transaccional (asi lo exige PostgreSQL
--   para garantizar unicidad y permitir concurrencia). Este guion da de alta DOS
--   animales, por lo que consume DOS valores de
--   `public.animals_animal_code_seq` que NO vuelven aunque la transaccion se
--   revierta al final. Consecuencia: pueden quedar SALTOS en la numeracion de
--   `animal_code` (p. ej. PIG-000002 y PIG-000003 "desaparecidos" antes de un
--   PIG-000004). Es un comportamiento ESPERADO y admitido por la especificacion
--   maestra 4.1 (nunca se usa MAX()+1 precisamente por esto); no es un fallo de
--   la migracion 008 ni del guion. NO se "corrige" con `setval`: retroceder la
--   secuencia a mano podria reemitir codigos ya usados y provocar colisiones.
--
-- LIMITE CONOCIDO 2: RUTAS QUE ESTE GUION NO EJERCE
--   Como propietario (postgres), el guion OMITE RLS y la guardia
--   `trg_animals_derived_guard` (el propietario es la via privilegiada). Esos
--   caminos solo se ejercen por PostgREST con un JWT real. El paso 0.a si
--   comprueba que la guardia y los triggers EXISTEN (no puede ejercerlos).
-- ============================================================================

BEGIN;

DO $sprint4_check$
DECLARE
    v_area        uuid;
    v_pen_a       uuid;
    v_pen_b       uuid;
    v_pen_c       uuid;
    v_pen_off     uuid;
    v_animal      uuid;
    v_code        text;
    v_code2       text;
    v_code_after  text;
    v_pen         uuid;
    v_status      public.animal_status;
    v_exit        date;
    v_exit_event  date;
    v_litter      uuid;
    v_event       uuid;
    v_count       integer;
BEGIN
    -- ------------------------------------------------------------------
    -- 0.a Precondiciones: objetos de 001/005/008 que la prueba ejercita.
    --     Si falta alguno, las comprobaciones posteriores darian un
    --     resultado enganoso (o fallarian mas adelante sin explicar por que).
    -- ------------------------------------------------------------------
    IF to_regclass('public.animals_animal_code_seq') IS NULL THEN
        RAISE EXCEPTION
            'FALLO 0.a: falta la secuencia public.animals_animal_code_seq (migracion 008 no aplicada?)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'assign_animal_code'
           AND p.prosecdef
    ) THEN
        RAISE EXCEPTION
            'FALLO 0.a: falta public.assign_animal_code() SECURITY DEFINER (migracion 008 no aplicada?)';
    END IF;

    IF (
        SELECT count(*)
          FROM pg_catalog.pg_trigger t
          JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND NOT t.tgisinternal
           AND t.tgname IN (
               'trg_animals_assign_code',
               'trg_animals_derived_guard',
               'trg_apply_animal_movement',
               'trg_apply_mortality_event',
               'trg_animal_movements_immutable'
           )
    ) <> 5 THEN
        RAISE EXCEPTION
            'FALLO 0.a: faltan triggers de 001/005/008 (assign_code, derived_guard, apply_animal_movement, apply_mortality_event, animal_movements_immutable)';
    END IF;

    RAISE NOTICE 'OK 0.a: objetos requeridos de 001/005/008 presentes';

    -- ------------------------------------------------------------------
    -- 0.b Privilegios (solo lectura de catalogo)
    -- ------------------------------------------------------------------
    IF has_sequence_privilege('authenticated',
                              'public.animals_animal_code_seq', 'USAGE')
       OR has_sequence_privilege('anon',
                                 'public.animals_animal_code_seq', 'USAGE')
    THEN
        RAISE EXCEPTION
            'FALLO 0.b: la secuencia animals_animal_code_seq no debe ser usable por authenticated/anon';
    END IF;

    IF has_function_privilege('authenticated',
                              'public.assign_animal_code()', 'EXECUTE')
       OR has_function_privilege('anon',
                                 'public.assign_animal_code()', 'EXECUTE')
    THEN
        RAISE EXCEPTION
            'FALLO 0.b: la generacion de codigos no debe ser invocable por authenticated/anon';
    END IF;

    IF has_column_privilege('authenticated', 'public.animals', 'current_pen_id', 'UPDATE')
       OR has_column_privilege('authenticated', 'public.animals', 'exit_date', 'UPDATE')
       OR has_column_privilege('authenticated', 'public.animals', 'animal_code', 'UPDATE')
    THEN
        RAISE EXCEPTION
            'FALLO 0.b: authenticated no debe tener UPDATE sobre columnas derivadas de animals';
    END IF;

    IF has_table_privilege('authenticated', 'public.animal_movements', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.animal_movements', 'DELETE')
       OR has_table_privilege('authenticated', 'public.health_events', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.health_events', 'DELETE')
    THEN
        RAISE EXCEPTION
            'FALLO 0.b: el historial (movimientos/sanidad) no debe conceder UPDATE ni DELETE a authenticated';
    END IF;

    RAISE NOTICE 'OK 0.b: privilegios restrictivos correctos (secuencia, generacion, columnas derivadas, historial)';

    -- ------------------------------------------------------------------
    -- 1. Catalogo sintetico (area + 3 corrales activos + 1 inactivo)
    --    `areas.name` es UNIQUE: se anade la marca de tiempo para que una
    --    ejecucion nueva no choque con un resto sintetico de otra corrida
    --    (el resto no deberia existir: el guion siempre revierte).
    --    El tercer corral activo (C) permite aislar la coherencia de ORIGEN
    --    (paso 8) sin que otra restriccion la enmascare.
    -- ------------------------------------------------------------------
    INSERT INTO public.areas (name, description)
    VALUES ('[PRUEBA E2E SQL] Area ' || to_char(now(), 'YYYYMMDDHH24MISS'),
            'Dato SINTETICO; la transaccion se revierte al final.')
    RETURNING id INTO v_area;

    INSERT INTO public.pens (area_id, code, name)
    VALUES (v_area, 'E2E-SQL-A', '[PRUEBA E2E SQL] Corral A')
    RETURNING id INTO v_pen_a;

    INSERT INTO public.pens (area_id, code, name)
    VALUES (v_area, 'E2E-SQL-B', '[PRUEBA E2E SQL] Corral B')
    RETURNING id INTO v_pen_b;

    INSERT INTO public.pens (area_id, code, name)
    VALUES (v_area, 'E2E-SQL-C', '[PRUEBA E2E SQL] Corral C')
    RETURNING id INTO v_pen_c;

    INSERT INTO public.pens (area_id, code, name, status)
    VALUES (v_area, 'E2E-SQL-OFF', '[PRUEBA E2E SQL] Corral inactivo', 'inactive')
    RETURNING id INTO v_pen_off;

    RAISE NOTICE 'Preparado: area=% corrales A=%, B=%, C=%, off=%',
        v_area, v_pen_a, v_pen_b, v_pen_c, v_pen_off;

    -- ------------------------------------------------------------------
    -- 2. Alta sin animal_code -> generacion automatica PIG-XXXXXX
    --    (migracion 008). OJO: el alta consume un valor de la secuencia y ese
    --    valor no se recupera con ROLLBACK (ver cabecera, limite conocido 1).
    -- ------------------------------------------------------------------
    INSERT INTO public.animals (sex, origin, entry_date, current_pen_id, notes)
    VALUES ('female', 'born_on_farm', CURRENT_DATE, v_pen_a, '[PRUEBA E2E SQL] Hembra')
    RETURNING id, animal_code INTO v_animal, v_code;

    IF v_code IS NULL OR v_code !~ '^PIG-[0-9]{6}$' THEN
        RAISE EXCEPTION 'FALLO 2: animal_code inesperado (%)', v_code;
    END IF;

    RAISE NOTICE 'OK 2: animal_code generado = %', v_code;

    -- ------------------------------------------------------------------
    -- 3. Segunda alta: el codigo es unico/distinto (secuencia, sin colisiones)
    -- ------------------------------------------------------------------
    INSERT INTO public.animals (sex, notes)
    VALUES ('male', '[PRUEBA E2E SQL] Macho')
    RETURNING animal_code INTO v_code2;

    IF v_code2 IS NULL OR v_code2 = v_code THEN
        RAISE EXCEPTION 'FALLO 3: animal_code repetido o nulo (%)', v_code2;
    END IF;

    RAISE NOTICE 'OK 3: segundo animal_code = % (distinto)', v_code2;

    -- ------------------------------------------------------------------
    -- 4. Movimiento interno valido -> el trigger deriva current_pen_id
    --    Ademas: el UPDATE derivado de `animals` dispara el trigger de 008
    --    (`trg_animals_assign_code` es BEFORE INSERT OR UPDATE) y este NO debe
    --    regenerar ni alterar un `animal_code` existente (compatibilidad 005/008).
    -- ------------------------------------------------------------------
    INSERT INTO public.animal_movements (animal_id, from_pen_id, to_pen_id, reason, notes)
    VALUES (v_animal, v_pen_a, v_pen_b, 'management', '[PRUEBA E2E SQL]');

    SELECT current_pen_id, animal_code
      INTO v_pen, v_code_after
      FROM public.animals WHERE id = v_animal;

    IF v_pen IS DISTINCT FROM v_pen_b THEN
        RAISE EXCEPTION 'FALLO 4: el trigger no derivo current_pen_id (valor %)', v_pen;
    END IF;

    IF v_code_after IS DISTINCT FROM v_code THEN
        RAISE EXCEPTION
            'FALLO 4: el movimiento altero animal_code (% -> %)',
            v_code, v_code_after;
    END IF;

    RAISE NOTICE 'OK 4: movimiento management derivo current_pen_id y conservo animal_code (%)', v_code_after;

    -- ------------------------------------------------------------------
    -- 5. Movimiento al mismo corral -> rechazado
    --    Lo rechaza el CHECK de 001 (`from_pen_id IS DISTINCT FROM to_pen_id`);
    --    el trigger de 005 reafirma la misma regla.
    -- ------------------------------------------------------------------
    BEGIN
        INSERT INTO public.animal_movements (animal_id, from_pen_id, to_pen_id, reason)
        VALUES (v_animal, v_pen_b, v_pen_b, 'management');
        RAISE EXCEPTION 'FALLO 5: se admitio un movimiento al mismo corral';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK 5: movimiento al mismo corral rechazado';
    END;

    -- ------------------------------------------------------------------
    -- 6. Movimiento interno sin destino -> rechazado por el CHECK de 001
    --    (`to_pen_id IS NOT NULL OR reason IN ('sale','transfer','other')`).
    -- ------------------------------------------------------------------
    BEGIN
        INSERT INTO public.animal_movements (animal_id, from_pen_id, to_pen_id, reason)
        VALUES (v_animal, v_pen_b, NULL, 'management');
        RAISE EXCEPTION 'FALLO 6: se admitio un movimiento interno sin destino';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK 6: movimiento interno sin destino rechazado (CHECK de 001)';
    END;

    -- ------------------------------------------------------------------
    -- 6.b Movimiento sin destino con motivo 'other' -> rechazado por la regla
    --     MAS ESTRICTA del trigger de 005 (el CHECK de 001 lo admite, asi que
    --     este es el unico caso que aisla la regla del trigger).
    -- ------------------------------------------------------------------
    BEGIN
        INSERT INTO public.animal_movements (animal_id, from_pen_id, to_pen_id, reason)
        VALUES (v_animal, v_pen_b, NULL, 'other');
        RAISE EXCEPTION
            'FALLO 6.b: se admitio un movimiento sin destino con motivo other';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK 6.b: movimiento sin destino rechazado por el trigger de 005';
    END;

    -- ------------------------------------------------------------------
    -- 7. Destino inactivo -> rechazado por el trigger de 005 (destino
    --    operativo). Los CHECK de 001 pasan: origen <> destino y destino no nulo.
    -- ------------------------------------------------------------------
    BEGIN
        INSERT INTO public.animal_movements (animal_id, from_pen_id, to_pen_id, reason)
        VALUES (v_animal, v_pen_b, v_pen_off, 'management');
        RAISE EXCEPTION 'FALLO 7: se admitio un corral destino inactivo';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK 7: movimiento a corral inactivo rechazado';
    END;

    -- ------------------------------------------------------------------
    -- 8. Origen incoherente con la ubicacion actual -> rechazado por el
    --    trigger de 005 (coherencia de origen).
    --    El animal esta en el corral B. Se informa origen A (INCORRECTO) y
    --    destino C (corral ACTIVO, distinto del origen y del corral actual):
    --    asi el unico rechazo posible es la coherencia de origen. Si en su
    --    lugar se usara el mismo corral como origen y destino, el caso quedaria
    --    enmascarado por el CHECK de 001 y NO probaria nada nuevo.
    -- ------------------------------------------------------------------
    BEGIN
        INSERT INTO public.animal_movements (animal_id, from_pen_id, to_pen_id, reason)
        VALUES (v_animal, v_pen_a, v_pen_c, 'management');
        RAISE EXCEPTION 'FALLO 8: se admitio un origen incoherente';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK 8: origen incoherente rechazado';
    END;

    -- ------------------------------------------------------------------
    -- 8.b Ninguna operacion rechazada dejo rastro: solo el movimiento valido
    --     del paso 4 (un rechazo que no revierte el INSERT seria un falso OK).
    -- ------------------------------------------------------------------
    SELECT count(*) INTO v_count
      FROM public.animal_movements WHERE animal_id = v_animal;

    IF v_count <> 1 THEN
        RAISE EXCEPTION
            'FALLO 8.b: se esperaba 1 movimiento persistido y hay %', v_count;
    END IF;

    SELECT current_pen_id INTO v_pen FROM public.animals WHERE id = v_animal;

    IF v_pen IS DISTINCT FROM v_pen_b THEN
        RAISE EXCEPTION
            'FALLO 8.b: un movimiento rechazado altero la ubicacion del animal (%)', v_pen;
    END IF;

    RAISE NOTICE 'OK 8.b: las inserciones rechazadas no dejaron filas ni movieron al animal';

    -- ------------------------------------------------------------------
    -- 9. Inmutabilidad del historial de movimientos (UPDATE y DELETE).
    --    El trigger de 005 (`forbid_animal_movement_change`) lanza SQLSTATE
    --    23514 en ambos casos.
    -- ------------------------------------------------------------------
    BEGIN
        UPDATE public.animal_movements SET notes = 'alterado' WHERE animal_id = v_animal;
        RAISE EXCEPTION 'FALLO 9a: se pudo actualizar un movimiento';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK 9a: UPDATE de movimiento rechazado';
    END;

    BEGIN
        DELETE FROM public.animal_movements WHERE animal_id = v_animal;
        RAISE EXCEPTION 'FALLO 9b: se pudo borrar un movimiento';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK 9b: DELETE de movimiento rechazado';
    END;

    -- ------------------------------------------------------------------
    -- 10. Inmutabilidad de animal_code (UPDATE rechazado por 008).
    --     Defensa en profundidad: 005 ya revoca el privilegio de columna.
    -- ------------------------------------------------------------------
    BEGIN
        UPDATE public.animals SET animal_code = 'PIG-999999' WHERE id = v_animal;
        RAISE EXCEPTION 'FALLO 10: se pudo cambiar animal_code';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK 10: animal_code inmutable';
    END;

    -- ------------------------------------------------------------------
    -- 11. Camada incoherente (born_alive > total_born) -> rechazada por el
    --     CHECK de coherencia de cantidades de 001.
    -- ------------------------------------------------------------------
    BEGIN
        INSERT INTO public.litters (mother_id, total_born, born_alive)
        VALUES (v_animal, 10, 11);
        RAISE EXCEPTION 'FALLO 11: se admitio born_alive > total_born';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK 11: coherencia de cantidades de camada';
    END;

    -- ------------------------------------------------------------------
    -- 12. Camada valida
    -- ------------------------------------------------------------------
    INSERT INTO public.litters (mother_id, total_born, born_alive, stillborn, notes)
    VALUES (v_animal, 10, 8, 2, '[PRUEBA E2E SQL]')
    RETURNING id INTO v_litter;

    RAISE NOTICE 'OK 12: camada registrada = %', v_litter;

    -- ------------------------------------------------------------------
    -- 13. Mortalidad -> deriva status='dead', exit_date y corral nulo.
    --     Se comprueba ademas que `exit_date` proviene del propio evento
    --     (`occurred_at::date`) y no de un valor previo: la comparacion usa
    --     `IS DISTINCT FROM` para no aceptar un NULL por accidente.
    -- ------------------------------------------------------------------
    INSERT INTO public.health_events (animal_id, event_type, title)
    VALUES (v_animal, 'mortality', '[PRUEBA E2E SQL] Mortalidad')
    RETURNING id INTO v_event;

    SELECT status, exit_date, current_pen_id
      INTO v_status, v_exit, v_pen
      FROM public.animals
     WHERE id = v_animal;

    SELECT occurred_at::date INTO v_exit_event
      FROM public.health_events
     WHERE id = v_event;

    IF v_status IS DISTINCT FROM 'dead'::public.animal_status
       OR v_exit IS NULL
       OR v_exit IS DISTINCT FROM v_exit_event
       OR v_pen IS NOT NULL
    THEN
        RAISE EXCEPTION
            'FALLO 13: la mortalidad no derivo el estado (status=%, exit=%, exit_evento=%, pen=%)',
            v_status, v_exit, v_exit_event, v_pen;
    END IF;

    RAISE NOTICE 'OK 13: mortalidad derivo status=dead, exit_date=%, current_pen_id=NULL', v_exit;

    -- ------------------------------------------------------------------
    -- 14. Un animal muerto no admite movimientos -> rechazado por el trigger
    --     de 005 (estados incompatibles). El animal esta sin corral, asi que
    --     el origen (NULL) es coherente y el unico motivo de rechazo es el
    --     estado 'dead'.
    -- ------------------------------------------------------------------
    BEGIN
        INSERT INTO public.animal_movements (animal_id, from_pen_id, to_pen_id, reason)
        VALUES (v_animal, NULL, v_pen_a, 'management');
        RAISE EXCEPTION 'FALLO 14: se admitio un movimiento de un animal muerto';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK 14: movimiento de un animal muerto rechazado';
    END;

    -- ------------------------------------------------------------------
    -- 15. Integridad final: solo existen las filas VALIDAS del guion y el
    --     animal quedo en el estado esperado. Un fallo de rollback interno,
    --     una fila de mas o un estado alterado se detectan aqui.
    -- ------------------------------------------------------------------
    SELECT count(*) INTO v_count
      FROM public.animal_movements WHERE animal_id = v_animal;

    IF v_count <> 1 THEN
        RAISE EXCEPTION
            'FALLO 15: movimientos persistidos del animal = % (esperado 1)', v_count;
    END IF;

    SELECT count(*) INTO v_count
      FROM public.litters WHERE mother_id = v_animal;

    IF v_count <> 1 THEN
        RAISE EXCEPTION
            'FALLO 15: camadas persistidas del animal = % (esperado 1)', v_count;
    END IF;

    SELECT count(*) INTO v_count
      FROM public.health_events WHERE animal_id = v_animal;

    IF v_count <> 1 THEN
        RAISE EXCEPTION
            'FALLO 15: eventos sanitarios persistidos del animal = % (esperado 1)', v_count;
    END IF;

    SELECT count(*) INTO v_count
      FROM public.animals
     WHERE id = v_animal
       AND status = 'dead'::public.animal_status
       AND exit_date IS NOT NULL
       AND current_pen_id IS NULL;

    IF v_count <> 1 THEN
        RAISE EXCEPTION
            'FALLO 15: el animal no quedo en estado dead / exit_date / current_pen_id NULL';
    END IF;

    RAISE NOTICE 'OK 15: integridad final (1 movimiento, 1 camada, 1 evento; animal dead sin corral)';

    RAISE NOTICE '============================================================';
    RAISE NOTICE 'Sprint 4 SQL: TODAS las comprobaciones OK (nada se confirma)';
    RAISE NOTICE '============================================================';
    RAISE NOTICE
        'AVISO (no es un fallo): ROLLBACK NO revierte la secuencia animals_animal_code_seq; esta corrida consumio 2 valores y los proximos animal_code pueden saltar (permitido por la especificacion 4.1).';
END;
$sprint4_check$;

ROLLBACK;

-- ============================================================================
-- VERIFICACION DE SOLO LECTURA (opcional, SIN transaccion; ejecutar aparte)
-- ----------------------------------------------------------------------------
--   -- Politicas RLS esperadas (003/004/005/006/007)
--   SELECT tablename, policyname, cmd, roles FROM pg_policies
--    WHERE schemaname = 'public' ORDER BY tablename, policyname;
--
--   -- Triggers de animals/animal_movements/health_events
--   SELECT c.relname AS tabla, t.tgname AS trigger
--     FROM pg_trigger t
--     JOIN pg_class c ON c.oid = t.tgrelid
--     JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public' AND NOT t.tgisinternal
--    ORDER BY 1, 2;
--
--   -- Secuencia de animal_code y su valor actual. Tras ejecutar el guion (que
--   -- termina en ROLLBACK) este valor NO habra vuelto atras: la secuencia no es
--   -- transaccional y los valores consumidos se pierden (saltos en animal_code).
--   SELECT last_value, is_called FROM public.animals_animal_code_seq;
--
--   -- Columnas de animals con UPDATE para authenticated (SIN current_pen_id,
--   -- exit_date, animal_code ni entry_date)
--   SELECT column_name FROM information_schema.column_privileges
--    WHERE table_schema = 'public' AND table_name = 'animals'
--      AND grantee = 'authenticated' AND privilege_type = 'UPDATE'
--    ORDER BY column_name;
--
-- ============================================================================
-- LECTURA OBLIGATORIA SOBRE RLS/RBAC POR HTTP
-- ----------------------------------------------------------------------------
--   Este guion (como propietario) NO ejerce RLS ni la guardia
--   `trg_animals_derived_guard`. Esos caminos se verifican por PostgREST con la
--   identidad real del JWT mediante `npm run test:integration`:
--     1. Primero el modo SOLO LECTURA (sin PIGTEC_E2E_WRITE).
--     2. Solo tras autorizacion explicita, el modo ESCRITURA (PIGTEC_E2E_WRITE=1).
-- ============================================================================
