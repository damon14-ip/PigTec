-- ============================================================================
-- PigTec - Migracion 007: politicas RLS para public.health_events (sanidad)
-- ----------------------------------------------------------------------------
-- Archivo:    database/migrations/007_health_events_rls.sql
-- Motor:      PostgreSQL 17.x en Supabase (proyecto de DESARROLLO: PigTecBD)
-- Depende de: 001_initial_schema.sql (public.health_events con RLS habilitado y
--             sin politicas; trigger trg_health_events_updated_at; trigger
--             trg_apply_mortality_event -> apply_mortality_event()),
--             002_profile_provisioning.sql (perfiles con rol/estado),
--             003/004/005 (patron de politicas y endurecimiento de triggers),
--             006_litters_rls.sql (patron inmediato).
-- Estado:     PROPUESTA. NO ejecutada. Requiere revision y aprobacion.
-- ----------------------------------------------------------------------------
-- OBJETIVO
--   Habilitar el acceso de la API a public.health_events (modulo S4-C: sanidad
--   y eventos veterinarios) mediante RLS:
--     - SELECT (lectura) para usuarios ACTIVOS con rol admin, manager, operator
--       o veterinarian (todo rol operativo consulta el historial sanitario).
--     - INSERT (registro) SOLO para usuarios ACTIVOS, con una restriccion
--       adicional POR TIPO DE EVENTO (columna event_type), espejo de la matriz
--       de la especificacion maestra 5.1:
--         * observation, symptom_report, other  -> admin, manager, operator,
--           veterinarian (observaciones/sintomas: todos los rol operativos).
--         * documented_diagnosis, treatment, vaccination, deworming, recovery
--           -> SOLO veterinarian (facultad clinica; admin/manager quedan
--           pendientes de la "politica clinica" definida).
--         * mortality -> admin, manager, veterinarian ("con validacion").
--     - Sin UPDATE ni DELETE: el evento sanitario es HISTORIAL INMUTABLE
--       (especificacion 5.2 y decision D-09). La correccion auditable de un
--       evento queda como decision pendiente; no se concede privilegio ni
--       politica de UPDATE/DELETE.
--     - Sin acceso para viewer, usuarios inactivos ni anonimo.
--
-- MODELO DE ACCESO
--   El backend usa SIEMPRE el JWT real del usuario (nunca service_role). El rol
--   y el estado NO se leen del JWT: se comprueban contra public.profiles con
--   auth.uid() (igual que 003, 004, 005 y 006).
--
-- COMPATIBILIDAD CON LOS TRIGGERS EXISTENTES (verificado por 0.b)
--   - trg_health_events_updated_at (BEFORE UPDATE, set_updated_at): solo se
--     dispara en UPDATE. Como esta migracion NO concede UPDATE, no interviene.
--   - trg_apply_mortality_event / apply_mortality_event() (AFTER INSERT): la
--     migracion 005 lo dejo SECURITY DEFINER con search_path=''. Al insertar un
--     evento de mortalidad, el trigger ejecuta el UPDATE derivado de
--     public.animals con la identidad del PROPIETARIO (postgres), por lo que la
--     guardia `guard_animal_derived_change` (005, seccion 6.b) lo reconoce como
--     deriva legitima. La nueva RLS de health_events NO afecta a esa funcion:
--     el trigger escribe `animals`, no `health_events`.
--   - Esta migracion NO modifica ni recrea ningun trigger ni funcion.
--
-- DECISION PENDIENTE (documentada, no resuelta aqui)
--   - La especificacion 5.1 deja "segun politica clinica definida" la facultad
--     de admin/manager sobre diagnosticos/tratamientos/vacunas. Se adopta el
--     criterio mas restrictivo (solo veterinarian) y queda sujeto a confirmacion
--     del responsable.
--   - `health_events.documented_by` (hoy TEXT): revisar si debe ser FK a
--     profiles (ver README de migraciones). No se toca aqui.
--   - No existe aun un mecanismo de correccion auditable para el historial.
--
-- NO HACE (a proposito)
--   - NO crea ni modifica tablas, columnas, enums, indices, triggers ni
--     funciones.
--   - NO concede UPDATE ni DELETE (historial inmutable).
--   - NO concede acceso a anon/PUBLIC ni usa service_role.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. Comprobaciones previas
--    a) 001/002 aplicadas (health_events, animals y profiles existen).
--    b) Los triggers/funciones de deriva existen y son compatibles (mortalidad
--       SECURITY DEFINER de 005).
--    c) 007 no aplicada aun (ninguna politica propia creada).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    ya_existe text[];
BEGIN
    IF to_regclass('public.health_events') IS NULL
       OR to_regclass('public.animals') IS NULL
       OR to_regclass('public.profiles') IS NULL THEN
        RAISE EXCEPTION
            'Migracion 007 abortada: faltan public.health_events, public.animals o public.profiles. Aplique primero 001 y 002.';
    END IF;

    -- 0.b Compatibilidad con los triggers existentes.
    IF NOT EXISTS (
        SELECT 1
          FROM pg_trigger t
          JOIN pg_class c     ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = 'health_events'
           AND t.tgname = 'trg_apply_mortality_event'
           AND NOT t.tgisinternal
    ) THEN
        RAISE EXCEPTION
            'Migracion 007 abortada: falta el trigger trg_apply_mortality_event en public.health_events (aplique 001 y 005).';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'apply_mortality_event'
           AND p.prosecdef
    ) THEN
        RAISE EXCEPTION
            'Migracion 007 abortada: public.apply_mortality_event debe existir y ser SECURITY DEFINER (aplique 001 y 005).';
    END IF;

    SELECT array_agg(p.policyname ORDER BY p.policyname) INTO ya_existe
      FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.tablename = 'health_events'
       AND p.policyname IN (
           'health_events_select_operational',
           'health_events_insert_operational'
       );

    IF ya_existe IS NOT NULL THEN
        RAISE EXCEPTION
            'Migracion 007 abortada: ya existen politicas de esta migracion (%). Revise el estado antes de continuar.',
            array_to_string(ya_existe, ', ');
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 1. Privilegios de tabla (necesarios para PostgREST)
--    - anon y PUBLIC: sin acceso alguno.
--    - authenticated: SOLO SELECT e INSERT (RLS restringe las filas). NO se
--      concede UPDATE ni DELETE: el historial sanitario es inmutable.
-- ----------------------------------------------------------------------------
REVOKE ALL ON public.health_events FROM PUBLIC;
REVOKE ALL ON public.health_events FROM anon;
REVOKE ALL ON public.health_events FROM authenticated;
GRANT SELECT, INSERT ON public.health_events TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Politicas RLS
--    El predicado lee la fila PROPIA del llamante en public.profiles
--    (auth.uid()); no hay recursion porque profiles no consulta health_events y
--    profile_select_own permite leer la fila propia. Todos los comandos se
--    restringen al rol authenticated (inactivos y viewer fallan el EXISTS).
--
--    La politica de INSERT aplica, ademas, la matriz por TIPO de evento
--    (columna event_type del evento nuevo), reforzando en la base la misma
--    regla que valida el backend.
--
--    Compatibilidad con supabase-js:
--      - .insert(...).select() -> INSERT ... RETURNING: exige INSERT (WITH
--        CHECK) y que la politica SELECT deje ver la fila devuelta (la de
--        lectura es operativa para los cuatro roles).
-- ----------------------------------------------------------------------------

CREATE POLICY health_events_select_operational ON public.health_events
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1
          FROM public.profiles p
         WHERE p.id = auth.uid()
           AND p.is_active
           AND p.role IN (
               'admin'::public.user_role,
               'manager'::public.user_role,
               'operator'::public.user_role,
               'veterinarian'::public.user_role
           )
    )
);

CREATE POLICY health_events_insert_operational ON public.health_events
FOR INSERT TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1
          FROM public.profiles p
         WHERE p.id = auth.uid()
           AND p.is_active
           AND CASE
               -- Observaciones/sintomas: cualquier rol operativo.
               WHEN health_events.event_type IN (
                        'observation'::public.health_event_type,
                        'symptom_report'::public.health_event_type,
                        'other'::public.health_event_type
                    )
                   THEN p.role IN (
                        'admin'::public.user_role,
                        'manager'::public.user_role,
                        'operator'::public.user_role,
                        'veterinarian'::public.user_role
                   )
               -- Clinicos: solo veterinario (politica clinica pendiente).
               WHEN health_events.event_type IN (
                        'documented_diagnosis'::public.health_event_type,
                        'treatment'::public.health_event_type,
                        'vaccination'::public.health_event_type,
                        'deworming'::public.health_event_type,
                        'recovery'::public.health_event_type
                    )
                   THEN p.role = 'veterinarian'::public.user_role
               -- Mortalidad: admin, manager y veterinario.
               WHEN health_events.event_type =
                        'mortality'::public.health_event_type
                   THEN p.role IN (
                        'admin'::public.user_role,
                        'manager'::public.user_role,
                        'veterinarian'::public.user_role
                   )
               ELSE false
           END
    )
);

-- Sin politicas de UPDATE ni DELETE: denegacion por defecto (ademas no hay
-- privilegio de tabla para UPDATE/DELETE).

COMMIT;
-- FIN DE LA MIGRACION 007

-- ============================================================================
-- APLICAR (breve)
--   1) Confirmar en el Dashboard de Supabase que el proyecto es PigTecBD
--      (DESARROLLO). La identidad NO se puede comprobar de forma inequivoca con
--      SQL; verificar en el panel ANTES de ejecutar.
--   2) SQL Editor -> pegar TODO este script -> Run como propietario (postgres).
--      Esperado: "Success. No rows returned".
--   3) Si PostgREST sirve esquema cacheado: NOTIFY pgrst, 'reload schema';
--
-- VERIFICACION (solo lectura) - ejecutar despues de aplicar
--   -- 2 politicas esperadas en health_events (SELECT/INSERT; sin UPDATE/DELETE)
--   SELECT policyname, cmd, roles FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'health_events'
--    ORDER BY policyname;
--
--   -- Privilegios: authenticated solo SELECT/INSERT; sin anon ni DELETE/UPDATE
--   SELECT grantee, privilege_type
--     FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND table_name = 'health_events'
--    ORDER BY grantee, privilege_type;
--
--   -- RLS activado (relrowsecurity = true, ya desde 001)
--   SELECT relname, relrowsecurity FROM pg_class
--    WHERE oid = 'public.health_events'::regclass;
--
--   -- Triggers intactos
--   SELECT t.tgname FROM pg_trigger t
--     JOIN pg_class c ON c.oid = t.tgrelid
--    WHERE c.oid = 'public.health_events'::regclass AND NOT t.tgisinternal
--    ORDER BY 1;
--
-- PRUEBA FUNCIONAL SUGERIDA (solo PigTecBD, con datos SINTETICOS marcados,
-- requiere aprobacion aparte):
--   - operator registra una observacion/sintoma -> 201.
--   - operator intenta un diagnostico/tratamiento -> 403 (backend) y, por RLS,
--     denegado en la base.
--   - veterinarian registra tratamiento y vacunacion -> 201.
--   - manager/veterinarian registran mortalidad de un porcino activo -> 201 y el
--     trigger deja el porcino en `dead` con `exit_date` y `current_pen_id = NULL`.
--   - segunda mortalidad sobre el mismo porcino -> 400 (estado `dead`).
--   - viewer/inactivo consulta o registra -> 403; sin token -> 401.
--   - PATCH/PUT/DELETE /health-events/:id -> 404 (no existen las rutas; ademas
--     sin privilegio de UPDATE/DELETE en la base).
-- ============================================================================
