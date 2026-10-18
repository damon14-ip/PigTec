import { isAnimalStatus, type AnimalStatus } from '../common/animal.js';
import { DataAccessError, toDataError } from '../common/data-errors.js';
import { isLocationStatus, type LocationStatus } from '../common/location.js';
import {
  isMovementReason,
  type MovementReason,
} from '../common/movement.js';
import type { PostgrestClientFactory } from '../common/postgrest.js';

/**
 * Movimiento de porcino tal como se expone en la API. Los nombres coinciden con
 * las columnas reales de `public.animal_movements` (snake_case).
 *
 * La fila es historial inmutable: no se actualiza ni se borra desde el backend.
 */
export interface Movement {
  id: string;
  animal_id: string;
  from_pen_id: string | null;
  to_pen_id: string | null;
  moved_at: string;
  reason: MovementReason;
  notes: string | null;
  recorded_by: string | null;
  created_at: string;
}

/** Fila cruda devuelta por PostgREST. */
interface RawMovement {
  id?: unknown;
  animal_id?: unknown;
  from_pen_id?: unknown;
  to_pen_id?: unknown;
  moved_at?: unknown;
  reason?: unknown;
  notes?: unknown;
  recorded_by?: unknown;
  created_at?: unknown;
}

export const MOVEMENT_COLUMNS =
  'id, animal_id, from_pen_id, to_pen_id, moved_at, reason, notes, ' +
  'recorded_by, created_at';

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** Valida y normaliza una fila; cualquier dato inesperado es un fallo (503). */
function mapMovement(row: RawMovement): Movement {
  if (
    typeof row.id !== 'string' ||
    typeof row.animal_id !== 'string' ||
    !isNullableString(row.from_pen_id) ||
    !isNullableString(row.to_pen_id) ||
    typeof row.moved_at !== 'string' ||
    !isMovementReason(row.reason) ||
    !isNullableString(row.notes) ||
    !isNullableString(row.recorded_by) ||
    typeof row.created_at !== 'string'
  ) {
    throw new DataAccessError();
  }

  return {
    id: row.id,
    animal_id: row.animal_id,
    from_pen_id: row.from_pen_id,
    to_pen_id: row.to_pen_id,
    moved_at: row.moved_at,
    reason: row.reason,
    notes: row.notes,
    recorded_by: row.recorded_by,
    created_at: row.created_at,
  };
}

/**
 * Estado minimo del animal necesario para validar un movimiento (no se expone:
 * es una lectura interna del repositorio). Se copia de `public.animals`.
 */
export interface MovementAnimalSnapshot {
  id: string;
  status: AnimalStatus;
  current_pen_id: string | null;
}

/**
 * Estado minimo del corral destino (con el estado de su area) para validar que
 * la ubicacion este operativa antes de mover.
 */
export interface MovementPenSnapshot {
  id: string;
  status: LocationStatus;
  area_id: string;
  area_status: LocationStatus;
}

export interface ListMovementsFilter {
  animal_id?: string;
  from_pen_id?: string;
  to_pen_id?: string;
  /** Coincide con `from_pen_id` O `to_pen_id` (movimientos que tocan un corral). */
  pen_id?: string;
  reason?: MovementReason;
  recorded_by?: string;
  /** Limite inferior inclusivo de `moved_at` (ISO 8601). */
  moved_from?: string;
  /** Limite superior inclusivo de `moved_at` (ISO 8601). */
  moved_to?: string;
  limit?: number;
  offset?: number;
}

/** Campos aceptados al registrar un movimiento (el autor se toma del JWT). */
export interface CreateMovementInput {
  animal_id: string;
  from_pen_id: string | null;
  to_pen_id: string | null;
  reason: MovementReason;
  moved_at?: string;
  notes?: string | null;
}

export interface MovementRepository {
  list(filter: ListMovementsFilter, accessToken: string): Promise<Movement[]>;
  findById(id: string, accessToken: string): Promise<Movement | null>;
  create(
    input: CreateMovementInput,
    recordedBy: string,
    accessToken: string,
  ): Promise<Movement>;
  /** Estado actual del animal (o `null` si no existe o no es visible por RLS). */
  findAnimal(
    id: string,
    accessToken: string,
  ): Promise<MovementAnimalSnapshot | null>;
  /** Corral con el estado de su area (o `null` si no existe o no es visible). */
  findPen(
    id: string,
    accessToken: string,
  ): Promise<MovementPenSnapshot | null>;
}

/**
 * Acceso a `public.animal_movements`. Cada operacion crea un cliente PostgREST
 * por peticion con el JWT verificado, de modo que PostgreSQL aplica RLS con la
 * identidad del usuario (nunca `service_role`).
 *
 * Al insertar un movimiento NO se actualiza `animals` desde el backend: esa
 * deriva la ejecuta el trigger `apply_animal_movement` en la misma transaccion
 * (integridad atomica, sin duplicar logica).
 */
export function createSupabaseMovementRepository(
  createClient: PostgrestClientFactory,
): MovementRepository {
  return {
    async list(filter, accessToken) {
      const client = createClient(accessToken);
      let query = client.from<RawMovement>('animal_movements').select(MOVEMENT_COLUMNS);

      if (filter.animal_id) {
        query = query.eq('animal_id', filter.animal_id);
      }
      if (filter.from_pen_id) {
        query = query.eq('from_pen_id', filter.from_pen_id);
      }
      if (filter.to_pen_id) {
        query = query.eq('to_pen_id', filter.to_pen_id);
      }
      if (filter.pen_id) {
        query = query.or(
          `from_pen_id.eq.${filter.pen_id},to_pen_id.eq.${filter.pen_id}`,
        );
      }
      if (filter.reason) {
        query = query.eq('reason', filter.reason);
      }
      if (filter.recorded_by) {
        query = query.eq('recorded_by', filter.recorded_by);
      }
      if (filter.moved_from) {
        query = query.gte('moved_at', filter.moved_from);
      }
      if (filter.moved_to) {
        query = query.lte('moved_at', filter.moved_to);
      }

      const offset = filter.offset ?? 0;
      const limit = filter.limit ?? 100;
      query = query.range(offset, offset + limit - 1);

      const { data, error } = await query.order('moved_at', { ascending: false });
      if (error) {
        throw toDataError(error);
      }

      return (data ?? []).map(mapMovement);
    },

    async findById(id, accessToken) {
      const client = createClient(accessToken);
      const { data, error } = await client
        .from<RawMovement>('animal_movements')
        .select(MOVEMENT_COLUMNS)
        .eq('id', id)
        .maybeSingle();

      if (error) {
        throw toDataError(error);
      }

      return data ? mapMovement(data) : null;
    },

    async create(input, recordedBy, accessToken) {
      const values: Record<string, unknown> = {
        animal_id: input.animal_id,
        from_pen_id: input.from_pen_id,
        to_pen_id: input.to_pen_id,
        reason: input.reason,
        recorded_by: recordedBy,
      };
      if (input.moved_at !== undefined) {
        values.moved_at = input.moved_at;
      }
      if (input.notes !== undefined) {
        values.notes = input.notes;
      }

      const client = createClient(accessToken);
      const { data, error } = await client
        .from<RawMovement>('animal_movements')
        .insert(values)
        .select(MOVEMENT_COLUMNS)
        .single();

      if (error) {
        throw toDataError(error);
      }
      if (!data) {
        throw new DataAccessError();
      }

      return mapMovement(data);
    },

    async findAnimal(id, accessToken) {
      const client = createClient(accessToken);
      const { data, error } = await client
        .from<{ id?: unknown; status?: unknown; current_pen_id?: unknown }>(
          'animals',
        )
        .select('id, status, current_pen_id')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        throw toDataError(error);
      }
      if (!data) {
        return null;
      }
      if (
        typeof data.id !== 'string' ||
        !isAnimalStatus(data.status) ||
        !isNullableString(data.current_pen_id)
      ) {
        throw new DataAccessError();
      }

      return {
        id: data.id,
        status: data.status,
        current_pen_id: data.current_pen_id,
      };
    },

    async findPen(id, accessToken) {
      const client = createClient(accessToken);
      const pen = await client
        .from<{ id?: unknown; status?: unknown; area_id?: unknown }>('pens')
        .select('id, status, area_id')
        .eq('id', id)
        .maybeSingle();

      if (pen.error) {
        throw toDataError(pen.error);
      }
      if (!pen.data) {
        return null;
      }
      if (
        typeof pen.data.id !== 'string' ||
        !isLocationStatus(pen.data.status) ||
        typeof pen.data.area_id !== 'string'
      ) {
        throw new DataAccessError();
      }

      const area = await client
        .from<{ id?: unknown; status?: unknown }>('areas')
        .select('id, status')
        .eq('id', pen.data.area_id)
        .maybeSingle();

      if (area.error) {
        throw toDataError(area.error);
      }
      // Si el area no es visible, se trata como no operativa (fail-closed).
      if (
        !area.data ||
        typeof area.data.id !== 'string' ||
        !isLocationStatus(area.data.status)
      ) {
        throw new DataAccessError();
      }

      return {
        id: pen.data.id,
        status: pen.data.status,
        area_id: pen.data.area_id,
        area_status: area.data.status,
      };
    },
  };
}

/** Repositorio por defecto (fail-closed): responde 503. */
export function createRejectingMovementRepository(): MovementRepository {
  return {
    async list() {
      throw new DataAccessError();
    },
    async findById() {
      throw new DataAccessError();
    },
    async create() {
      throw new DataAccessError();
    },
    async findAnimal() {
      throw new DataAccessError();
    },
    async findPen() {
      throw new DataAccessError();
    },
  };
}
