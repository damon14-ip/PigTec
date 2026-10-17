-- ============================================================================
-- PigTec - Migracion 002: aprovisionamiento de perfiles y gestion de roles
-- ----------------------------------------------------------------------------
-- Archivo:    database/migrations/002_profile_provisioning.sql
-- Motor:      PostgreSQL 17.x en Supabase (proyecto de DESARROLLO: PigTecBD)
-- Depende de: 001_initial_schema.sql (ya ejecutada; estructura verificada)
-- Estado:     PROPUESTA CORREGIDA. NO ejecutada. Requiere revision y aprobacion.
-- ----------------------------------------------------------------------------
-- OBJETIVO
--   Procurar que todo usuario de Supabase Auth tenga un perfil con privilegios
--   nulos y permitir que SOLO un administrador activo asigne rol y estado, con
--   auditoria persistente de cada cambio.
--
-- ALCANCE
--   Estructura + funciones + triggers + auditoria + privilegios. NO crea usuarios
--   de Auth, NO configura el registro publico (ajuste del Dashboard) y NO
--   implementa el endpoint administrativo del backend. SI crea los PERFILES
--   faltantes de usuarios ya existentes en auth.users, siempre como
--   viewer/inactivo (sin rol operativo y sin activarlos).
--
-- NO HACE (a proposito)
--   - NO crea ni altera objetos administrados por Supabase Auth: solo dispara
--     un trigger sobre auth.users y REFERENCIA auth.users(id).
--   - NO otorga privilegios por registrarse: el perfil nuevo queda en
--     role='viewer' e is_active=false (inutilizable para operar).
--   - NO usa service_role ni claves; la RPC actua con la identidad del admin.
--   - NO permite INSERT/UPDATE/DELETE directos de authenticated sobre profiles
--     ni sobre la auditoria.
--
-- REGLAS DE NEGOCIO IMPLEMENTADAS
--   - Un perfil con role='viewer' NUNCA puede estar activo: la RPC rechaza
--     cualquier intento de activar un viewer (params viewer + is_active=true).
--   - Sin cambios (rol y estado identicos a los actuales) -> no hay UPDATE ni
--     evento de auditoria (operacion no-op).
--   - Autogestion de rol/estado por la RPC -> rechazada.
--   - Proteccion del ultimo administrador ACTIVO.
--   - Revalidacion del llamante con valores VIGENTES tras adquirir los bloqueos:
--     si el administrador fue desactivado o degradado por otra transaccion, la
--     RPC NO opera.
--
-- CONCURRENCIA (PostgreSQL READ COMMITTED)
--   Toda la RPC se serializa con un BLOQUEO GLOBAL transaccional:
--       pg_catalog.pg_advisory_xact_lock(<clave fija reservada por PigTec>)
--   Se toma UNA sola vez, antes de cualquier bloqueo de fila, y se libera
--   automaticamente al terminar la transaccion (COMMIT/ROLLBACK). Con el
--   bloqueo global tomado:
--     - se busca que solo una gestion de roles se ejecute a la vez; el orden de
--       bloqueos es uniforme y no hay espera cruzada, de modo que no deberian
--       producirse deadlocks entre RPC (analisis estatico, sin pruebas reales);
--     - el rol/estado del llamante se RELEE tras tomarlo: si otra transaccion
--       lo degrado o desactivo, la RPC aborta sin operar;
--     - el conteo del ultimo administrador activo se calcula sobre un conjunto
--       estable (ninguna otra RPC cambia roles en ese intervalo).
--   ESTAS CONCLUSIONES PROVIENEN DE REVISION ESTATICA Y ANALISIS DE BLOQUEOS;
--   FALTAN PRUEBAS DE CONCURRENCIA REALES EN POSTGRESQL/SUPABASE.
--   NOTA: el patron aislado `SELECT ... ORDER BY id FOR UPDATE` sobre los
--   administradores activos YA serializa entre RPC (todas bloquean el mismo
--   conjunto, no vacio). El bloqueo global NO lo sustituye por capricho: lo hace
--   explicito, simple y sin depender de detalles finos de READ COMMITTED/EPQ, y
--   ademas cubre el caso de fallo si no existiera ningun administrador activo.
--   Las filas de administradores activos se siguen bloqueando (ORDER BY id) como
--   defensa en profundidad frente a cambios directos por SQL privilegiado.
--
-- PRIVACIDAD (PII)
--   public.profile_access_audit contiene identificadores personales (profile_id,
--   actor_id) y correos electronicos (actor_email, target_email). El acceso es de
--   solo lectura y limitado a administradores activos. La POLITICA DE CONSERVACION
--   (plazo de retencion y anonimizacion) esta PENDIENTE DE APROBACION.
--
-- SEGURIDAD (SECURITY DEFINER)
--   Solo dos funciones usan SECURITY DEFINER, con `SET search_path = ''` y
--   referencias totalmente calificadas (public.*, auth.*, pg_catalog implicito):
--     - public.handle_new_user()         (funcion de trigger; EXECUTE revocado)
--     - public.admin_set_profile_access  (RPC; EXECUTE solo a authenticated)
--   Su propietario es el rol que ejecuta la migracion (postgres), con BYPASSRLS,
--   necesario para escribir en profiles pese a que RLS esta activado y no hay
--   politicas de escritura. NO TRANSFERIR LA PROPIEDAD a un rol menor.
--
-- PRIVILEGIOS REVISADOS (no solo tablas)
--   - Tablas: profiles y profile_access_audit.
--   - Funciones: EXECUTE revocado a PUBLIC/anon; RPC solo a authenticated.
--   - SECUENCIA de identidad de la auditoria: se revoca su uso a PUBLIC/anon/
--     authenticated (no se asume que el REVOKE sobre la tabla baste).
--   - ESQUEMA public: se revoca CREATE a PUBLIC/anon/authenticated (se conserva
--     USAGE, necesario para PostgREST). Supabase `service_role` es privilegiado
--     por diseno y NO se usa desde la aplicacion.
--
-- PREREQUISITOS
--   1. Migracion 001 aplicada (public.profiles y profile_select_own existen).
--   2. Ejecutar como propietario (SQL Editor de Supabase o psql como postgres).
--   3. PASO MANUAL E INDEPENDIENTE (fuera del SQL): desactivar el registro
--      publico en Supabase Auth (ver procedimiento del primer administrador).
--
-- ATOMICIDAD
--   Todo el script corre en una transaccion. Aborta si 001 no esta aplicada o
--   si 002 ya lo esta, para evitar reejecuciones accidentales.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. Comprobaciones previas
--    a) 001 aplicada (public.profiles existe).
--    b) 002 no aplicada aun (ni auditoria, ni funciones, ni trigger).
--    c) PostgreSQL 15+ (motor objetivo: 17.x).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    ya_existe text[];
BEGIN
    IF to_regclass('public.profiles') IS NULL THEN
        RAISE EXCEPTION
            'Migracion 002 abortada: no existe public.profiles. Aplique primero 001_initial_schema.sql.';
    END IF;

    IF current_setting('server_version_num')::int < 150000 THEN
        RAISE EXCEPTION
            'Migracion 002 requiere PostgreSQL 15 o superior. Version detectada: %',
            current_setting('server_version');
    END IF;

    SELECT array_agg(objeto ORDER BY objeto) INTO ya_existe
    FROM (
        SELECT 'tabla public.profile_access_audit' AS objeto
        WHERE to_regclass('public.profile_access_audit') IS NOT NULL
        UNION ALL
        SELECT 'funcion public.handle_new_user()'
        WHERE EXISTS (
            SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'handle_new_user'
        )
        UNION ALL
        SELECT 'funcion public.admin_set_profile_access(...)'
        WHERE EXISTS (
            SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'admin_set_profile_access'
        )
        UNION ALL
        SELECT 'trigger on_auth_user_created'
        WHERE EXISTS (
            SELECT 1
            FROM pg_trigger t
            JOIN pg_class c ON c.oid = t.tgrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'auth' AND t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal
        )
    ) AS detectados;

    IF ya_existe IS NOT NULL THEN
        RAISE EXCEPTION
            'Migracion 002 abortada: ya existen objetos de esta migracion (%). Revise el estado antes de continuar.',
            array_to_string(ya_existe, ', ');
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 1. Auditoria de cambios de rol y estado
--
--    PRESERVACION ANTE BORRADO: no hay clave foranea a public.profiles ni a
--    auth.users. Se guardan copias del id y del correo del usuario afectado y
--    del administrador, de modo que la auditoria SOBREVIVE a la eliminacion de
--    la cuenta (no se propaga CASCADE).
--
--    PII: los correos y los identificadores son datos personales. Acceso de solo
--    lectura para administradores activos. CONSERVACION PENDIENTE DE APROBACION.
--
--    RLS: lectura solo para administradores activos; SIN politicas de escritura
--    (la insercion la realiza la RPC SECURITY DEFINER, que actua como su
--    propietario). Ademas se revocan los privilegios de escritura.
-- ----------------------------------------------------------------------------
CREATE TABLE public.profile_access_audit (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    profile_id UUID NOT NULL,                  -- usuario afectado (sin FK: preserva la auditoria)
    actor_id UUID NOT NULL,                    -- administrador responsable (sin FK)
    actor_email TEXT,                          -- snapshot (PII)
    target_email TEXT,                         -- snapshot (PII)
    old_role public.user_role NOT NULL,
    new_role public.user_role NOT NULL,
    old_is_active BOOLEAN NOT NULL,
    new_is_active BOOLEAN NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profile_access_audit_profile
ON public.profile_access_audit (profile_id, changed_at DESC);

ALTER TABLE public.profile_access_audit ENABLE ROW LEVEL SECURITY;

-- Lectura: solo administradores activos. El subconsulta sobre profiles se evalua
-- con los privilegios del llamante; la politica profile_select_own le permite
-- leer su propia fila, por lo que no hay recursion (profiles no consulta audit).
CREATE POLICY profile_access_audit_select_admin ON public.profile_access_audit
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'admin'::public.user_role
          AND p.is_active
    )
);

-- Privilegios de tabla: SOLO SELECT para authenticated (sujeto a RLS). PUBLIC y
-- anon sin ningun privilegio; nadie escribe directamente (la insercion la realiza
-- la RPC SECURITY DEFINER actuando como propietario).
REVOKE ALL ON public.profile_access_audit FROM PUBLIC;
REVOKE ALL ON public.profile_access_audit FROM anon;
REVOKE ALL ON public.profile_access_audit FROM authenticated;
GRANT SELECT ON public.profile_access_audit TO authenticated;

-- Privilegios de la SECUENCIA de identidad (no basta con la tabla): el uso de
-- nextval/currval se revoca a PUBLIC/anon/authenticated. Solo el propietario
-- (postgres) inserta en la auditoria a traves de la RPC.
DO $$
DECLARE
    seq text := pg_get_serial_sequence('public.profile_access_audit', 'id');
BEGIN
    IF seq IS NOT NULL THEN
        EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC', seq);
        EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM anon', seq);
        EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM authenticated', seq);
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Aprovisionamiento: perfil inicial sin privilegios
--
--    Al insertarse un usuario en auth.users se crea su perfil con:
--      - role = 'viewer'   (rol NO operativo en el backend)
--      - is_active = false (requiere activacion explicita del administrador)
--      - full_name no vacio, derivado de forma segura
--    NUNCA se toma el rol ni el estado de raw_user_meta_data (lo controla el
--    usuario). El metadata se usa solo como nombre visible.
--
--    Idempotente ante perfil preexistente (ON CONFLICT DO NOTHING) y robusto:
--    no lanza en casos normales. Si fallara de forma no prevista, la transaccion
--    del alta de usuario revierte (atomico), evitando usuarios sin perfil.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, role, is_active)
    VALUES (
        NEW.id,
        COALESCE(
            NULLIF(BTRIM(COALESCE(NEW.raw_user_meta_data ->> 'full_name', '')), ''),
            NULLIF(SPLIT_PART(COALESCE(NEW.email, ''), '@', 1), ''),
            'usuario'
        ),
        'viewer'::public.user_role,
        FALSE
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

-- La funcion de trigger no se invoca directamente: se revoca EXECUTE por completo.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM authenticated;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 2b. Usuarios PREEXISTENTES en auth.users (alta anterior al trigger)
--     El trigger solo cubre altas NUEVAS. Para no dejar cuentas sin perfil, se
--     crean los perfiles faltantes con el MISMO criterio seguro: viewer e
--     is_active=false (SIN rol operativo y SIN activar cuentas automaticamente).
--     Idempotente (ON CONFLICT DO NOTHING) y atomico con la migracion.
--
--     Gestion de usuarios anteriores: quedan con perfil viewer/inactivo y
--     requieren una accion EXPLICITA del administrador (admin_set_profile_access)
--     para operar. Si un usuario anterior se elimina en Auth, su perfil cae en
--     cascada (FK de 001) y la auditoria se conserva.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_faltantes integer;
BEGIN
    SELECT count(*) INTO v_faltantes
      FROM auth.users u
      LEFT JOIN public.profiles p ON p.id = u.id
     WHERE p.id IS NULL;

    IF v_faltantes > 0 THEN
        RAISE NOTICE
            'Migracion 002: % usuario(s) de auth.users sin perfil; se crean como viewer/inactivo.',
            v_faltantes;
    END IF;

    INSERT INTO public.profiles (id, full_name, role, is_active)
    SELECT
        u.id,
        COALESCE(
            NULLIF(BTRIM(COALESCE(u.raw_user_meta_data ->> 'full_name', '')), ''),
            NULLIF(SPLIT_PART(COALESCE(u.email, ''), '@', 1), ''),
            'usuario'
        ),
        'viewer'::public.user_role,
        FALSE
      FROM auth.users u
      LEFT JOIN public.profiles p ON p.id = u.id
     WHERE p.id IS NULL
    ON CONFLICT (id) DO NOTHING;
END;
$$;

-- Nota: si un usuario se elimina en Auth, su perfil se elimina en cascada (FK de
-- 001), pero las filas de auditoria asociadas se conservan.

-- ----------------------------------------------------------------------------
-- 3. RPC de administracion de perfiles (solo administradores activos)
--
--    Orden de comprobaciones:
--      (a) parametros validos (no nulos);
--      (b) regla viewer: un viewer NO puede quedar activo;
--      (c) identidad autenticada (auth.uid());
--      (d) comprobacion rapida (sin bloqueo) del llamante, para fallar pronto;
--      (e) BLOQUEO GLOBAL transaccional (pg_advisory_xact_lock): serializa toda
--          la gestion de roles y se libera al terminar la transaccion;
--      (e2) bloqueo de TODAS las filas de administradores activos, en orden
--           estable por id (defensa en profundidad frente a SQL directo);
--      (f) REVALIDACION del llamante con valores VIGENTES tras los bloqueos: si
--          otra transaccion lo degrado o desactivo, se aborta sin operar;
--      (g) el perfil destino existe (y se bloquea su fila);
--      (h) sin autogestion;
--      (i) sin cambios -> no-op (ni UPDATE ni auditoria);
--      (j) proteccion del ULTIMO administrador activo;
--      (k) UPDATE + auditoria en la misma transaccion.
--
--    Orden de bloqueo (uniforme en todas las invocaciones; pensado para no
--    producir inversiones de orden entre RPC):
--      global (advisory) -> admins activos por id -> llamante -> destino.
--
--    Concurrencia: el bloqueo global proporciona exclusion mutua entre RPC; el
--    conteo del ultimo administrador y el estado del llamante se leen bajo
--    bloqueo y son vigentes (analisis estatico).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_profile_access(
    target_id UUID,
    new_role public.user_role,
    new_is_active BOOLEAN
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    -- Clave global fija (reservada por PigTec) para serializar la gestion de roles.
    -- Cambiarla invalida la exclusion mutua con el bootstrap manual (misma clave).
    c_lock_key     CONSTANT BIGINT := 20261016;
    v_actor_id     UUID := auth.uid();
    v_actor_role   public.user_role;
    v_actor_active BOOLEAN;
    v_actor_email  TEXT;
    v_target_email TEXT;
    v_old_role     public.user_role;
    v_old_active   BOOLEAN;
    v_otros_admins INTEGER;
BEGIN
    -- (a) Parametros
    IF target_id IS NULL THEN
        RAISE EXCEPTION 'target_id es obligatorio' USING ERRCODE = '22004';
    END IF;
    IF new_role IS NULL THEN
        RAISE EXCEPTION 'new_role es obligatorio' USING ERRCODE = '22004';
    END IF;
    IF new_is_active IS NULL THEN
        RAISE EXCEPTION 'new_is_active es obligatorio' USING ERRCODE = '22004';
    END IF;

    -- (b) Un perfil viewer NUNCA puede estar activo (viewer no es operativo)
    IF new_role = 'viewer'::public.user_role AND new_is_active IS TRUE THEN
        RAISE EXCEPTION 'un perfil viewer no puede estar activo' USING ERRCODE = '22023';
    END IF;

    -- (c) Identidad autenticada
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'no autenticado' USING ERRCODE = '28000';
    END IF;

    -- (d) Comprobacion rapida (sin bloqueo): solo para fallar pronto. NO es la
    --     comprobacion definitiva; se revalida en (f) con valores vigentes.
    SELECT p.role, p.is_active
      INTO v_actor_role, v_actor_active
      FROM public.profiles p
     WHERE p.id = v_actor_id;

    IF v_actor_role IS DISTINCT FROM 'admin'::public.user_role
       OR v_actor_active IS NOT TRUE THEN
        RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
    END IF;

    -- (e) BLOQUEO GLOBAL transaccional: serializa TODA la gestion de roles.
    --     Se toma antes de cualquier bloqueo de fila (orden uniforme -> sin
    --     espera cruzada) y se libera al terminar la transaccion (COMMIT/ROLLBACK).
    PERFORM pg_catalog.pg_advisory_xact_lock(c_lock_key);

    -- (e2) Defensa en profundidad: bloqueo de TODAS las filas de administradores
    --      activos, en orden estable por id, frente a cambios directos por SQL
    --      privilegiado y para leer valores vigentes de forma consistente.
    PERFORM p.id
      FROM public.profiles p
     WHERE p.role = 'admin'::public.user_role
       AND p.is_active
     ORDER BY p.id
       FOR UPDATE;

    -- (f) Revalidacion del llamante con valores vigentes tras el bloqueo.
    SELECT p.role, p.is_active
      INTO v_actor_role, v_actor_active
      FROM public.profiles p
     WHERE p.id = v_actor_id
       FOR UPDATE;

    IF v_actor_role IS DISTINCT FROM 'admin'::public.user_role
       OR v_actor_active IS NOT TRUE THEN
        RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
    END IF;

    -- (g) El perfil destino debe existir (y se bloquea su fila)
    SELECT p.role, p.is_active
      INTO v_old_role, v_old_active
      FROM public.profiles p
     WHERE p.id = target_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'perfil inexistente' USING ERRCODE = 'P0002';
    END IF;

    -- (h) Un administrador no puede autogestionarse por esta RPC
    IF target_id = v_actor_id THEN
        RAISE EXCEPTION
            'un administrador no puede modificar su propio rol o estado'
            USING ERRCODE = '42501';
    END IF;

    -- (i) Sin cambios: no se actualiza ni se audita (no-op)
    IF v_old_role = new_role AND v_old_active = new_is_active THEN
        RAISE NOTICE 'sin cambios: no se actualiza ni se registra auditoria';
        RETURN;
    END IF;

    -- (j) Proteger al ultimo administrador activo (conteo vigente tras el bloqueo)
    IF v_old_role = 'admin'::public.user_role
       AND v_old_active
       AND (new_role IS DISTINCT FROM 'admin'::public.user_role
            OR new_is_active IS NOT TRUE) THEN
        SELECT COUNT(*)
          INTO v_otros_admins
          FROM public.profiles p
         WHERE p.role = 'admin'::public.user_role
           AND p.is_active
           AND p.id <> target_id;

        IF v_otros_admins = 0 THEN
            RAISE EXCEPTION
                'no se puede dejar el sistema sin administrador activo'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    -- Snapshot de correos para la auditoria (PII; no son secretos)
    SELECT u.email INTO v_actor_email FROM auth.users u WHERE u.id = v_actor_id;
    SELECT u.email INTO v_target_email FROM auth.users u WHERE u.id = target_id;

    -- (k) Actualizacion (el trigger trg_profiles_updated_at de 001 ajusta updated_at)
    UPDATE public.profiles p
       SET role = new_role,
           is_active = new_is_active
     WHERE p.id = target_id;

    -- (k) Auditoria del cambio (rol y estado anteriores y nuevos)
    INSERT INTO public.profile_access_audit (
        profile_id, actor_id, actor_email, target_email,
        old_role, new_role, old_is_active, new_is_active
    ) VALUES (
        target_id, v_actor_id, v_actor_email, v_target_email,
        v_old_role, new_role, v_old_active, new_is_active
    );
END;
$$;

-- EXECUTE: solo usuarios autenticados (la autorizacion real es interna). Nunca
-- anon ni PUBLIC.
REVOKE ALL ON FUNCTION public.admin_set_profile_access(UUID, public.user_role, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_profile_access(UUID, public.user_role, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_access(UUID, public.user_role, BOOLEAN) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. Blindaje de public.profiles frente a escrituras directas
--    - anon: sin acceso alguno.
--    - authenticated: SOLO SELECT (RLS limita a la fila propia via
--      profile_select_own). Se revocan INSERT/UPDATE/DELETE, de modo que el rol
--      y el estado NO puedan cambiarse por RLS ni por PostgREST: el unico camino
--      es la RPC admin_set_profile_access (SECURITY DEFINER con comprobacion).
--    (La edicion de otros campos por el propio usuario, si se aprueba, sera una
--     migracion posterior con privilegios de columna especificos.)
-- ----------------------------------------------------------------------------
REVOKE ALL ON public.profiles FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM authenticated;

-- ----------------------------------------------------------------------------
-- 5. Hardening de privilegios de esquema
--    Se impide crear objetos en public desde PUBLIC/anon/authenticated. Se
--    CONSERVA USAGE (necesario para PostgREST). No se toca service_role, que es
--    privilegiado por diseno y no se usa desde la aplicacion.
-- ----------------------------------------------------------------------------
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM anon;
REVOKE CREATE ON SCHEMA public FROM authenticated;

-- ============================================================================
-- PASO MANUAL (NO ejecutado por este SQL)
-- ============================================================================
-- 1) Desactivar el registro publico en Supabase Auth (Dashboard -> Authentication
--    -> Providers / Settings: "Allow new users to sign up" = OFF). Es un ajuste
--    de configuracion, INDEPENDIENTE del SQL, y debe verificarse manualmente en
--    el Dashboard antes de crear cuentas.
--
-- 2) BOOTSTRAP DEL PRIMER ADMINISTRADOR (manual, privilegiado y AUDITABLE).
--    No se introducen funciones publicas que permitan reclamar el rol admin. El
--    procedimiento lo ejecuta el responsable con acceso directo de propietario
--    (SQL Editor), UNA sola vez, en una sola transaccion, de modo que el cambio
--    y su registro en la auditoria sean atomicos:
--
--       a. Confirmar en el Dashboard que se trabaja en PigTecBD (desarrollo).
--       b. Desactivar el registro publico (paso 1).
--       c. Crear el usuario administrador (email + contrasena) desde el Dashboard
--          de Supabase Auth. El trigger creara su perfil viewer/inactivo.
--          Anotar su UUID (Auth -> Users), que NO es un secreto.
--       d. Ejecutar, sustituyendo '<UUID>' y sin guardar credenciales, el
--          siguiente bloque EN UNA SOLA TRANSACCION. Incluye guardas de
--          idempotencia (no crea un segundo administrador raiz y no se repite)
--          y toma el MISMO bloqueo global que la RPC para no colisionar con ella:
--
--          BEGIN;
--          DO $bootstrap$
--          DECLARE
--              v_id        uuid := '<UUID>';
--              v_old_role  public.user_role;
--              v_old_active boolean;
--              v_email     text;
--              v_admins    integer;
--              v_previos   integer;
--          BEGIN
--              -- Mismo bloqueo global que admin_set_profile_access.
--              PERFORM pg_catalog.pg_advisory_xact_lock(20261016);
--
--              -- Guarda 1: el perfil debe existir.
--              SELECT role, is_active INTO v_old_role, v_old_active
--                FROM public.profiles WHERE id = v_id;
--              IF NOT FOUND THEN
--                  RAISE EXCEPTION 'perfil inexistente para %', v_id;
--              END IF;
--
--              -- Guarda 2: no repetir si ya es administrador activo.
--              IF v_old_role = 'admin'::public.user_role AND v_old_active THEN
--                  RAISE EXCEPTION 'el perfil % ya es administrador activo', v_id;
--              END IF;
--
--              -- Guarda 3: no crear un "segundo primer administrador".
--              SELECT count(*) INTO v_admins
--                FROM public.profiles
--               WHERE role = 'admin'::public.user_role AND is_active;
--              IF v_admins > 0 THEN
--                  RAISE EXCEPTION
--                      'ya existe al menos un administrador activo; use admin_set_profile_access';
--              END IF;
--
--              -- Guarda 4: el bootstrap no puede haberse ejecutado nunca antes.
--              SELECT count(*) INTO v_previos
--                FROM public.profile_access_audit
--               WHERE actor_email = '(bootstrap manual)';
--              IF v_previos > 0 THEN
--                  RAISE EXCEPTION 'el bootstrap ya fue ejecutado; no se repite';
--              END IF;
--
--              SELECT email INTO v_email FROM auth.users WHERE id = v_id;
--
--              UPDATE public.profiles
--                 SET role = 'admin'::public.user_role, is_active = TRUE
--               WHERE id = v_id;
--
--              -- Evento inicial de auditoria, ATOMICO con el cambio. No hay
--              -- usuario autenticado previo: se registra actor = el propio perfil
--              -- y actor_email como marca de bootstrap manual. UNICA excepcion.
--              INSERT INTO public.profile_access_audit (
--                  profile_id, actor_id, actor_email, target_email,
--                  old_role, new_role, old_is_active, new_is_active
--              ) VALUES (
--                  v_id, v_id, '(bootstrap manual)', v_email,
--                  v_old_role, 'admin'::public.user_role, v_old_active, TRUE
--              );
--          END;
--          $bootstrap$;
--          COMMIT;
--
--       e. Verificar con GET /auth/profile que responde 200 con role=admin.
--          No se guarda ninguna contrasena ni clave en el repositorio.
--
-- 3) CREACION DE CUENTAS DESDE LA INTERFAZ (FUTURO, NO IMPLEMENTADO AQUI):
--    requerira un endpoint backend admin-only que valide el rol admin y use la
--    API administrativa de Supabase (crear usuario/activar) con secretos
--    EXCLUSIVAMENTE del lado servidor (nunca en el navegador ni en Git). El rol
--    y el estado se fijaran llamando a admin_set_profile_access. No se incluye
--    ese endpoint en esta migracion.
-- ============================================================================

COMMIT;
-- FIN DE LA MIGRACION 002
