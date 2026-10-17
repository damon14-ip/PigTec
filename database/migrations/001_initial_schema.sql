-- ============================================================================
-- PigTec - Migracion inicial de base de datos
-- ----------------------------------------------------------------------------
-- Archivo:    database/migrations/001_initial_schema.sql
-- Motor:      PostgreSQL en Supabase (requiere PostgreSQL 15 o superior)
-- Referencia: PorciControl_BD_inicial.txt (esquema inicial v0.1)
-- Contexto:   proyecto Supabase de DESARROLLO ("PigTecBD"), base vacia
-- Estado:     PROPUESTA CORREGIDA. NO ejecutada. Requiere revision y aprobacion.
-- ----------------------------------------------------------------------------
-- OBJETIVO
--   Recrear, en una base Supabase vacia, la estructura y las reglas de negocio
--   del esquema inicial del proyecto, de forma versionada, atomica y verificable.
--
-- ALCANCE
--   Esta migracion SOLO crea estructura (tipos, tablas, indices, funciones,
--   triggers, vista, RLS base y una politica minima). No crea ni modifica datos.
--
-- NO HACE (a proposito)
--   - NO crea datos, usuarios ni perfiles (nada de datos ficticios).
--   - NO crea ni altera objetos administrados por Supabase Auth.
--     Solo REFERENCIA auth.users(id). La tabla auth.users la administra Supabase.
--   - NO crea ni altera extensiones administradas por Supabase (ver paso 1).
--   - NO crea el aprovisionamiento de perfiles (trigger en auth.users).
--   - NO crea las politicas RLS operativas.
--   - NO endurece las funciones de movimientos/mortalidad.
--   Todos esos cambios se reservan para migraciones posteriores (ver README.md).
--
-- ATOMICIDAD
--   Todo el script corre dentro de una unica transaccion: si algo falla, no
--   queda estado parcial. Ademas hay comprobaciones previas (compatibilidad y
--   base vacia) que abortan con un mensaje claro y evitan reejecuciones.
--
-- PREREQUISITOS
--   1. Proyecto Supabase de DESARROLLO (no produccion) y vacio.
--      Verificar la identidad del proyecto en el Dashboard ANTES de ejecutar
--      (name/ref). La identidad NO se puede confirmar de forma inequivoca con SQL.
--   2. PostgreSQL 15+ (lo cumplen los proyectos Supabase actuales) por el uso de
--      `security_invoker` en la vista.
--   3. El esquema auth debe existir con auth.users (lo aporta Supabase Auth).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0.a Compatibilidad: security_invoker exige PostgreSQL 15 o superior.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF current_setting('server_version_num')::int < 150000 THEN
        RAISE EXCEPTION
            'Migracion 001_initial_schema requiere PostgreSQL 15 o superior (security_invoker en la vista). Version detectada: %',
            current_setting('server_version');
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 0.b Comprobacion de seguridad: la base no debe contener objetos de PigTec.
--     Solo inspecciona nombres propios de PigTec; los objetos internos de
--     Supabase (auth, storage, extensions, etc.) no bloquean la migracion.
--     Aborta si encuentra tablas, tipos, vista, funciones, indices con nombre
--     propio, triggers o la politica del esquema inicial.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    conflictos text[];
BEGIN
    SELECT array_agg(objeto ORDER BY objeto) INTO conflictos
    FROM (
        -- Siete tablas y la vista (via pg_class/pg_namespace): se detecta
        -- cualquier clase de relacion con ese nombre en public, SIN restringir
        -- relkind. Asi se evitan conflictos con tablas, vistas, vistas
        -- materializadas, tablas foraneas, particiones u otras clases de
        -- relacion, aunque information_schema no las muestre por privilegios.
        SELECT 'relacion public.' || x.nombre AS objeto
        FROM unnest(ARRAY[
            'profiles','areas','pens','animals','litters',
            'animal_movements','health_events','v_animals_current'
        ]) AS x(nombre)
        WHERE EXISTS (
            SELECT 1
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relname = x.nombre
        )
        UNION ALL
        -- Seis tipos ENUM
        SELECT 'tipo public.' || x.nombre
        FROM unnest(ARRAY[
            'user_role','animal_sex','animal_status',
            'location_status','movement_reason','health_event_type'
        ]) AS x(nombre)
        WHERE EXISTS (
            SELECT 1 FROM pg_type ty JOIN pg_namespace n ON n.oid = ty.typnamespace
            WHERE n.nspname = 'public' AND ty.typname = x.nombre
        )
        UNION ALL
        -- Funciones
        SELECT 'funcion public.' || x.nombre
        FROM unnest(ARRAY[
            'set_updated_at','apply_animal_movement','apply_mortality_event'
        ]) AS x(nombre)
        WHERE EXISTS (
            SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = x.nombre
        )
        UNION ALL
        -- Indices con nombre propio
        SELECT 'indice public.' || x.nombre
        FROM unnest(ARRAY[
            'uq_animals_ear_tag_code','idx_animal_movements_animal_date',
            'idx_health_events_animal_date','idx_health_events_type_date'
        ]) AS x(nombre)
        WHERE EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'i' AND c.relname = x.nombre
        )
        UNION ALL
        -- Triggers con nombre propio
        SELECT 'trigger ' || x.nombre
        FROM unnest(ARRAY[
            'trg_profiles_updated_at','trg_areas_updated_at','trg_pens_updated_at',
            'trg_litters_updated_at','trg_animals_updated_at','trg_health_events_updated_at',
            'trg_apply_animal_movement','trg_apply_mortality_event'
        ]) AS x(nombre)
        WHERE EXISTS (
            SELECT 1
            FROM pg_trigger tg
            JOIN pg_class c ON c.oid = tg.tgrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND tg.tgname = x.nombre AND NOT tg.tgisinternal
        )
        UNION ALL
        -- Politica del esquema inicial
        SELECT 'politica public.' || x.nombre
        FROM unnest(ARRAY['profile_select_own']) AS x(nombre)
        WHERE EXISTS (
            SELECT 1 FROM pg_policies pp
            WHERE pp.schemaname = 'public' AND pp.policyname = x.nombre
        )
    ) AS detectados;

    IF conflictos IS NOT NULL THEN
        RAISE EXCEPTION
            'Migracion 001_initial_schema abortada: se detectaron objetos propios de PigTec ya existentes (%). Revise el estado de la base antes de continuar.',
            array_to_string(conflictos, ', ');
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 1. Extensiones
--    NO se crea ni modifica ninguna extension. `gen_random_uuid()` es parte del
--    nucleo de PostgreSQL 13+ (esquema pg_catalog) y Supabase ejecuta 15+, por
--    lo que pgcrypto no es necesario aqui. Se evita tocar extensiones
--    administradas por Supabase (p. ej. en el esquema "extensions").
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 2. Tipos ENUM
--    Orden y valores identicos al esquema inicial. "viewer" se conserva como
--    valor heredado del enum (no se elimina); su uso no es funcional.
-- ----------------------------------------------------------------------------
CREATE TYPE public.user_role AS ENUM ('admin','manager','operator','veterinarian','viewer');
CREATE TYPE public.animal_sex AS ENUM ('male','female','unknown');
CREATE TYPE public.animal_status AS ENUM ('active','sold','dead','transferred_out','missing','inactive');
CREATE TYPE public.location_status AS ENUM ('active','inactive');
CREATE TYPE public.movement_reason AS ENUM ('weaning','growth_stage','fattening','breeding','health_isolation','sale','transfer','management','other');
CREATE TYPE public.health_event_type AS ENUM ('observation','symptom_report','documented_diagnosis','treatment','vaccination','deworming','mortality','recovery','other');

-- ----------------------------------------------------------------------------
-- 3. Perfiles
--    Referencia a auth.users(id). NO se recrea la tabla de Auth.
--    El rol por defecto se conserva en 'viewer' tal como el esquema inicial.
--    El aprovisionamiento con rol explicito queda para una migracion posterior.
-- ----------------------------------------------------------------------------
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    role public.user_role NOT NULL DEFAULT 'viewer',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 4. Areas
-- ----------------------------------------------------------------------------
CREATE TABLE public.areas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    status public.location_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 5. Corrales
-- ----------------------------------------------------------------------------
CREATE TABLE public.pens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    area_id UUID NOT NULL REFERENCES public.areas(id) ON DELETE RESTRICT,
    code TEXT NOT NULL,
    name TEXT,
    capacity INTEGER CHECK (capacity IS NULL OR capacity >= 0),
    status public.location_status NOT NULL DEFAULT 'active',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (area_id, code)
);

-- ----------------------------------------------------------------------------
-- 6. Animales
--    Se crea SIN la FK a litters (aun no existe) para romper la dependencia
--    circular animals <-> litters. La FK se agrega en el paso 8.
--
--    CHECK de origin (correccion aprobada):
--      - Se admiten los cuatro valores canonicos de la especificacion (4.2):
--        born_on_farm, purchased, transferred_in, unknown.
--      - NULL SE PERMITE: `origin` es opcional en el esquema inicial y puede
--        faltar en historicos, compras o transferencias sin informacion. NULL
--        representa "no registrado" y NO equivale a 'unknown' (que es un valor
--        explicito: "origen conocido como desconocido"). La restriccion solo
--        limita los valores cuando hay contenido.
-- ----------------------------------------------------------------------------
CREATE TABLE public.animals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    animal_code TEXT NOT NULL UNIQUE,
    ear_tag_code TEXT,
    sex public.animal_sex NOT NULL DEFAULT 'unknown',
    breed TEXT,
    birth_date DATE,
    origin TEXT,
    mother_id UUID REFERENCES public.animals(id) ON DELETE RESTRICT,
    father_id UUID REFERENCES public.animals(id) ON DELETE RESTRICT,
    litter_id UUID,
    current_pen_id UUID REFERENCES public.pens(id) ON DELETE RESTRICT,
    status public.animal_status NOT NULL DEFAULT 'active',
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    exit_date DATE,
    notes TEXT,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (id <> mother_id AND id <> father_id),
    CHECK (exit_date IS NULL OR exit_date >= entry_date),
    CONSTRAINT chk_animals_origin CHECK (
        origin IS NULL
        OR origin IN ('born_on_farm','purchased','transferred_in','unknown')
    )
);

-- Indice unico parcial del arete (correccion aprobada):
--   unicidad insensible a mayusculas/minusculas y a espacios al inicio/final,
--   solo para valores no vacios. Se normaliza con lower(btrim(ear_tag_code)).
--   La especificacion (4.1) admite que el arete coincida con el codigo PigTec y
--   que la unicidad ignore diferencias de caja tras normalizar espacios.
CREATE UNIQUE INDEX uq_animals_ear_tag_code
ON public.animals (lower(btrim(ear_tag_code)))
WHERE ear_tag_code IS NOT NULL AND btrim(ear_tag_code) <> '';

-- ----------------------------------------------------------------------------
-- 7. Camadas
-- ----------------------------------------------------------------------------
CREATE TABLE public.litters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    litter_code TEXT UNIQUE,
    mother_id UUID REFERENCES public.animals(id) ON DELETE RESTRICT,
    father_id UUID REFERENCES public.animals(id) ON DELETE RESTRICT,
    birth_date DATE,
    total_born INTEGER CHECK (total_born IS NULL OR total_born >= 0),
    born_alive INTEGER CHECK (born_alive IS NULL OR born_alive >= 0),
    stillborn INTEGER CHECK (stillborn IS NULL OR stillborn >= 0),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (total_born IS NULL OR
        ((born_alive IS NULL OR born_alive <= total_born) AND
         (stillborn IS NULL OR stillborn <= total_born)))
);

-- ----------------------------------------------------------------------------
-- 8. FK diferida animals.litter_id -> litters.id
-- ----------------------------------------------------------------------------
ALTER TABLE public.animals
ADD CONSTRAINT fk_animals_litter
FOREIGN KEY (litter_id) REFERENCES public.litters(id) ON DELETE RESTRICT;

-- ----------------------------------------------------------------------------
-- 9. Movimientos de animales
-- ----------------------------------------------------------------------------
CREATE TABLE public.animal_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    animal_id UUID NOT NULL REFERENCES public.animals(id) ON DELETE RESTRICT,
    from_pen_id UUID REFERENCES public.pens(id) ON DELETE RESTRICT,
    to_pen_id UUID REFERENCES public.pens(id) ON DELETE RESTRICT,
    moved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reason public.movement_reason NOT NULL DEFAULT 'other',
    notes TEXT,
    recorded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (to_pen_id IS NOT NULL OR reason IN ('sale','transfer','other')),
    CHECK (from_pen_id IS DISTINCT FROM to_pen_id)
);
CREATE INDEX idx_animal_movements_animal_date
ON public.animal_movements (animal_id, moved_at DESC);

-- ----------------------------------------------------------------------------
-- 10. Eventos sanitarios
-- ----------------------------------------------------------------------------
CREATE TABLE public.health_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    animal_id UUID NOT NULL REFERENCES public.animals(id) ON DELETE RESTRICT,
    event_type public.health_event_type NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    title TEXT NOT NULL,
    description TEXT,
    documented_by TEXT,
    details JSONB NOT NULL DEFAULT '{}'::JSONB,
    attachment_url TEXT,
    recorded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (jsonb_typeof(details) = 'object')
);
CREATE INDEX idx_health_events_animal_date
ON public.health_events (animal_id, occurred_at DESC);
CREATE INDEX idx_health_events_type_date
ON public.health_events (event_type, occurred_at DESC);

-- ----------------------------------------------------------------------------
-- 11. Funcion generica de updated_at
--     SECURITY INVOKER (por defecto). No referencia objetos de usuario, por lo
--     que no requiere search_path fijo. Se conserva identica al esquema inicial.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_areas_updated_at BEFORE UPDATE ON public.areas
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_pens_updated_at BEFORE UPDATE ON public.pens
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_litters_updated_at BEFORE UPDATE ON public.litters
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_animals_updated_at BEFORE UPDATE ON public.animals
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_health_events_updated_at BEFORE UPDATE ON public.health_events
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 12. Trigger de aplicacion de movimientos
--     Se conserva EXACTAMENTE como el esquema inicial. Su endurecimiento
--     (coherencia de estado, bloqueo tras salida, search_path, idempotencia)
--     se reserva para una migracion posterior.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_animal_movement()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    UPDATE public.animals
       SET current_pen_id = NEW.to_pen_id,
           updated_at = NOW()
     WHERE id = NEW.animal_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No existe el animal %', NEW.animal_id;
    END IF;

    IF NEW.reason = 'sale' THEN
        UPDATE public.animals SET status = 'sold',
            exit_date = COALESCE(exit_date, NEW.moved_at::date),
            current_pen_id = NULL, updated_at = NOW()
        WHERE id = NEW.animal_id;
    ELSIF NEW.reason = 'transfer' AND NEW.to_pen_id IS NULL THEN
        UPDATE public.animals SET status = 'transferred_out',
            exit_date = COALESCE(exit_date, NEW.moved_at::date),
            current_pen_id = NULL, updated_at = NOW()
        WHERE id = NEW.animal_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_apply_animal_movement
AFTER INSERT ON public.animal_movements
FOR EACH ROW EXECUTE FUNCTION public.apply_animal_movement();

-- ----------------------------------------------------------------------------
-- 13. Trigger de aplicacion de mortalidad
--     Se conserva EXACTAMENTE como el esquema inicial. Su endurecimiento se
--     reserva para una migracion posterior.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_mortality_event()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.event_type = 'mortality' THEN
        UPDATE public.animals SET status = 'dead',
            exit_date = COALESCE(exit_date, NEW.occurred_at::date),
            current_pen_id = NULL, updated_at = NOW()
        WHERE id = NEW.animal_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_apply_mortality_event
AFTER INSERT ON public.health_events
FOR EACH ROW EXECUTE FUNCTION public.apply_mortality_event();

-- ----------------------------------------------------------------------------
-- 14. Vista de inventario actual (correccion aprobada)
--     Se crea con `security_invoker = true` (PostgreSQL 15+). Con esta opcion
--     la vista se evalua con los privilegios del INVOCADOR y, por tanto, respeta
--     las politicas RLS de las tablas base (animals, pens, areas) en lugar de
--     saltarselas. Sin security_invoker, una vista propiedad de un rol con
--     BYPASSRLS podria exponer todas las filas; con security_invoker, cada
--     usuario solo ve lo que las politicas RLS le permiten.
--
--     Comportamiento esperado hoy: las tablas base tienen RLS habilitado pero
--     AUN SIN politicas operativas (se crearan en la migracion 003). Por tanto,
--     la vista devolvera 0 filas a authenticated/anon. Eso es intencional y
--     seguro hasta que existan politicas.
-- ----------------------------------------------------------------------------
CREATE VIEW public.v_animals_current
WITH (security_invoker = true) AS
SELECT a.id, a.animal_code, a.ear_tag_code, a.sex, a.breed, a.birth_date,
       a.origin, a.status, a.entry_date, a.exit_date, a.current_pen_id,
       p.code AS current_pen_code, ar.name AS current_area_name,
       a.created_at, a.updated_at
FROM public.animals a
LEFT JOIN public.pens p ON p.id = a.current_pen_id
LEFT JOIN public.areas ar ON ar.id = p.area_id;

-- Privilegios de la vista:
--   - Se revoca todo acceso a anon y a PUBLIC: no debe haber acceso anonimo a
--     datos operativos (especificacion, seccion 8).
--   - El acceso de authenticated queda bajo las politicas RLS de las tablas
--     base (efecto de security_invoker). Hoy, sin politicas operativas, ese
--     acceso devuelve 0 filas. La concesion/afinacion de privilegios definitivos
--     se hara junto con el diseno de RLS (migracion 003).
REVOKE ALL ON public.v_animals_current FROM anon;
REVOKE ALL ON public.v_animals_current FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 15. RLS base
--     Se habilita RLS en las siete tablas, como el esquema inicial. NO se crean
--     politicas operativas en esta migracion: quedan reservadas para la fase de
--     diseno de RLS. Sin politicas, las tablas operativas no conceden filas al
--     rol authenticated (denegacion por defecto).
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.litters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.animals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.animal_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_events ENABLE ROW LEVEL SECURITY;

-- Politica minima del esquema inicial: cada usuario autenticado solo ve su
-- propio perfil. Necesaria para que funcione GET /auth/profile del backend.
CREATE POLICY profile_select_own ON public.profiles
FOR SELECT TO authenticated USING (id = auth.uid());

-- NOTA DE SEGURIDAD:
-- Las tablas operativas tienen RLS activado y no tienen politicas generales.
-- Antes de usar el cliente Supabase desde React, definir politicas por rol y
-- privilegios de columna; o acceder desde el backend, que valida cada permiso.
-- Nunca exponer la clave service_role al navegador.

COMMIT;
-- FIN DE LA MIGRACION 001
