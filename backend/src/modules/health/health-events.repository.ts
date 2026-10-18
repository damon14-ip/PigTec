import { isAnimalStatus, type AnimalStatus } from '../common/animal.js';
import { DataAccessError, toDataError } from '../common/data-errors.js';
import {
  isHealthEventType,
  type HealthEventType,
} from '../common/health-event.js';
import type { PostgrestClientFactory } from '../common/postgrest.js';

/**
 * Evento sanitario tal como se expone en la API. Los nombres coinciden con las
 * columnas reales de `public.health_events` (snake_case).
 *
 * La fila es historial inmutable: no se actualiza ni se borra por esta via
 * (especificacion 5.2 y decision D-09). El estado del porcino (mortalidad) lo
 * deriva el trigger `apply_mortality_event` de PostgreSQL, no el backend.
 */
export interface HealthEvent {
  id: string;
  animal_id: string;
  event_type: HealthEventType;
  occurred_at: string;
  title: string;
  description: string | null;
  documented_by: string | null;
  details: Record<string, unknown>;
  attachment_url: string | null;
  recorded_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Fila cruda devuelta por PostgREST. */
interface RawHealthEvent {
  id?: unknown;
  animal_id?: unknown;
  event_type?: unknown;
  occurred_at?: unknown;
  title?: unknown;
  description?: unknown;
  documented_by?: unknown;
  details?: unknown;
  attachment_url?: unknown;
  recorded_by?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

export const HEALTH_EVENT_COLUMNS =
  'id, animal_id, event_type, occurred_at, title, description, documented_by, ' +
  'details, attachment_url, recorded_by, created_at, updated_at';

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** `details` debe ser un objeto JSON (no nulo ni arreglo), como exige el CHECK. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Valida y normaliza una fila; cualquier dato inesperado es un fallo (503). */
function mapHealthEvent(row: RawHealthEvent): HealthEvent {
  if (
    typeof row.id !== 'string' ||
    typeof row.animal_id !== 'string' ||
    !isHealthEventType(row.event_type) ||
    typeof row.occurred_at !== 'string' ||
    typeof row.title !== 'string' ||
    !isNullableString(row.description) ||
    !isNullableString(row.documented_by) ||
    !isJsonObject(row.details) ||
    !isNullableString(row.attachment_url) ||
    !isNullableString(row.recorded_by) ||
    typeof row.created_at !== 'string' ||
    typeof row.updated_at !== 'string'
  ) {
    throw new DataAccessError();
  }

  return {
    id: row.id,
    animal_id: row.animal_id,
    event_type: row.event_type,
    occurred_at: row.occurred_at,
    title: row.title,
    description: row.description,
    documented_by: row.documented_by,
    details: row.details,
    attachment_url: row.attachment_url,
    recorded_by: row.recorded_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Estado minimo del animal necesario para validar un evento sanitario (lectura
 * interna del repositorio, no se expone). Se copia de `public.animals`.
 */
export interface HealthEventAnimalSnapshot {
  id: string;
  status: AnimalStatus;
}

export interface ListHealthEventsFilter {
  animal_id?: string;
  event_type?: HealthEventType;
  recorded_by?: string;
  /** Limite inferior inclusivo de `occurred_at` (ISO 8601). */
  occurred_from?: string;
  /** Limite superior inclusivo de `occurred_at` (ISO 8601). */
  occurred_to?: string;
  limit?: number;
  offset?: number;
}

/** Campos aceptados al registrar un evento (el autor se toma del JWT). */
export interface CreateHealthEventInput {
  animal_id: string;
  event_type: HealthEventType;
  title: string;
  occurred_at?: string;
  description?: string | null;
  documented_by?: string | null;
  details?: Record<string, unknown>;
  attachment_url?: string | null;
}

export interface HealthEventRepository {
  list(
    filter: ListHealthEventsFilter,
    accessToken: string,
  ): Promise<HealthEvent[]>;
  findById(id: string, accessToken: string): Promise<HealthEvent | null>;
  create(
    input: CreateHealthEventInput,
    recordedBy: string,
    accessToken: string,
  ): Promise<HealthEvent>;
  /** Estado actual del animal (o `null` si no existe o no es visible por RLS). */
  findAnimal(
    id: string,
    accessToken: string,
  ): Promise<HealthEventAnimalSnapshot | null>;
}

/**
 * Acceso a `public.health_events`. Cada operacion crea un cliente PostgREST por
 * peticion con el JWT verificado, de modo que PostgreSQL aplica RLS con la
 * identidad del usuario (nunca `service_role`).
 *
 * Al insertar un evento de mortalidad NO se actualiza `animals` desde el
 * backend: esa deriva la ejecuta el trigger `apply_mortality_event` en la misma
 * transaccion (integridad atomica, sin duplicar logica).
 *
 * No hay borrado fisico ni actualizacion: no existe `delete` ni `update`
 * (especificacion 5.2, decision D-09 y migracion 007 sin privilegio UPDATE).
 */
export function createSupabaseHealthEventRepository(
  createClient: PostgrestClientFactory,
): HealthEventRepository {
  return {
    async list(filter, accessToken) {
      const client = createClient(accessToken);
      let query = client
        .from<RawHealthEvent>('health_events')
        .select(HEALTH_EVENT_COLUMNS);

      if (filter.animal_id) {
        query = query.eq('animal_id', filter.animal_id);
      }
      if (filter.event_type) {
        query = query.eq('event_type', filter.event_type);
      }
      if (filter.recorded_by) {
        query = query.eq('recorded_by', filter.recorded_by);
      }
      if (filter.occurred_from) {
        query = query.gte('occurred_at', filter.occurred_from);
      }
      if (filter.occurred_to) {
        query = query.lte('occurred_at', filter.occurred_to);
      }

      const offset = filter.offset ?? 0;
      const limit = filter.limit ?? 100;
      query = query.range(offset, offset + limit - 1);

      const { data, error } = await query.order('occurred_at', {
        ascending: false,
      });
      if (error) {
        throw toDataError(error);
      }

      return (data ?? []).map(mapHealthEvent);
    },

    async findById(id, accessToken) {
      const client = createClient(accessToken);
      const { data, error } = await client
        .from<RawHealthEvent>('health_events')
        .select(HEALTH_EVENT_COLUMNS)
        .eq('id', id)
        .maybeSingle();

      if (error) {
        throw toDataError(error);
      }

      return data ? mapHealthEvent(data) : null;
    },

    async create(input, recordedBy, accessToken) {
      const values: Record<string, unknown> = {
        animal_id: input.animal_id,
        event_type: input.event_type,
        title: input.title,
        recorded_by: recordedBy,
      };
      if (input.occurred_at !== undefined) {
        values.occurred_at = input.occurred_at;
      }
      if (input.description !== undefined) {
        values.description = input.description;
      }
      if (input.documented_by !== undefined) {
        values.documented_by = input.documented_by;
      }
      if (input.details !== undefined) {
        values.details = input.details;
      }
      if (input.attachment_url !== undefined) {
        values.attachment_url = input.attachment_url;
      }

      const client = createClient(accessToken);
      const { data, error } = await client
        .from<RawHealthEvent>('health_events')
        .insert(values)
        .select(HEALTH_EVENT_COLUMNS)
        .single();

      if (error) {
        throw toDataError(error);
      }
      if (!data) {
        throw new DataAccessError();
      }

      return mapHealthEvent(data);
    },

    async findAnimal(id, accessToken) {
      const client = createClient(accessToken);
      const { data, error } = await client
        .from<{ id?: unknown; status?: unknown }>('animals')
        .select('id, status')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        throw toDataError(error);
      }
      if (!data) {
        return null;
      }
      if (typeof data.id !== 'string' || !isAnimalStatus(data.status)) {
        throw new DataAccessError();
      }

      return { id: data.id, status: data.status };
    },
  };
}

/** Repositorio por defecto (fail-closed): responde 503. */
export function createRejectingHealthEventRepository(): HealthEventRepository {
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
  };
}
