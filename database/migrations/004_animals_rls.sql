-- ============================================================================
-- PigTec - Migracion 004: politicas RLS para public.animals
-- ----------------------------------------------------------------------------
-- Archivo:    database/migrations/004_animals_rls.sql
-- Motor:      PostgreSQL 17.x en Supabase (proyecto de DESARROLLO: PigTecBD)
-- Depende de: 001_initial_schema.sql (animals con RLS habilitado y sin
--             politicas) y 002_profile_provisioning.sql (perfiles con rol/estado
--             y lectura propia via profile_select_own).
-- Estado:     PROPUESTA. NO ejecutada. Requiere revision y aprobacion.
-- ----------------------------------------------------------------------------
-- OBJETIVO
--   Habilitar el acceso de la API a public.animals mediante RLS:
--     - SELECT (lectura) para usuarios ACTIVOS con rol admin, manager, operator
--       o veterinarian (matriz 5.1: todos consultan el inventario).
--     - INSERT (alta oficial directa) SOLO para admin y manager ACTIVOS.
--     - UPDATE (edicion de datos y estado administrativo) SOLO para admin y
--       manager ACTIVOS.
--     - Sin DELETE: los animales no se borran (se conserva el historial).
--     - Sin acceso para viewer, usuarios inactivos ni anonimo.
--
-- MODELO DE ACCESO
--   El backend usa SIEMPRE el JWT real del usuario (nunca service_role). El rol
--   y el estado NO se leen del JWT: se comprueban contra public.profiles con
--   auth.uid() (igual que 003 para areas/pens).
--
-- NO HACE (a proposito)
--   - NO crea ni modifica tablas, funciones ni triggers.
--   - NO crea ni modifica animal_movements ni health_events (otras etapas).
--   - NO toca la vista public.v_animals_current ni sus privilegios.
--   - NO genera animal_code (queda para una migracion posterior 006).
--   - NO concede acceso a anon ni a PUBLIC.
--   - NO usa service_role.
--
-- NOTA SOBRE PROTECCION DE COLUMNAS
--   Se conceden privilegios a NIVEL DE TABLA (como en 003) para no romper los
--   triggers SECURITY INVOKER del esquema (`apply_animal_movement` /
--   `apply_mortality_event` actualizan current_pen_id/status/exit_date con la
--   identidad del llamante). La proteccion de campos derivados
--   (animal_code, current_pen_id, exit_date, created_by) se hace hoy en el
--   backend; el endurecimiento por columna se revisara junto con el
--   endurecimiento de esos triggers (migracion 005 propuesta).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. Comprobaciones previas
--    a) 001/002 aplicadas (animals y profiles existen).
--    b) 004 no aplicada aun (ninguna politica propia creada).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    ya_existe text[];
BEGIN
    IF to_regclass('public.animals') IS NULL
       OR to_regclass('public.profiles') IS NULL THEN
        RAISE EXCEPTION
            'Migracion 004 abortada: faltan public.animals o public.profiles. Aplique primero 001 y 002.';
    END IF;

    SELECT array_agg(p.policyname ORDER BY p.policyname) INTO ya_existe
      FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.tablename = 'animals'
       AND p.policyname IN (
           'animals_select_operational',
           'animals_insert_admin_manager',
           'animals_update_admin_manager'
       );

    IF ya_existe IS NOT NULL THEN
        RAISE EXCEPTION
            'Migracion 004 abortada: ya existen politicas de esta migracion (%). Revise el estado antes de continuar.',
            array_to_string(ya_existe, ', ');
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 1. Privilegios de tabla (necesarios para PostgREST)
--    - anon y PUBLIC: sin acceso alguno.
--    - authenticated: SOLO SELECT, INSERT y UPDATE (RLS restringe las filas).
--      NO se concede DELETE: los animales no se borran (baja logica por estado).
-- ----------------------------------------------------------------------------
REVOKE ALL ON public.animals FROM PUBLIC;
REVOKE ALL ON public.animals FROM anon;
REVOKE ALL ON public.animals FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.animals TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Politicas RLS
--    El predicado lee la fila PROPIA del llamante en public.profiles
--    (auth.uid()); no hay recursion porque profiles no consulta animals y
--    profile_select_own le permite leer su propia fila. Todos los comandos se
--    restringen al rol authenticated (los inactivos y viewer fallan el EXISTS).
--
--    Compatibilidad con supabase-js:
--      - .insert(...).select()   -> INSERT ... RETURNING: exige INSERT (WITH
--        CHECK) y que la politica SELECT deje ver la fila devuelta.
--      - .update(...).eq(...).select() -> UPDATE ... RETURNING: exige UPDATE
--        (USING + WITH CHECK) y la politica SELECT para la fila devuelta.
-- ----------------------------------------------------------------------------

CREATE POLICY animals_select_operational ON public.animals
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

CREATE POLICY animals_insert_admin_manager ON public.animals
FOR INSERT TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1
          FROM public.profiles p
         WHERE p.id = auth.uid()
           AND p.is_active
           AND p.role IN (
               'admin'::public.user_role,
               'manager'::public.user_role
           )
    )
);

CREATE POLICY animals_update_admin_manager ON public.animals
FOR UPDATE TO authenticated
USING (
    EXISTS (
        SELECT 1
          FROM public.profiles p
         WHERE p.id = auth.uid()
           AND p.is_active
           AND p.role IN (
               'admin'::public.user_role,
               'manager'::public.user_role
           )
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
          FROM public.profiles p
         WHERE p.id = auth.uid()
           AND p.is_active
           AND p.role IN (
               'admin'::public.user_role,
               'manager'::public.user_role
           )
    )
);

COMMIT;
-- FIN DE LA MIGRACION 004

-- ============================================================================
-- APLICAR (breve)
--   1) Confirmar en el Dashboard de Supabase que el proyecto es PigTecBD.
--   2) SQL Editor -> pegar TODO este script.
--   3) Run. Esperado: "Success. No rows returned".
--   4) Si PostgREST sirve resultados cacheados: NOTIFY pgrst, 'reload schema';
--
-- VERIFICACION (solo lectura) - ejecutar despues de aplicar
--   SELECT schemaname, tablename, policyname, cmd, roles
--     FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'animals'
--    ORDER BY policyname;               -- esperado: 3 filas
--
--   SELECT table_name, grantee, privilege_type
--     FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND table_name = 'animals'
--    ORDER BY grantee, privilege_type;
--     -- esperado: solo authenticated con SELECT/INSERT/UPDATE; sin anon.
--
--   SELECT relname, relrowsecurity
--     FROM pg_class
--    WHERE oid = 'public.animals'::regclass;   -- esperado: relrowsecurity = true
-- ============================================================================
