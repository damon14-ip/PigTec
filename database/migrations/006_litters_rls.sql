-- ============================================================================
-- PigTec - Migracion 006: politicas RLS para public.litters (camadas)
-- ----------------------------------------------------------------------------
-- Archivo:    database/migrations/006_litters_rls.sql
-- Motor:      PostgreSQL 17.x en Supabase (proyecto de DESARROLLO: PigTecBD)
-- Depende de: 001_initial_schema.sql (public.litters y public.animals con RLS
--             habilitado y sin politicas; trigger trg_litters_updated_at),
--             002_profile_provisioning.sql (perfiles con rol/estado),
--             003_areas_pens_rls.sql y 004_animals_rls.sql (patron de politicas).
-- Estado:     PROPUESTA. NO ejecutada. Requiere revision y aprobacion.
-- ----------------------------------------------------------------------------
-- OBJETIVO
--   Habilitar el acceso de la API a public.litters (modulo de reproduccion /
--   camadas) mediante RLS:
--     - SELECT (lectura) para usuarios ACTIVOS con rol admin, manager, operator
--       o veterinarian (todo rol operativo consulta camadas y sus crias).
--     - INSERT y UPDATE (registro y edicion de datos permitidos) SOLO para
--       admin, manager y operator ACTIVOS.
--     - Sin DELETE: las camadas no se eliminan fisicamente (decision D-09,
--       especificacion maestra 5.2). No se concede privilegio ni politica.
--     - Sin acceso para viewer, usuarios inactivos ni anonimo.
--
-- MODELO DE ACCESO
--   El backend usa SIEMPRE el JWT real del usuario (nunca service_role). El rol
--   y el estado NO se leen del JWT: se comprueban contra public.profiles con
--   auth.uid() (igual que 003, 004 y 005).
--
-- RELACIONES QUE ESTA MIGRACION NO TOCA
--   La tabla `animals` ya tiene sus politicas (004): la consulta de crias
--   (GET /litters/:id/offspring) filtra `animals.litter_id` con el rol del
--   usuario y queda cubierta por `animals_select_operational`. La validacion de
--   parentesco (madre hembra / padre macho) la realiza el BACKEND, no la base:
--   no se añaden triggers de negocio en esta migracion.
--
-- DECISION PENDIENTE (documentada, no resuelta aqui)
--   La especificacion maestra no fija la matriz de permisos para camadas. Se
--   adopta la del trabajo operativo interno (admin/manager/operator escriben;
--   el veterinario solo consulta). Queda sujeta a confirmacion del responsable.
--
-- NO HACE (a proposito)
--   - NO crea ni modifica tablas, columnas, enums ni indices.
--   - NO añade columnas de auditoria (`litters` no tiene `created_by`).
--   - NO crea triggers de negocio (sexo de la madre/padre): se validan en el
--     backend y se documentan como decision pendiente si se quiere reforzar en
--     la base.
--   - NO concede DELETE ni acceso a anon/PUBLIC.
--   - NO usa service_role.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. Comprobaciones previas
--    a) 001/002 aplicadas (litters, animals y profiles existen).
--    b) 006 no aplicada aun (ninguna politica propia creada).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    ya_existe text[];
BEGIN
    IF to_regclass('public.litters') IS NULL
       OR to_regclass('public.animals') IS NULL
       OR to_regclass('public.profiles') IS NULL THEN
        RAISE EXCEPTION
            'Migracion 006 abortada: faltan public.litters, public.animals o public.profiles. Aplique primero 001 y 002.';
    END IF;

    SELECT array_agg(p.policyname ORDER BY p.policyname) INTO ya_existe
      FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.tablename = 'litters'
       AND p.policyname IN (
           'litters_select_operational',
           'litters_insert_operational',
           'litters_update_operational'
       );

    IF ya_existe IS NOT NULL THEN
        RAISE EXCEPTION
            'Migracion 006 abortada: ya existen politicas de esta migracion (%). Revise el estado antes de continuar.',
            array_to_string(ya_existe, ', ');
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 1. Privilegios de tabla (necesarios para PostgREST)
--    - anon y PUBLIC: sin acceso alguno.
--    - authenticated: SOLO SELECT, INSERT y UPDATE (RLS restringe las filas).
--      NO se concede DELETE: la camada no se elimina (historial genealogico).
-- ----------------------------------------------------------------------------
REVOKE ALL ON public.litters FROM PUBLIC;
REVOKE ALL ON public.litters FROM anon;
REVOKE ALL ON public.litters FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.litters TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Politicas RLS
--    El predicado lee la fila PROPIA del llamante en public.profiles
--    (auth.uid()); no hay recursion porque profiles no consulta litters y
--    profile_select_own permite leer la fila propia. Todos los comandos se
--    restringen al rol authenticated (inactivos y viewer fallan el EXISTS).
--
--    Compatibilidad con supabase-js:
--      - .insert(...).select()   -> INSERT ... RETURNING: exige INSERT (WITH
--        CHECK) y que la politica SELECT deje ver la fila devuelta.
--      - .update(...).eq(...).select() -> UPDATE ... RETURNING: exige UPDATE
--        (USING + WITH CHECK) y la politica SELECT para la fila devuelta.
-- ----------------------------------------------------------------------------

CREATE POLICY litters_select_operational ON public.litters
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

CREATE POLICY litters_insert_operational ON public.litters
FOR INSERT TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1
          FROM public.profiles p
         WHERE p.id = auth.uid()
           AND p.is_active
           AND p.role IN (
               'admin'::public.user_role,
               'manager'::public.user_role,
               'operator'::public.user_role
           )
    )
);

CREATE POLICY litters_update_operational ON public.litters
FOR UPDATE TO authenticated
USING (
    EXISTS (
        SELECT 1
          FROM public.profiles p
         WHERE p.id = auth.uid()
           AND p.is_active
           AND p.role IN (
               'admin'::public.user_role,
               'manager'::public.user_role,
               'operator'::public.user_role
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
               'manager'::public.user_role,
               'operator'::public.user_role
           )
    )
);

-- Sin politicas de UPDATE adicionales ni DELETE: denegacion por defecto (ademas
-- no hay privilegio de tabla para DELETE).

COMMIT;
-- FIN DE LA MIGRACION 006

-- ============================================================================
-- APLICAR (breve)
--   1) Confirmar en el Dashboard de Supabase que el proyecto es PigTecBD
--      (DESARROLLO). La identidad NO se puede comprobar de forma inequivoca con
--      SQL; verificar en el panel ANTES de ejecutar.
--   2) SQL Editor -> pegar TODO este script -> Run.
--      Esperado: "Success. No rows returned".
--   3) Si PostgREST sirve esquema cacheado: NOTIFY pgrst, 'reload schema';
--
-- VERIFICACION (solo lectura) - ejecutar despues de aplicar
--   -- 3 politicas esperadas en litters (SELECT/INSERT/UPDATE; sin DELETE)
--   SELECT policyname, cmd, roles FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'litters'
--    ORDER BY policyname;
--
--   -- Privilegios: authenticated solo SELECT/INSERT/UPDATE; sin anon ni DELETE
--   SELECT grantee, privilege_type
--     FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND table_name = 'litters'
--    ORDER BY grantee, privilege_type;
--
--   -- RLS activado (relrowsecurity = true, ya desde 001)
--   SELECT relname, relrowsecurity FROM pg_class
--    WHERE oid = 'public.litters'::regclass;
--
-- PRUEBA FUNCIONAL SUGERIDA (solo PigTecBD, con datos SINTETICOS marcados,
-- requiere aprobacion aparte):
--   - admin/manager/operator activo registra una camada con madre hembra -> 201.
--   - operator intenta registrar una camada con madre inexistente -> 422.
--   - operador/veterinario consulta camadas -> 200; viewer/inactivo -> 403.
--   - DELETE /litters/:id -> 404 (no existe la ruta; ademas sin privilegio).
--   - consulta de crias GET /litters/:id/offspring -> 200 con las crias de la
--     camada (lectura de animals cubierta por 004).
-- ============================================================================
