import { DataAccessError, toDataError } from '../common/data-errors.js';
import { isLocationStatus, type LocationStatus } from '../common/location.js';
import type { PostgrestClientFactory } from '../common/postgrest.js';

/**
 * Area tal como se expone en la API. Los nombres coinciden con las columnas
 * reales de `public.areas` (snake_case), igual que `is_active` en /auth/profile.
 */
export interface Area {
  id: string;
  name: string;
  description: string | null;
  status: LocationStatus;
  created_at: string;
  updated_at: string;
}

/** Fila cruda devuelta por PostgREST. */
interface RawArea {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  status?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

const AREA_COLUMNS =
  'id, name, description, status, created_at, updated_at';

/** Valida y normaliza una fila. Cualquier dato inesperado es un fallo (503). */
function mapArea(row: RawArea): Area {
  if (
    typeof row.id !== 'string' ||
    typeof row.name !== 'string' ||
    !isLocationStatus(row.status) ||
    typeof row.created_at !== 'string' ||
    typeof row.updated_at !== 'string' ||
    (row.description !== null && typeof row.description !== 'string')
  ) {
    throw new DataAccessError();
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface ListAreasFilter {
  status?: LocationStatus;
}

export interface CreateAreaInput {
  name: string;
  description?: string | null;
}

export interface UpdateAreaInput {
  name?: string;
  description?: string | null;
}

/**
 * Acceso de solo lectura/escritura a `public.areas`.
 *
 * Cada operacion crea un cliente PostgREST por peticion con el JWT verificado,
 * de modo que PostgreSQL aplica RLS con la identidad del usuario (nunca
 * `service_role`).
 */
export interface AreaRepository {
  list(filter: ListAreasFilter, accessToken: string): Promise<Area[]>;
  findById(id: string, accessToken: string): Promise<Area | null>;
  create(input: CreateAreaInput, accessToken: string): Promise<Area>;
  update(
    id: string,
    input: UpdateAreaInput,
    accessToken: string,
  ): Promise<Area | null>;
  setStatus(
    id: string,
    status: LocationStatus,
    accessToken: string,
  ): Promise<Area | null>;
}

export function createSupabaseAreaRepository(
  createClient: PostgrestClientFactory,
): AreaRepository {
  return {
    async list(filter, accessToken) {
      const client = createClient(accessToken);
      let query = client.from<RawArea>('areas').select(AREA_COLUMNS);

      if (filter.status) {
        query = query.eq('status', filter.status);
      }

      const { data, error } = await query.order('name', { ascending: true });
      if (error) {
        throw toDataError(error);
      }

      return (data ?? []).map(mapArea);
    },

    async findById(id, accessToken) {
      const client = createClient(accessToken);
      const { data, error } = await client
        .from<RawArea>('areas')
        .select(AREA_COLUMNS)
        .eq('id', id)
        .maybeSingle();

      if (error) {
        throw toDataError(error);
      }

      return data ? mapArea(data) : null;
    },

    async create(input, accessToken) {
      const client = createClient(accessToken);
      const values: Record<string, unknown> = { name: input.name };
      if (input.description !== undefined) {
        values.description = input.description;
      }

      const { data, error } = await client
        .from<RawArea>('areas')
        .insert(values)
        .select(AREA_COLUMNS)
        .single();

      if (error) {
        throw toDataError(error);
      }
      if (!data) {
        throw new DataAccessError();
      }

      return mapArea(data);
    },

    async update(id, input, accessToken) {
      const values: Record<string, unknown> = {};
      if (input.name !== undefined) {
        values.name = input.name;
      }
      if (input.description !== undefined) {
        values.description = input.description;
      }

      const client = createClient(accessToken);
      const { data, error } = await client
        .from<RawArea>('areas')
        .update(values)
        .eq('id', id)
        .select(AREA_COLUMNS)
        .maybeSingle();

      if (error) {
        throw toDataError(error);
      }

      return data ? mapArea(data) : null;
    },

    async setStatus(id, status, accessToken) {
      const client = createClient(accessToken);
      const { data, error } = await client
        .from<RawArea>('areas')
        .update({ status })
        .eq('id', id)
        .select(AREA_COLUMNS)
        .maybeSingle();

      if (error) {
        throw toDataError(error);
      }

      return data ? mapArea(data) : null;
    },
  };
}

/**
 * Repositorio por defecto (fail-closed): no puede acceder a los datos. Evita
 * que un backend sin repositorio real cableado opere; responde 503.
 */
export function createRejectingAreaRepository(): AreaRepository {
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
