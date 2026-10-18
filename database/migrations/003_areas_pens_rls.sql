-- ============================================================================
-- PigTec - Migracion 003: politicas RLS para public.areas y public.pens
-- ----------------------------------------------------------------------------
-- Archivo:    database/migrations/003_areas_pens_rls.sql
-- Motor:      PostgreSQL 17.x en Supabase (proyecto de DESARROLLO: PigTecBD)
-- Depende de: 001_initial_schema.sql (areas/pens con RLS habilitado y sin
--             politicas) y 002_profile_provisioning.sql (perfiles con rol/estado
--             y escrituras directas revocadas a authenticated).
-- Estado:     PROPUESTA. NO ejecutada. Requiere revision y aprobacion.
-- ----------------------------------------------------------------------------
-- OBJETIVO
--   Habilitar el acceso de la API a areas y corrales mediante RLS:
--     - SELECT (lectura) para usuarios ACTIVOS con rol admin, manager, operator
--       o veterinarian.
--     - INSERT y UPDATE (incluida la baja logica: status='inactive') SOLO para
--       admin y manager ACTIVOS.
--     - Sin acceso para viewer, usuarios inactivos y anonimo.
--
-- MODELO DE ACCESO
--   El backend usa SIEMPRE el JWT real del usuario (nunca service_role). El rol
--   y el estado NO se leen del JWT: se comprueban contra public.profiles con
--   auth.uid(). La unica via de escritura de perfiles es la RPC de 002, por lo
--   que el rol no es manipulable por el cliente (sin escalamiento).
--
-- NO HACE (a proposito)
--   - NO crea ni modifica tablas, funciones ni triggers.
--   - NO habilita DELETE: el backend realiza baja logica por UPDATE; ademas
--     areas/pens estan referenciadas con ON DELETE RESTRICT (historico).
--   - NO concede acceso a anon ni a PUBLIC.
--   - NO usa service_role.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. Comprobaciones previas
--    a) 001 aplicada (areas/pens existen) y perfiles disponibles.
--    b) 003 no aplicada aun (ninguna politica propia creada).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    ya_existe text[];
BEGIN
    IF to_regclass('public.areas') IS NULL
       OR to_regclass('public.pens') IS NULL
       OR to_regclass('public.profiles') IS NULL THEN
        RAISE EXCEPTION
            'Migracion 003 abortada: faltan public.areas, public.pens o public.profiles. Aplique primero 001 y 002.';
    END IF;

    SELECT array_agg(p.policyname ORDER BY p.policyname) INTO ya_existe
      FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.tablename IN ('areas', 'pens')
       AND p.policyname IN (
           'areas_select_operational',
           'areas_insert_admin_manager',
           'areas_update_admin_manager',
           'pens_select_operational',
           'pens_insert_admin_manager',
           'pens_update_admin_manager'
       );

    IF ya_existe IS NOT NULL THEN
        RAISE EXCEPTION
            'Migracion 003 abortada: ya existen politicas de esta migracion (%). Revise el estado antes de continuar.',
            array_to_string(ya_existe, ', ');
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 1. Privilegios de tabla (necesarios para PostgREST)
--    - anon y PUBLIC: sin acceso alguno.
--    - authenticated: SOLO SELECT, INSERT y UPDATE (RLS restringe las filas).
--      NO se concede DELETE (la baja es logica, por UPDATE).
--    (areas/pens usan gen_random_uuid(): no hay secuencias que ajustar.)
-- ----------------------------------------------------------------------------
REVOKE ALL ON public.areas FROM PUBLIC;
REVOKE ALL ON public.areas FROM anon;
REVOKE ALL ON public.areas FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.areas TO authenticated;

REVOKE ALL ON public.pens FROM PUBLIC;
REVOKE ALL ON public.pens FROM anon;
REVOKE ALL ON public.pens FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.pens TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Politicas RLS
--    El predicado de autorizacion lee la fila PROPIA del llamante en
--    public.profiles (auth.uid()); no hay recursion porque profiles no consulta
--    areas ni pens, y profile_select_own le permite leer su propia fila.
--    Todos los comandos se restringen al rol authenticated (los inactivos y
--    viewer fallan el EXISTS).
--
--    Compatibilidad con supabase-js:
--      - .insert(...).select()  -> INSERT ... RETURNING: exige INSERT (WITH
--        CHECK) y que la politica SELECT deje ver la fila devuelta.
--      - .update(...).eq(...).select() -> UPDATE ... RETURNING: exige UPDATE
--        (USING + WITH CHECK) y la politica SELECT para la fila devuelta.
--    admin y manager activos cumplen ambas; el resto no.
-- ----------------------------------------------------------------------------

-- Areas --------------------------------------------------------------------
CREATE POLICY areas_select_operational ON public.areas
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

CREATE POLICY areas_insert_admin_manager ON public.areas
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

CREATE POLICY areas_update_admin_manager ON public.areas
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

-- Corrales ----------------------------------------------------------------
CREATE POLICY pens_select_operational ON public.pens
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

CREATE POLICY pens_insert_admin_manager ON public.pens
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

CREATE POLICY pens_update_admin_manager ON public.pens
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
-- FIN DE LA MIGRACION 003

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
--    WHERE schemaname = 'public' AND tablename IN ('areas','pens')
--    ORDER BY tablename, policyname;      -- esperado: 6 filas (3 por tabla)
--
--   SELECT table_name, grantee, privilege_type
--     FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND table_name IN ('areas','pens')
--    ORDER BY table_name, grantee, privilege_type;
--     -- esperado: solo authenticated con SELECT/INSERT/UPDATE; sin anon.
--
--   SELECT relname, relrowsecurity
--     FROM pg_class
--    WHERE oid IN ('public.areas'::regclass, 'public.pens'::regclass);
--     -- esperado: relrowsecurity = true
-- ============================================================================
