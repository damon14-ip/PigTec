import {
  isAnimalSex,
  isAnimalStatus,
  type AnimalSex,
  type AnimalStatus,
} from '../common/animal.js';
import { DataAccessError, toDataError } from '../common/data-errors.js';
import type { PostgrestClientFactory } from '../common/postgrest.js';

/**
 * Camada tal como se expone en la API. Los nombres coinciden con las columnas
 * reales de `public.litters` (snake_case).
 *
 * Nota: el esquema inicial NO tiene columna de autor (`created_by`) en `litters`
 * ni estado; la camada no se elimina fisicamente (decision D-09), por lo que no
 * hay `DELETE`.
 */
export interface Litter {
  id: string;
  litter_code: string | null;
  mother_id: string | null;
  father_id: string | null;
  birth_date: string | null;
  total_born: number | null;
  born_alive: number | null;
  stillborn: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Fila cruda devuelta por PostgREST. */
interface RawLitter {
  id?: unknown;
  litter_code?: unknown;
  mother_id?: unknown;
  father_id?: unknown;
  birth_date?: unknown;
  total_born?: unknown;
  born_alive?: unknown;
  stillborn?: unknown;
  notes?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

export const LITTER_COLUMNS =
  'id, litter_code, mother_id, father_id, birth_date, total_born, ' +
  'born_alive, stillborn, notes, created_at, updated_at';

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableInt(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value));
}

/** Valida y normaliza una fila; cualquier dato inesperado es un fallo (503). */
function mapLitter(row: RawLitter): Litter {
  if (
    typeof row.id !== 'string' ||
    !isNullableString(row.litter_code) ||
    !isNullableString(row.mother_id) ||
    !isNullableString(row.father_id) ||
    !isNullableString(row.birth_date) ||
    !isNullableInt(row.total_born) ||
    !isNullableInt(row.born_alive) ||
    !isNullableInt(row.stillborn) ||
    !isNullableString(row.notes) ||
    typeof row.created_at !== 'string' ||
    typeof row.updated_at !== 'string'
  ) {
    throw new DataAccessError();
  }

  return {
    id: row.id,
    litter_code: row.litter_code,
    mother_id: row.mother_id,
    father_id: row.father_id,
    birth_date: row.birth_date,
    total_born: row.total_born,
    born_alive: row.born_alive,
    stillborn: row.stillborn,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Estado minimo del animal necesario para validar los parentescos de una camada
 * (lectura interna del repositorio, no se expone). Solo se comprueba el sexo: la
 * existencia y el sexo son las reglas documentadas; no se inventan reglas sobre
 * el estado (vivo/vendido) del reproductor.
 */
export interface LitterAnimalSnapshot {
  id: string;
  sex: AnimalSex;
}

/**
 * Cria (lechon) asociada a una camada: subconjunto minimo de `public.animals`
 * cuyo `litter_id` apunta a la camada. Se expone un conjunto reducido y estable
 * en lugar de la fila completa de `animals`.
 */
export interface LitterOffspring {
  id: string;
  animal_code: string;
  ear_tag_code: string | null;
  sex: AnimalSex;
  birth_date: string | null;
  status: AnimalStatus;
  mother_id: string | null;
  father_id: string | null;
}

interface RawOffspring {
  id?: unknown;
  animal_code?: unknown;
  ear_tag_code?: unknown;
  sex?: unknown;
  birth_date?: unknown;
  status?: unknown;
  mother_id?: unknown;
  father_id?: unknown;
}

function mapOffspring(row: RawOffspring): LitterOffspring {
  if (
    typeof row.id !== 'string' ||
    typeof row.animal_code !== 'string' ||
    !isNullableString(row.ear_tag_code) ||
    !isAnimalSex(row.sex) ||
    !isNullableString(row.birth_date) ||
    !isAnimalStatus(row.status) ||
    !isNullableString(row.mother_id) ||
    !isNullableString(row.father_id)
  ) {
    throw new DataAccessError();
  }

  return {
    id: row.id,
    animal_code: row.animal_code,
    ear_tag_code: row.ear_tag_code,
    sex: row.sex,
    birth_date: row.birth_date,
    status: row.status,
    mother_id: row.mother_id,
    father_id: row.father_id,
  };
}

export interface ListLittersFilter {
  mother_id?: string;
  father_id?: string;
  /** Limite inferior inclusivo de `birth_date` (YYYY-MM-DD). */
  birth_from?: string;
  /** Limite superior inclusivo de `birth_date` (YYYY-MM-DD). */
  birth_to?: string;
  limit?: number;
  offset?: number;
}

export interface CreateLitterInput {
  mother_id: string;
  litter_code?: string | null;
  father_id?: string | null;
  birth_date?: string | null;
  total_born?: number | null;
  born_alive?: number | null;
  stillborn?: number | null;
  notes?: string | null;
}

/**
 * Campos editables de una camada. NO se admiten `id`, `created_at` ni
 * `updated_at`. `mother_id` solo se reemplaza por otra madre valida (no se
 * anula): la camada registrada por la API siempre tiene madre.
 */
export interface UpdateLitterInput {
  litter_code?: string | null;
  mother_id?: string;
  father_id?: string | null;
  birth_date?: string | null;
  total_born?: number | null;
  born_alive?: number | null;
  stillborn?: number | null;
  notes?: string | null;
}

export interface LitterRepository {
  list(filter: ListLittersFilter, accessToken: string): Promise<Litter[]>;
  findById(id: string, accessToken: string): Promise<Litter | null>;
  create(input: CreateLitterInput, accessToken: string): Promise<Litter>;
  update(
    id: string,
    input: UpdateLitterInput,
    accessToken: string,
  ): Promise<Litter | null>;
  /** Animal (madre/padre) o `null` si no existe o no es visible por RLS. */
  findAnimal(
    id: string,
    accessToken: string,
  ): Promise<LitterAnimalSnapshot | null>;
  /** Crias cuyo `litter_id` apunta a la camada. */
  listOffspring(
    litterId: string,
    accessToken: string,
  ): Promise<LitterOffspring[]>;
}

/**
 * Acceso a `public.litters`. Cada operacion crea un cliente PostgREST por
 * peticion con el JWT verificado, de modo que PostgreSQL aplica RLS con la
 * identidad del usuario (nunca `service_role`).
 *
 * No hay borrado fisico: no existe `delete` (decision D-09 y migracion 006).
 */
export function createSupabaseLitterRepository(
  createClient: PostgrestClientFactory,
): LitterRepository {
  return {
    async list(filter, accessToken) {
      const client = createClient(accessToken);
      let query = client.from<RawLitter>('litters').select(LITTER_COLUMNS);

      if (filter.mother_id) {
        query = query.eq('mother_id', filter.mother_id);
      }
      if (filter.father_id) {
        query = query.eq('father_id', filter.father_id);
      }
      if (filter.birth_from) {
        query = query.gte('birth_date', filter.birth_from);
      }
      if (filter.birth_to) {
        query = query.lte('birth_date', filter.birth_to);
      }

      const offset = filter.offset ?? 0;
      const limit = filter.limit ?? 100;

      const { data, error } = await query
        .order('birth_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) {
        throw toDataError(error);
      }

      return (data ?? []).map(mapLitter);
    },

    async findById(id, accessToken) {
      const client = createClient(accessToken);
      const { data, error } = await client
        .from<RawLitter>('litters')
        .select(LITTER_COLUMNS)
        .eq('id', id)
        .maybeSingle();

      if (error) {
        throw toDataError(error);
      }

      return data ? mapLitter(data) : null;
    },

    async create(input, accessToken) {
      const values: Record<string, unknown> = { mother_id: input.mother_id };
      if (input.litter_code !== undefined) {
        values.litter_code = input.litter_code;
      }
      if (input.father_id !== undefined) {
        values.father_id = input.father_id;
      }
      if (input.birth_date !== undefined) {
        values.birth_date = input.birth_date;
      }
      if (input.total_born !== undefined) {
        values.total_born = input.total_born;
      }
      if (input.born_alive !== undefined) {
        values.born_alive = input.born_alive;
      }
      if (input.stillborn !== undefined) {
        values.stillborn = input.stillborn;
      }
      if (input.notes !== undefined) {
        values.notes = input.notes;
      }

      const client = createClient(accessToken);
      const { data, error } = await client
        .from<RawLitter>('litters')
        .insert(values)
        .select(LITTER_COLUMNS)
        .single();

      if (error) {
        throw toDataError(error);
      }
      if (!data) {
        throw new DataAccessError();
      }

      return mapLitter(data);
    },

    async update(id, input, accessToken) {
      const values: Record<string, unknown> = {};
      if (input.litter_code !== undefined) {
        values.litter_code = input.litter_code;
      }
      if (input.mother_id !== undefined) {
        values.mother_id = input.mother_id;
      }
      if (input.father_id !== undefined) {
        values.father_id = input.father_id;
      }
      if (input.birth_date !== undefined) {
        values.birth_date = input.birth_date;
      }
      if (input.total_born !== undefined) {
        values.total_born = input.total_born;
      }
      if (input.born_alive !== undefined) {
        values.born_alive = input.born_alive;
      }
      if (input.stillborn !== undefined) {
        values.stillborn = input.stillborn;
      }
      if (input.notes !== undefined) {
        values.notes = input.notes;
      }

      const client = createClient(accessToken);
      const { data, error } = await client
        .from<RawLitter>('litters')
        .update(values)
        .eq('id', id)
        .select(LITTER_COLUMNS)
        .maybeSingle();

      if (error) {
        throw toDataError(error);
      }

      return data ? mapLitter(data) : null;
    },

    async findAnimal(id, accessToken) {
      const client = createClient(accessToken);
      const { data, error } = await client
        .from<{ id?: unknown; sex?: unknown }>('animals')
        .select('id, sex')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        throw toDataError(error);
      }
      if (!data) {
        return null;
      }
      if (typeof data.id !== 'string' || !isAnimalSex(data.sex)) {
        throw new DataAccessError();
      }

      return { id: data.id, sex: data.sex };
    },

    async listOffspring(litterId, accessToken) {
      const client = createClient(accessToken);
      const { data, error } = await client
        .from<RawOffspring>('animals')
        .select(
          'id, animal_code, ear_tag_code, sex, birth_date, status, ' +
            'mother_id, father_id',
        )
        .eq('litter_id', litterId)
        .order('animal_code', { ascending: true });

      if (error) {
        throw toDataError(error);
      }

      return (data ?? []).map(mapOffspring);
    },
  };
}

/** Repositorio por defecto (fail-closed): responde 503. */
export function createRejectingLitterRepository(): LitterRepository {
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
    async findAnimal() {
      throw new DataAccessError();
    },
    async listOffspring() {
      throw new DataAccessError();
    },
  };
}
