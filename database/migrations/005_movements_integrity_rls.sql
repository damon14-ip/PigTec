-- ============================================================================
-- PigTec - Migracion 005: integridad de movimientos y RLS
-- ----------------------------------------------------------------------------
-- Archivo:    database/migrations/005_movements_integrity_rls.sql
-- Motor:      PostgreSQL 17.x en Supabase (proyecto de DESARROLLO: PigTecBD)
-- Depende de: 001_initial_schema.sql (animal_movements, animals, pens, areas,
--             triggers apply_animal_movement / apply_mortality_event),
--             002_profile_provisioning.sql (profiles con rol/estado),
--             003_areas_pens_rls.sql (policies de areas/pens) y
--             004_animals_rls.sql (policies de animals).
-- Estado:     PROPUESTA (revision S4-A). NO ejecutada. Requiere revision y
--             aprobacion.
-- ----------------------------------------------------------------------------
-- OBJETIVO
--   1. Habilitar el acceso de la API a public.animal_movements mediante RLS:
--        - SELECT para usuarios ACTIVOS con rol admin, manager, operator o
--          veterinarian (historial consultable por todo rol operativo).
--        - INSERT por MOTIVO (matriz 5.1):
--            * salida externa (`sale`, o `transfer` sin destino): admin/manager;
--            * aislamiento sanitario (`health_isolation`): + veterinarian;
--            * movimientos internos y `transfer` con destino: admin/manager/operator.
--        - `recorded_by` debe ser el propio usuario autenticado (`auth.uid()`).
--        - Sin UPDATE ni DELETE: el historial es inmutable.
--   2. Garantizar integridad transaccional del movimiento reutilizando y
--      endureciendo el trigger existente `apply_animal_movement` (NO se duplica
--      la logica en el backend): coherencia de estado del animal, coherencia del
--      corral de origen con la ubicacion actual, destino distinto del origen,
--      venta siempre SIN corral destino, destino obligatorio en movimientos
--      internos y destino operativo (corral y area activos).
--   3. Proteger contra modificaciones directas de columnas derivadas de
--      `public.animals` (`current_pen_id`, `exit_date` y los estados terminales
--      `sold`/`dead`/`transferred_out`) por PostgREST: solo los triggers
--      legitimados (SECURITY DEFINER) pueden cambiarlas. Aplica tanto a UPDATE
--      como a INSERT: no se puede crear un animal ya en estado terminal ni con
--      `exit_date` prefijada (alta normal permitida). Los estados
--      administrativos (`active`/`inactive`/`missing`) siguen siendo editables
--      por el endpoint de estado (especificacion 5.2 y 9).
--
-- MODELO DE ACCESO
--   El backend usa SIEMPRE el JWT real del usuario (nunca service_role). El rol
--   y el estado NO se leen del JWT: se comprueban contra public.profiles con
--   auth.uid() (igual que 003/004).
--
-- DEFECTO QUE CORRIGE (revision estatica)
--   `apply_animal_movement` y `apply_mortality_event` eran SECURITY INVOKER:
--   su UPDATE sobre `animals` se evaluaba con la identidad del llamante y con
--   RLS activado. Como 004 solo permite UPDATE de `animals` a admin/manager, un
--   `operator` o un `veterinarian` autorizados a registrar movimientos NO
--   podian aplicar la ubicacion: el UPDATE afectaba 0 filas y el trigger
--   abortaba con "No existe el animal". Se corrigen como SECURITY DEFINER con
--   `search_path` fijo, que es justamente el endurecimiento previsto en el
--   README de migraciones para la 005.
--
-- DEFECTOS ADICIONALES CORREGIDOS (revision final)
--   a) La politica `movements_insert_by_reason` dependia de la precedencia de
--      AND/OR (los AND "ganan" a los OR); se reescribe con parentesis
--      EXPLICITOS por combinacion de motivo y rol, y se exige `to_pen_id IS
--      NULL` en la salida externa (antes `sale` con destino pasaba la politica).
--   b) `apply_animal_movement` NO imponia que una venta tuviera `to_pen_id`
--      nulo (el CHECK de 001 solo obliga destino para otros motivos; no lo
--      prohibe en `sale`). Se agrega la comprobacion explicita.
--   c) `apply_animal_movement` no reafirmaba que el destino fuera distinto del
--      origen (se apoyaba solo en el CHECK de 001). Se agrega la comprobacion.
--   d) `public.animals.status` era actualizable directamente por PostgREST
--      (admin/manager) permitiendo fijar `sold`/`dead`/`transferred_out` sin el
--      movimiento/mortalidad que los deriva. Se agrega una guardia BEFORE
--      INSERT OR UPDATE (seccion 6.b) que solo admite esos estados desde los
--      triggers legitimados, sin romper el endpoint de estado administrativo ni
--      el alta normal.
--
-- CORRECCION DE SEGURIDAD (Sprint 4, S4-A): autorizacion sin GUC
--   La primera version de la guardia 6.b distinguia las derivaciones legitimas
--   de las actualizaciones del cliente con una GUC de usuario
--   (`pigtec.derived_animal_update`, fijada con set_config y leida con
--   current_setting). Eso NO es una frontera de seguridad: en PostgreSQL
--   cualquier rol puede fijar parametros de configuracion personalizados (los
--   que llevan prefijo) con SET o set_config(), y la GUC no esta ligada a la
--   identidad autenticada. La autorizacion dependia, por tanto, de un estado de
--   sesion manipulable en lugar de un privilegio.
--
--   Se sustituye por una comprobacion de IDENTIDAD EFECTIVA. Los triggers
--   legitimados (`apply_animal_movement`, `apply_mortality_event`) son
--   SECURITY DEFINER y actualizan `animals` con la identidad del PROPIETARIO de
--   la tabla; un cliente de la API (PostgREST) se ejecuta siempre como
--   `authenticated`. La guardia (seccion 6.b) solo admite la deriva cuando
--   `current_user` es el propietario de `public.animals`. `authenticated` no
--   puede adoptar esa identidad (no es miembro del propietario, no puede
--   SET ROLE a el y no puede crear objetos en `public`: 002), de modo que la
--   distincion es un limite de privilegios real y no un marcador de sesion.
--
-- ATOMICIDAD Y CONCURRENCIA
--   Todo el script corre en una transaccion. El trigger bloquea la fila del
--   animal con `SELECT ... FOR UPDATE` antes de aplicar el movimiento, de modo
--   que dos movimientos concurrentes del mismo animal se serializan y la
--   comprobacion de origen/estado no sufre carreras.
--
-- NO HACE (a proposito)
--   - NO crea ni modifica tablas, columnas, enums ni indices.
--   - NO toca health_events mas alla de reafirmar su trigger (fuera de alcance
--     funcional de esta subetapa).
--   - NO implementa el flujo de correccion de movimientos historicos (pendiente).
--   - NO restringe el INSERT mas alla de los estados derivados: el alta puede
--     fijar el corral inicial y un estado inicial NO terminal
--     (active/inactive/missing); la guardia 6.b bloquea el alta con estado
--     terminal o con `exit_date` prefijada.
--   - NO aplica reglas de capacidad de corrales: `pens.capacity` existe, pero no
--     hay una regla de negocio aprobada que la imponga (ver decisiones pendientes).
--   - NO concede acceso a anon ni a PUBLIC y NO usa service_role.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. Comprobaciones previas
--    a) 001-004 aplicadas (objetos requeridos presentes).
--    b) 005 no aplicada aun (sin politicas, funcion ni trigger de esta migracion
--       y con `apply_animal_movement` todavia SECURITY INVOKER).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    faltantes text[];
    ya_existe text[];
BEGIN
    SELECT array_agg(x.nombre ORDER BY x.nombre) INTO faltantes
      FROM unnest(ARRAY[
          'public.animal_movements', 'public.animals', 'public.pens',
          'public.areas', 'public.profiles'
      ]) AS x(nombre)
     WHERE to_regclass(x.nombre) IS NULL;

    IF faltantes IS NOT NULL THEN
        RAISE EXCEPTION
            'Migracion 005 abortada: faltan objetos requeridos (%). Aplique primero 001, 002, 003 y 004.',
            array_to_string(faltantes, ', ');
    END IF;

    SELECT array_agg(objeto ORDER BY objeto) INTO ya_existe
      FROM (
          SELECT 'politica public.' || p.policyname AS objeto
            FROM pg_policies p
           WHERE p.schemaname = 'public'
             AND p.tablename = 'animal_movements'
             AND p.policyname IN
                 ('movements_select_operational', 'movements_insert_by_reason')
          UNION ALL
          SELECT 'funcion public.forbid_animal_movement_change'
           WHERE EXISTS (
               SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public'
                  AND p.proname = 'forbid_animal_movement_change'
           )
          UNION ALL
          SELECT 'trigger trg_animal_movements_immutable'
           WHERE EXISTS (
               SELECT 1 FROM pg_trigger t
               JOIN pg_class c ON c.oid = t.tgrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public'
                  AND t.tgname = 'trg_animal_movements_immutable'
                  AND NOT t.tgisinternal
           )
          UNION ALL
          SELECT 'funcion public.apply_animal_movement ya SECURITY DEFINER'
           WHERE EXISTS (
               SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public'
                  AND p.proname = 'apply_animal_movement'
                  AND p.prosecdef
           )
          UNION ALL
          SELECT 'funcion public.guard_animal_derived_change'
           WHERE EXISTS (
               SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public'
                  AND p.proname = 'guard_animal_derived_change'
           )
          UNION ALL
          SELECT 'trigger trg_animals_derived_guard'
           WHERE EXISTS (
               SELECT 1 FROM pg_trigger t
               JOIN pg_class c ON c.oid = t.tgrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public'
                  AND t.tgname = 'trg_animals_derived_guard'
                  AND NOT t.tgisinternal
           )
      ) AS d;

    IF ya_existe IS NOT NULL THEN
        RAISE EXCEPTION
            'Migracion 005 abortada: ya existen objetos de esta migracion (%). Revise el estado antes de continuar.',
            array_to_string(ya_existe, ', ');
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 1. Privilegios de tabla de public.animal_movements
--    - anon y PUBLIC: sin acceso.
--    - authenticated: SOLO SELECT e INSERT (RLS restringe las filas).
--      NO se concede UPDATE ni DELETE: el historial es inmutable.
-- ----------------------------------------------------------------------------
REVOKE ALL ON public.animal_movements FROM PUBLIC;
REVOKE ALL ON public.animal_movements FROM anon;
REVOKE ALL ON public.animal_movements FROM authenticated;
GRANT SELECT, INSERT ON public.animal_movements TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Politicas RLS de public.animal_movements
--    El predicado lee la fila PROPIA del llamante en public.profiles
--    (auth.uid()); no hay recursion porque profiles no consulta movements y
--    profile_select_own permite leer la fila propia.
--
--    Compatibilidad con supabase-js:
--      - .insert(...).select() -> INSERT ... RETURNING: exige INSERT (WITH CHECK)
--        y que la politica SELECT deje ver la fila devuelta.
-- ----------------------------------------------------------------------------
CREATE POLICY movements_select_operational ON public.animal_movements
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

-- La autorizacion de escritura depende del MOTIVO del movimiento y del rol; se
-- exige ademas que el autor registrado sea el propio usuario autenticado, para
-- que el historial no pueda atribuirse a otra persona.
--
-- Cada combinacion motivo/rol se agrupa con parentesis EXPLICITOS: no se
-- depende de la precedencia de AND/OR. Matriz revisada (especificacion 5.1):
--   (1) salida externa: `sale` o `transfer` SIN corral destino -> admin/manager;
--   (2) aislamiento sanitario `health_isolation` -> admin/manager/operator/vet;
--   (3) movimientos internos y `transfer` CON destino -> admin/manager/operator.
-- `viewer`, `anon` y usuarios inactivos quedan fuera de todas las ramas.
CREATE POLICY movements_insert_by_reason ON public.animal_movements
FOR INSERT TO authenticated
WITH CHECK (
    recorded_by = auth.uid()
    AND EXISTS (
        SELECT 1
          FROM public.profiles p
         WHERE p.id = auth.uid()
           AND p.is_active
           AND (
               -- (1) Salida externa: venta o transferencia SIN corral destino.
               (
                   (
                       reason = 'sale'::public.movement_reason
                       OR reason = 'transfer'::public.movement_reason
                   )
                   AND to_pen_id IS NULL
                   AND p.role IN (
                       'admin'::public.user_role,
                       'manager'::public.user_role
                   )
               )
               OR
               -- (2) Aislamiento sanitario: tambien el veterinario.
               (
                   reason = 'health_isolation'::public.movement_reason
                   AND p.role IN (
                       'admin'::public.user_role,
                       'manager'::public.user_role,
                       'operator'::public.user_role,
                       'veterinarian'::public.user_role
                   )
               )
               OR
               -- (3) Movimientos internos (incluye `transfer` CON destino).
               (
                   (
                       reason IN (
                           'weaning'::public.movement_reason,
                           'growth_stage'::public.movement_reason,
                           'fattening'::public.movement_reason,
                           'breeding'::public.movement_reason,
                           'management'::public.movement_reason,
                           'other'::public.movement_reason
                       )
                       OR (
                           reason = 'transfer'::public.movement_reason
                           AND to_pen_id IS NOT NULL
                       )
                   )
                   AND p.role IN (
                       'admin'::public.user_role,
                       'manager'::public.user_role,
                       'operator'::public.user_role
                   )
               )
           )
    )
);

-- Sin politicas de UPDATE ni DELETE: denegacion por defecto (ademas no hay
-- privilegios de tabla para esos comandos).

-- ----------------------------------------------------------------------------
-- 3. Inmutabilidad del historial de movimientos
--    Defensa en profundidad: aunque hoy no se conceden UPDATE/DELETE, un trigger
--    impide alterar o borrar el historial incluso si esos privilegios se
--    concedieran mas adelante. UNICA excepcion permitida: la anulacion de
--    `recorded_by` que ejecuta la accion referencial ON DELETE SET NULL al
--    eliminar un perfil (no altera el contenido del movimiento).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.forbid_animal_movement_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'public.animal_movements es historial inmutable: DELETE no permitido'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.recorded_by IS NULL
       AND OLD.recorded_by IS NOT NULL
       AND (NEW.id, NEW.animal_id, NEW.from_pen_id, NEW.to_pen_id,
            NEW.moved_at, NEW.reason, NEW.notes, NEW.created_at)
           IS NOT DISTINCT FROM
           (OLD.id, OLD.animal_id, OLD.from_pen_id, OLD.to_pen_id,
            OLD.moved_at, OLD.reason, OLD.notes, OLD.created_at)
    THEN
        RETURN NEW;  -- ON DELETE SET NULL de profiles.recorded_by
    END IF;

    RAISE EXCEPTION
        'public.animal_movements es historial inmutable: UPDATE no permitido'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER trg_animal_movements_immutable
BEFORE UPDATE OR DELETE ON public.animal_movements
FOR EACH ROW EXECUTE FUNCTION public.forbid_animal_movement_change();

-- ----------------------------------------------------------------------------
-- 4. Endurecimiento de apply_animal_movement (reutilizado, NO duplicado)
--    Cambios respecto de 001:
--      - SECURITY DEFINER con `search_path = ''` (referencias calificadas):
--        el UPDATE derivado de `animals` se ejecuta como propietario (postgres),
--        de modo que funcione con RLS y privilegios de columna restrictivos, sin
--        que operator/veterinarian necesiten UPDATE sobre `animals`.
--      - Bloqueo de la fila del animal (`FOR UPDATE`) y rechazo de movimientos
--        sobre animales en estados incompatibles (sold/dead/transferred_out/
--        inactive) o inexistentes.
--      - Coherencia de origen: `from_pen_id` debe coincidir con la ubicacion
--        actual del animal (o ambos nulos).
--      - Destino distinto del origen: se reafirma el CHECK de 001 (`from_pen_id
--        IS DISTINCT FROM to_pen_id`) de forma explicita.
--      - Una venta (`sale`) NUNCA lleva corral destino.
--      - Destino obligatorio salvo en salidas (`sale` y `transfer`): un motivo
--        interno sin destino dejaria al animal activo sin corral. Es una regla
--        MAS ESTRICTA que el CHECK minimo de 001 (que solo exige destino para
--        motivos fuera de sale/transfer/other); se aplica aqui para garantizar
--        la coherencia ubicacion-estado. PENDIENTE de confirmacion de negocio.
--      - Destino operativo: el corral destino y su area deben estar `active`.
--      - Se conserva la deriva de estado/fechas de 001 (sale -> sold;
--        transfer sin destino -> transferred_out; `exit_date` con COALESCE). Al
--        ser SECURITY DEFINER, el UPDATE derivado se ejecuta con la identidad
--        del propietario de `animals`, de modo que la guardia de la seccion 6.b
--        lo reconoce como deriva legitima (ver cabecera S4-A).
--
--    El INSERT en `animal_movements` sigue sujeto a RLS con la identidad del
--    llamante: SECURITY DEFINER solo eleva los privilegios del UPDATE derivado.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_animal_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_status      public.animal_status;
    v_current_pen uuid;
    v_to_pen      uuid := NEW.to_pen_id;
BEGIN
    -- Bloqueo de la fila del animal: serializa movimientos concurrentes y lee
    -- valores vigentes.
    SELECT a.status, a.current_pen_id
      INTO v_status, v_current_pen
      FROM public.animals a
     WHERE a.id = NEW.animal_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No existe el animal %', NEW.animal_id
            USING ERRCODE = 'P0002';
    END IF;

    -- Estados incompatibles con movimientos ordinarios.
    IF v_status IN (
        'sold'::public.animal_status,
        'dead'::public.animal_status,
        'transferred_out'::public.animal_status,
        'inactive'::public.animal_status
    ) THEN
        RAISE EXCEPTION
            'El animal % no admite movimientos en estado %', NEW.animal_id, v_status
            USING ERRCODE = '23514';
    END IF;

    -- Coherencia del origen con la ubicacion actual.
    IF NEW.from_pen_id IS DISTINCT FROM v_current_pen THEN
        RAISE EXCEPTION
            'El origen del movimiento no coincide con el corral actual del animal %',
            NEW.animal_id
            USING ERRCODE = '23514';
    END IF;

    -- El destino debe ser distinto del origen (reafirma el CHECK de 001;
    -- defensa en profundidad).
    IF v_to_pen IS NOT NULL AND v_to_pen = v_current_pen THEN
        RAISE EXCEPTION
            'El corral de destino debe ser distinto del corral de origen del animal %',
            NEW.animal_id
            USING ERRCODE = '23514';
    END IF;

    -- Una venta nunca lleva corral destino.
    IF NEW.reason = 'sale'::public.movement_reason AND v_to_pen IS NOT NULL THEN
        RAISE EXCEPTION 'El movimiento de venta no admite corral destino'
            USING ERRCODE = '23514';
    END IF;

    -- Destino obligatorio salvo en salidas (regla mas estricta que el CHECK de
    -- 001; ver cabecera de la seccion 4).
    IF v_to_pen IS NULL
       AND NEW.reason NOT IN (
           'sale'::public.movement_reason,
           'transfer'::public.movement_reason
       ) THEN
        RAISE EXCEPTION 'El movimiento de motivo % exige corral destino', NEW.reason
            USING ERRCODE = '23514';
    END IF;

    -- Destino operativo (solo cuando hay corral destino).
    IF v_to_pen IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1
              FROM public.pens p
              JOIN public.areas ar ON ar.id = p.area_id
             WHERE p.id = v_to_pen
               AND p.status = 'active'::public.location_status
               AND ar.status = 'active'::public.location_status
        ) THEN
            RAISE EXCEPTION 'El corral destino % no esta operativo', v_to_pen
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- Aplicacion del movimiento (deriva de estado/fechas conservada de 001).
    -- Al ser SECURITY DEFINER, este UPDATE se ejecuta con la identidad del
    -- propietario de `animals`; la guardia de la seccion 6.b lo reconoce como
    -- deriva legitima (ningun llamante directo adopta esa identidad).
    UPDATE public.animals
       SET current_pen_id = v_to_pen,
           updated_at = pg_catalog.now()
     WHERE id = NEW.animal_id;

    IF NEW.reason = 'sale'::public.movement_reason THEN
        UPDATE public.animals
           SET status = 'sold'::public.animal_status,
               exit_date = COALESCE(exit_date, NEW.moved_at::date),
               current_pen_id = NULL,
               updated_at = pg_catalog.now()
         WHERE id = NEW.animal_id;
    ELSIF NEW.reason = 'transfer'::public.movement_reason AND v_to_pen IS NULL THEN
        UPDATE public.animals
           SET status = 'transferred_out'::public.animal_status,
               exit_date = COALESCE(exit_date, NEW.moved_at::date),
               current_pen_id = NULL,
               updated_at = pg_catalog.now()
         WHERE id = NEW.animal_id;
    END IF;

    RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Compatibilidad de apply_mortality_event (sanidad fuera de alcance funcional)
--    Se le da el mismo tratamiento SECURITY DEFINER + search_path para que siga
--    funcionando con los privilegios de columna restrictivos de la seccion 6.
--    NO se cambia su logica de negocio. Al ser SECURITY DEFINER, su UPDATE corre
--    con la identidad del propietario de `animals`, por lo que la guardia de la
--    seccion 6.b lo reconoce como deriva legitima (movimiento y mortalidad son
--    compatibles).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_mortality_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.event_type = 'mortality'::public.health_event_type THEN
        UPDATE public.animals
           SET status = 'dead'::public.animal_status,
               exit_date = COALESCE(exit_date, NEW.occurred_at::date),
               current_pen_id = NULL,
               updated_at = pg_catalog.now()
         WHERE id = NEW.animal_id;
    END IF;
    RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Proteccion de columnas derivadas de public.animals
--    004 concedio UPDATE a nivel de tabla para no romper los triggers SECURITY
--    INVOKER. Al pasar los triggers a SECURITY DEFINER (propietario postgres,
--    que no esta sujeto a privilegios de columna), se restringe el UPDATE de
--    `authenticated` a las columnas realmente editables por la API.
--
--    Quedan SIN privilegio de UPDATE (solo los triggers pueden cambiarlas):
--      current_pen_id, exit_date, animal_code, entry_date, created_by,
--      created_at, id.
--
--    `status` SI se concede (lo necesita PATCH /animals/:id/status), pero la
--    seccion 6.b impide fijar por esa via los estados derivados
--    (sold/dead/transferred_out). `updated_at` se concede por comodidad, pero el
--    trigger `trg_animals_updated_at` de 001 lo SOBRESCRIBE con NOW() en cada
--    UPDATE, por lo que un cliente no puede falsearlo.
--
--    Los endpoints existentes siguen funcionando:
--      - PATCH /animals/:id (datos generales) y
--      - PATCH /animals/:id/status (baja logica: status).
--    El INSERT conserva el alta normal (corral inicial y estado inicial no
--    terminal); la guardia 6.b impide crear un animal en estado terminal o con
--    `exit_date` prefijada.
-- ----------------------------------------------------------------------------
REVOKE UPDATE ON public.animals FROM authenticated;
GRANT UPDATE (
    ear_tag_code, sex, breed, birth_date, origin,
    mother_id, father_id, litter_id, status, notes, updated_at
) ON public.animals TO authenticated;

-- ----------------------------------------------------------------------------
-- 6.b Guardia de columnas derivadas de public.animals
--     El privilegio de columna NO impide que admin/manager (los unicos con
--     UPDATE/INSERT por RLS) fijen directamente `status='sold'`/`'dead'`/
--     `'transferred_out'` o `exit_date` por PostgREST, eludiendo el movimiento
--     o la mortalidad que deben derivarlos, ni que reactiven un animal terminal
--     (especificacion 5.2 y 9). Esta guardia BEFORE INSERT OR UPDATE lo bloquea.
--
--     Mecanismo (S4-A, sin GUC): distingue la deriva legitima por IDENTIDAD
--     EFECTIVA.
--       * Las derivaciones las ejecutan `apply_animal_movement` y
--         `apply_mortality_event`: son SECURITY DEFINER y, por tanto, escriben
--         `animals` con la identidad del PROPIETARIO de la tabla.
--       * Un cliente (PostgREST) escribe siempre con la identidad
--         `authenticated`.
--     La guardia es SECURITY INVOKER (para que `current_user` refleje al autor
--     real de la escritura) y acepta el cambio solo si `current_user` es el
--     propietario de `public.animals`. En cualquier otro caso aplica las
--     restricciones. `authenticated` no puede adoptar la identidad del
--     propietario (no es miembro de el, no puede SET ROLE y no puede crear
--     objetos en `public`: 002); es un limite de privilegios, no un marcador de
--     sesion manipulable.
--
--     Reglas por operacion (solo en la ruta del cliente):
--       * INSERT: no se puede crear un animal en estado terminal ni con
--         `exit_date` prefijada (ambos se derivan de un movimiento/mortalidad).
--         El alta normal sigue permitiendo corral inicial y estado inicial NO
--         terminal (active/inactive/missing); `current_pen_id` NO se restringe
--         en el alta.
--       * UPDATE: un estado terminal no se puede fijar ni abandonar (no existe
--         aun flujo de reversion/correccion) y `current_pen_id`/`exit_date` no
--         se pueden tocar (privilegio de columna + esta guardia).
--
--     Ningun camino SECURITY DEFINER permite eludirla: las unicas funciones de
--     este tipo en `public` son los dos triggers de deriva, que solo hacen
--     UPDATE (no INSERT) de `animals`; el propietario es codigo de confianza de
--     la base de datos y no es alcanzable por `authenticated`.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_animal_derived_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_owner name;
BEGIN
    -- Propietario de la tabla guardada (TG_RELID es el OID de public.animals).
    SELECT r.rolname
      INTO v_owner
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
     WHERE c.oid = TG_RELID;

    -- Ruta privilegiada: los triggers legitimados (SECURITY DEFINER) escriben
    -- con la identidad del propietario de la tabla. La deriva procede de codigo
    -- de la base de datos, no de un cliente de la API.
    IF current_user = v_owner THEN
        RETURN NEW;
    END IF;

    -- Ruta del cliente (authenticated via PostgREST).
    IF TG_OP = 'INSERT' THEN
        -- Un animal no puede registrarse en estado terminal: esos estados solo
        -- se derivan de un movimiento o de una mortalidad.
        IF NEW.status IS NOT NULL
           AND NEW.status IN (
               'sold'::public.animal_status,
               'dead'::public.animal_status,
               'transferred_out'::public.animal_status
           )
        THEN
            RAISE EXCEPTION
                'No se puede crear un animal en estado %: solo se deriva de un movimiento o de una mortalidad',
                NEW.status
                USING ERRCODE = '23514';
        END IF;

        -- La fecha de salida se deriva; no se fija en el alta.
        IF NEW.exit_date IS NOT NULL THEN
            RAISE EXCEPTION
                'exit_date no se puede fijar en el alta: solo se deriva de un movimiento o de una mortalidad'
                USING ERRCODE = '23514';
        END IF;

        RETURN NEW;
    END IF;

    -- UPDATE.
    -- (a) Estados terminales: no se fijan ni se revierten directamente.
    IF NEW.status IS DISTINCT FROM OLD.status
       AND (
           NEW.status IN (
               'sold'::public.animal_status,
               'dead'::public.animal_status,
               'transferred_out'::public.animal_status
           )
           OR OLD.status IN (
               'sold'::public.animal_status,
               'dead'::public.animal_status,
               'transferred_out'::public.animal_status
           )
       )
    THEN
        RAISE EXCEPTION
            'El estado % solo puede derivarse de un movimiento o de una mortalidad; un estado terminal no se fija ni se revierte directamente',
            NEW.status
            USING ERRCODE = '23514';
    END IF;

    -- (b) Columnas derivadas de la ubicacion/salida. Defensa en profundidad: el
    -- privilegio de columna de la seccion 6 ya impide el UPDATE al cliente.
    IF NEW.current_pen_id IS DISTINCT FROM OLD.current_pen_id
       OR NEW.exit_date IS DISTINCT FROM OLD.exit_date
    THEN
        RAISE EXCEPTION
            'current_pen_id y exit_date solo pueden derivarse de un movimiento o de una mortalidad'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_animals_derived_guard
BEFORE INSERT OR UPDATE ON public.animals
FOR EACH ROW EXECUTE FUNCTION public.guard_animal_derived_change();

-- ----------------------------------------------------------------------------
-- 7. Privilegios de las funciones (no invocables directamente por RPC)
--    Los triggers no requieren EXECUTE del llamante; se revoca por completo para
--    que no queden expuestas como endpoints RPC de PostgREST.
--    El propietario debe seguir siendo el rol de la migracion (postgres).
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.apply_animal_movement() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_animal_movement() FROM anon;
REVOKE ALL ON FUNCTION public.apply_animal_movement() FROM authenticated;

REVOKE ALL ON FUNCTION public.apply_mortality_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_mortality_event() FROM anon;
REVOKE ALL ON FUNCTION public.apply_mortality_event() FROM authenticated;

REVOKE ALL ON FUNCTION public.forbid_animal_movement_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forbid_animal_movement_change() FROM anon;
REVOKE ALL ON FUNCTION public.forbid_animal_movement_change() FROM authenticated;

REVOKE ALL ON FUNCTION public.guard_animal_derived_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_animal_derived_change() FROM anon;
REVOKE ALL ON FUNCTION public.guard_animal_derived_change() FROM authenticated;

-- ----------------------------------------------------------------------------
-- 8. Coherencia de propietarios exigida por la guardia 6.b (S4-A)
--    La guardia reconoce la deriva legitima comparando `current_user` con el
--    propietario de `public.animals`. Para que funcione, las funciones
--    SECURITY DEFINER que derivan el estado deben estar propiedad del mismo rol
--    que la tabla (sus UPDATE se ejecutan con esa identidad). `CREATE OR REPLACE`
--    NO cambia el propietario de una funcion existente, por lo que si `animals`
--    fue creada por un rol distinto la guardia no reconoceria la deriva y TODOS
--    los movimientos/mortalidades fallarian. Se aborta la migracion (rollback
--    total) para no dejar una guardia rota o insegura.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_owner_animals   name;
    v_owner_movement  name;
    v_owner_mortality name;
BEGIN
    SELECT r.rolname INTO v_owner_animals
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
     WHERE c.oid = 'public.animals'::regclass;

    SELECT r.rolname INTO v_owner_movement
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
     WHERE n.nspname = 'public'
       AND p.proname = 'apply_animal_movement';

    SELECT r.rolname INTO v_owner_mortality
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
     WHERE n.nspname = 'public'
       AND p.proname = 'apply_mortality_event';

    IF v_owner_movement IS DISTINCT FROM v_owner_animals
       OR v_owner_mortality IS DISTINCT FROM v_owner_animals
    THEN
        RAISE EXCEPTION
            'Migracion 005 abortada: public.animals (propietario %) y las funciones apply_animal_movement (%) / apply_mortality_event (%) deben compartir propietario para que la guardia 6.b reconozca la deriva legitima.',
            v_owner_animals, v_owner_movement, v_owner_mortality;
    END IF;
END;
$$;

COMMIT;
-- FIN DE LA MIGRACION 005

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
--   -- 2 politicas esperadas en animal_movements
--   SELECT policyname, cmd, roles FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'animal_movements'
--    ORDER BY policyname;
--
--   -- Privilegios: authenticated solo SELECT/INSERT; sin anon
--   SELECT grantee, privilege_type
--     FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND table_name = 'animal_movements'
--    ORDER BY grantee, privilege_type;
--
--   -- Columnas de animals con UPDATE para authenticated (sin current_pen_id ni exit_date)
--   SELECT column_name
--     FROM information_schema.column_privileges
--    WHERE table_schema = 'public' AND table_name = 'animals'
--      AND grantee = 'authenticated' AND privilege_type = 'UPDATE'
--    ORDER BY column_name;
--
--   -- Funciones SECURITY DEFINER con search_path fijo (prosecdef = true, proconfig con search_path=)
--   SELECT p.proname, p.prosecdef, p.proconfig
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('apply_animal_movement','apply_mortality_event')
--    ORDER BY p.proname;
--
--   -- Trigger de inmutabilidad presente
--   SELECT c.relname AS tabla, t.tgname AS trigger
--     FROM pg_trigger t
--     JOIN pg_class c ON c.oid = t.tgrelid
--     JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public' AND t.tgname = 'trg_animal_movements_immutable'
--      AND NOT t.tgisinternal;
--
--   -- Guardia de columnas derivadas presente (funcion + trigger)
--   SELECT p.proname, p.prosecdef, p.proconfig
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'guard_animal_derived_change';
--   -- esperado: pg_get_triggerdef con "BEFORE INSERT OR UPDATE ON public.animals"
--   SELECT c.relname AS tabla, t.tgname AS trigger,
--          pg_get_triggerdef(t.oid) AS definicion
--     FROM pg_trigger t
--     JOIN pg_class c ON c.oid = t.tgrelid
--     JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public' AND t.tgname = 'trg_animals_derived_guard'
--      AND NOT t.tgisinternal;
--
--   -- Guardia SIN GUC de sesion: SECURITY INVOKER y basada en el propietario
--   -- (esperado: prosecdef = false, usa_guc = false, usa_propietario = true)
--   SELECT p.proname, p.prosecdef,
--          (p.prosrc ILIKE '%current_setting%') AS usa_guc,
--          (p.prosrc ILIKE '%pg_roles%')       AS usa_propietario
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'guard_animal_derived_change';
--
--   -- Las funciones de deriva no usan set_config (esperado: 0 filas)
--   SELECT p.proname
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('apply_animal_movement','apply_mortality_event')
--      AND p.prosrc ILIKE '%set_config%';
--
--   -- Propietarios coherentes (esperado: 1 fila con un unico owner_*)
--   SELECT (SELECT r.rolname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
--            WHERE c.oid = 'public.animals'::regclass) AS owner_animals,
--          (SELECT r.rolname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--            JOIN pg_roles r ON r.oid = p.proowner
--           WHERE n.nspname = 'public' AND p.proname = 'apply_animal_movement') AS owner_movement,
--          (SELECT r.rolname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--            JOIN pg_roles r ON r.oid = p.proowner
--           WHERE n.nspname = 'public' AND p.proname = 'apply_mortality_event') AS owner_mortality;
--
-- PRUEBA FUNCIONAL SUGERIDA (solo PigTecBD, con datos SINTETICOS marcados,
-- requiere aprobacion aparte y se puede hacer con BEGIN; ... ROLLBACK;):
--   - POST /animals (alta normal) -> 201: la guardia 6.b NO interfiere (estado
--     inicial 'active' por defecto y corral inicial permitidos).
--   - INSERT directo por PostgREST de un animal con status='sold'/'dead'/
--     'transferred_out' -> rechazado por la guardia 6.b.
--   - INSERT directo por PostgREST de un animal con exit_date no nula ->
--     rechazado por la guardia 6.b.
--   - operator registra un movimiento interno valido -> 201 y el animal cambia
--     de corral (el trigger DERIVA la ubicacion).
--   - admin/manager intenta un `sale` con to_pen_id -> rechazado por el trigger.
--   - intento de UPDATE directo de animals.current_pen_id o exit_date por
--     PostgREST -> denegado (permiso de columna y guardia 6.b).
--   - intento de UPDATE directo de animals.status a 'sold'/'dead'/
--     'transferred_out' por PostgREST (admin/manager) -> rechazado por la
--     guardia 6.b.
--   - intento de reactivar un animal terminal (de 'sold'/'dead'/
--     'transferred_out' a 'active'/'missing'/'inactive') por PostgREST ->
--     rechazado por la guardia 6.b (no hay flujo de reversion todavia).
--   - PATCH /animals/:id/status con 'inactive'/'missing'/'active' sobre un
--     animal NO terminal -> 200 (la guardia 6.b NO interfiere con los estados
--     administrativos).
--   - intento de UPDATE/DELETE de animal_movements por PostgREST -> denegado
--     (sin privilegio y bloqueado por el trigger de inmutabilidad).
-- ============================================================================
