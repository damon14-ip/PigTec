import { DataAccessError, toDataError } from '../common/data-errors.js';
import { isLocationStatus, type LocationStatus } from '../common/location.js';
import type { PostgrestClientFactory } from '../common/postgrest.js';

/**
 * Corral tal como se expone en la API. Los nombres coinciden con las columnas
 * reales de `public.pens` (snake_case).
 */
export interface Pen {
  id: string;
  area_id: string;
  code: string;
  name: string | null;
  capacity: number | null;
  notes: string | null;
  status: LocationStatus;
  created_at: string;
  updated_at: string;
}

interface RawPen {
  id?: unknown;
  area_id?: unknown;
  code?: unknown;
  name?: unknown;
  capacity?: unknown;
  notes?: unknown;
  status?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

const PEN_COLUMNS =
  'id, area_id, code, name, capacity, notes, status, created_at, updated_at';

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function mapPen(row: RawPen): Pen {
  if (
    typeof row.id !== 'string' ||
    typeof row.area_id !== 'string' ||
    typeof row.code !== 'string' ||
    !isNullableString(row.name) ||
    !isNullableString(row.notes) ||
    !(row.capacity === null || typeof row.capacity === 'number') ||
    !isLocationStatus(row.status) ||
    typeof row.created_at !== 'string' ||
    typeof row.updated_at !== 'string'
  ) {
    throw new DataAccessError();
  }

  return {
    id: row.id,
    area_id: row.area_id,
    code: row.code,
    name: row.name,
    capacity: row.capacity,
    notes: row.notes,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface ListPensFilter {
  area_id?: string;
  status?: LocationStatus;
}

export interface CreatePenInput {
  area_id: string;
  code: string;
  name?: string | null;
  capacity?: number | null;
  notes?: string | null;
}

/**
 * Actualizacion de corral. No incluye `area_id`: reasignar un corral entre
 * areas queda fuera de esta etapa (no es destructivo, pero no se expone aun).
 */
export interface UpdatePenInput {
  code?: string;
  name?: string | null;
  capacity?: number | null;
  notes?: string | null;
}

export interface PenRepository {
  list(filter: ListPensFilter, accessToken: string): Promise<Pen[]>;
  findById(id: string, accessToken: string): Promise<Pen | null>;
  create(input: CreatePenInput, accessToken: string): Promise<Pen>;
  update(
    id: string,
    input: UpdatePenInput,
    accessToken: string,
  ): Promise<Pen | null>;
  setStatus(
    id: string,
    status: LocationStatus,
    accessToken: string,
  ): Promise<Pen | null>;
}

export function createSupabasePenRepository(
  createClient: PostgrestClientFactory,
): PenRepository {
  return {
    async list(filter, accessToken) {
      const client = createClient(accessToken);
      let query = client.from<RawPen>('pens').select(PEN_COLUMNS);

      if (filter.area_id) {
        query = query.eq('area_id', filter.area_id);
      }
      if (filter.status) {
        query = query.eq('status', filter.status);
      }

      const { data, error } = await query.order('code', { ascending: true });
      if (error) {
        throw toDataError(error);
      }

      return (data ?? []).map(mapPen);
    },

    async findById(id, accessToken) {
      const client = createClient(accessToken);
      const { data, error } = await client
        .from<RawPen>('pens')
        .select(PEN_COLUMNS)
        .eq('id', id)
        .maybeSingle();

      if (error) {
        throw toDataError(error);
      }

      return data ? mapPen(data) : null;
    },

    async create(input, accessToken) {
      const values: Record<string, unknown> = {
        area_id: input.area_id,
        code: input.code,
      };
      if (input.name !== undefined) {
        values.name = input.name;
      }
      if (input.capacity !== undefined) {
        values.capacity = input.capacity;
      }
      if (input.notes !== undefined) {
        values.notes = input.notes;
      }

      const client = createClient(accessToken);
      const { data, error } = await client
        .from<RawPen>('pens')
        .insert(values)
        .select(PEN_COLUMNS)
        .single();

      if (error) {
        throw toDataError(error);
      }
      if (!data) {
        throw new DataAccessError();
      }

      return mapPen(data);
    },

    async update(id, input, accessToken) {
      const values: Record<string, unknown> = {};
      if (input.code !== undefined) {
        values.code = input.code;
      }
      if (input.name !== undefined) {
        values.name = input.name;
      }
      if (input.capacity !== undefined) {
        values.capacity = input.capacity;
      }
      if (input.notes !== undefined) {
        values.notes = input.notes;
      }

      const client = createClient(accessToken);
      const { data, error } = await client
        .from<RawPen>('pens')
        .update(values)
        .eq('id', id)
        .select(PEN_COLUMNS)
        .maybeSingle();

      if (error) {
        throw toDataError(error);
      }

      return data ? mapPen(data) : null;
    },

    async setStatus(id, status, accessToken) {
      const client = createClient(accessToken);
      const { data, error } = await client
        .from<RawPen>('pens')
        .update({ status })
        .eq('id', id)
        .select(PEN_COLUMNS)
        .maybeSingle();

      if (error) {
        throw toDataError(error);
      }

      return data ? mapPen(data) : null;
    },
  };
}

/** Repositorio por defecto (fail-closed): responde 503. */
export function createRejectingPenRepository(): PenRepository {
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
    async update() {
      throw new DataAccessError();
    },
    async setStatus() {
      throw new DataAccessError();
    },
  };
}
