import {
  isAnimalOrigin,
  isAnimalSex,
  isAnimalStatus,
  type AnimalOrigin,
  type AnimalSex,
  type AnimalStatus,
} from '../common/animal.js';
import { DataAccessError, toDataError } from '../common/data-errors.js';
import { isLocationStatus, type LocationStatus } from '../common/location.js';
import type { PostgrestClientFactory } from '../common/postgrest.js';

/**
 * Porcino tal como se expone en la API. Los nombres coinciden con las columnas
 * reales de `public.animals` (snake_case).
 */
export interface Animal {
  id: string;
  animal_code: string;
  ear_tag_code: string | null;
  sex: AnimalSex;
  breed: string | null;
  birth_date: string | null;
  origin: AnimalOrigin | null;
  mother_id: string | null;
  father_id: string | null;
  litter_id: string | null;
  current_pen_id: string | null;
  status: AnimalStatus;
  entry_date: string;
  exit_date: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Fila cruda devuelta por PostgREST. */
interface RawAnimal {
  id?: unknown;
  animal_code?: unknown;
  ear_tag_code?: unknown;
  sex?: unknown;
  breed?: unknown;
  birth_date?: unknown;
  origin?: unknown;
  mother_id?: unknown;
  father_id?: unknown;
  litter_id?: unknown;
  current_pen_id?: unknown;
  status?: unknown;
  entry_date?: unknown;
  exit_date?: unknown;
  notes?: unknown;
  created_by?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

export const ANIMAL_COLUMNS =
  'id, animal_code, ear_tag_code, sex, breed, birth_date, origin, ' +
  'mother_id, father_id, litter_id, current_pen_id, status, ' +
  'entry_date, exit_date, notes, created_by, created_at, updated_at';

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** Valida y normaliza una fila; cualquier dato inesperado es un fallo (503). */
function mapAnimal(row: RawAnimal): Animal {
  if (
    typeof row.id !== 'string' ||
    typeof row.animal_code !== 'string' ||
    !isNullableString(row.ear_tag_code) ||
    !isAnimalSex(row.sex) ||
    !isNullableString(row.breed) ||
    !isNullableString(row.birth_date) ||
    !(row.origin === null || isAnimalOrigin(row.origin)) ||
    !isNullableString(row.mother_id) ||
    !isNullableString(row.father_id) ||
    !isNullableString(row.litter_id) ||
    !isNullableString(row.current_pen_id) ||
    !isAnimalStatus(row.status) ||
    typeof row.entry_date !== 'string' ||
    !isNullableString(row.exit_date) ||
    !isNullableString(row.notes) ||
    !isNullableString(row.created_by) ||
    typeof row.created_at !== 'string' ||
    typeof row.updated_at !== 'string'
  ) {
    throw new DataAccessError();
  }

  return {
    id: row.id,
    animal_code: row.animal_code,
    ear_tag_code: row.ear_tag_code,
    sex: row.sex,
    breed: row.breed,
    birth_date: row.birth_date,
    origin: row.origin,
    mother_id: row.mother_id,
    father_id: row.father_id,
    litter_id: row.litter_id,
    current_pen_id: row.current_pen_id,
    status: row.status,
    entry_date: row.entry_date,
    exit_date: row.exit_date,
    notes: row.notes,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface ListAnimalsFilter {
  status?: AnimalStatus;
  sex?: AnimalSex;
  origin?: AnimalOrigin;
  breed?: string;
  current_pen_id?: string;
  q?: string;
}

/**
 * Datos de alta de un porcino. `animal_code` NO forma parte del contrato: lo
 * genera la base de datos (secuencia `public.animals_animal_code_seq`, formato
 * `PIG-000001`, migracion 008). El backend nunca lo envia.
 */
export interface CreateAnimalInput {
  ear_tag_code?: string | null;
  sex?: AnimalSex;
  breed?: string | null;
  birth_date?: string | null;
  origin?: AnimalOrigin | null;
  mother_id?: string | null;
  father_id?: string | null;
  litter_id?: string | null;
  current_pen_id?: string | null;
  entry_date?: string;
  notes?: string | null;
}

/** Campos editables (sin `animal_code`, `status`, `current_pen_id` ni fechas de ingreso/salida). */
export interface UpdateAnimalInput {
  ear_tag_code?: string | null;
  sex?: AnimalSex;
  breed?: string | null;
  birth_date?: string | null;
  origin?: AnimalOrigin | null;
  mother_id?: string | null;
  father_id?: string | null;
  litter_id?: string | null;
  notes?: string | null;
}

export interface AnimalLocationArea {
  id: string;
  name: string;
  status: LocationStatus;
}

export interface AnimalLocationPen {
  id: string;
  code: string;
  name: string | null;
  status: LocationStatus;
  area: AnimalLocationArea | null;
}

/**
 * Ubicacion actual de un porcino. `current_pen_id` nulo (o `pen` nulo) indica
 * que el animal no tiene corral asignado (p. ej. tras una salida).
 */
export interface AnimalLocation {
  animal_id: string;
  current_pen_id: string | null;
  pen: AnimalLocationPen | null;
}

export interface AnimalRepository {
  list(filter: ListAnimalsFilter, accessToken: string): Promise<Animal[]>;
  findById(id: string, accessToken: string): Promise<Animal | null>;
  /**
   * Busca por codigo oficial exacto (`animal_code`, formato `PIG-000001`). La
   * busqueda es por igualdad, no por patron: no permite enumerar por prefijos.
   */
  findByCode(code: string, accessToken: string): Promise<Animal | null>;
  /**
   * Cuenta los porcinos con un `status` dado SIN descargar las filas (conteo
   * exacto de PostgREST). Se usa para el resumen del asistente sin traer el
   * inventario completo.
   */
  countByStatus(status: AnimalStatus, accessToken: string): Promise<number>;
  create(
    input: CreateAnimalInput,
    createdBy: string,
    accessToken: string,
  ): Promise<Animal>;
  update(
    id: string,
    input: UpdateAnimalInput,
    accessToken: string,
  ): Promise<Animal | null>;
  setStatus(
    id: string,
    status: AnimalStatus,
    accessToken: string,
  ): Promise<Animal | null>;
  findLocation(
    id: string,
    accessToken: string,
  ): Promise<AnimalLocation | null>;
}

/**
 * Acceso a `public.animals`. Cada operacion crea un cliente PostgREST por
 * peticion con el JWT verificado, de modo que PostgreSQL aplica RLS con la
 * identidad del usuario (nunca `service_role`).
 */
export function createSupabaseAnimalRepository(
  createClient: PostgrestClientFactory,
): AnimalRepository {
  return {
    async list(filter, accessToken) {
      const client = createClient(accessToken);
      let query = client.from<RawAnimal>('animals').select(ANIMAL_COLUMNS);

      if (filter.status) {
        query = query.eq('status', filter.status);
      }
      if (filter.sex) {
        query = query.eq('sex', filter.sex);
      }
      if (filter.origin) {
        query = query.eq('origin', filter.origin);
      }
      if (filter.breed) {
        query = query.eq('breed', filter.breed);
      }
      if (filter.current_pen_id) {
        query = query.eq('current_pen_id', filter.current_pen_id);
      }
      if (filter.q) {
        const pattern = `%${filter.q}%`;
        query = query.or(
          `animal_code.ilike.${pattern},ear_tag_code.ilike.${pattern}`,
        );
      }

      const { data, error } = await query.order('animal_code', {
        ascending: true,
      });
      if (error) {
        throw toDataError(error);
      }

      return (data ?? []).map(mapAnimal);
    },

    async findById(id, accessToken) {
      const client = createClient(accessToken);
      const { data, error } = await client
        .from<RawAnimal>('animals')
        .select(ANIMAL_COLUMNS)
        .eq('id', id)
        .maybeSingle();

      if (error) {
        throw toDataError(error);
      }

      return data ? mapAnimal(data) : null;
    },

    async findByCode(code, accessToken) {
      const client = createClient(accessToken);
      const { data, error } = await client
        .from<RawAnimal>('animals')
        .select(ANIMAL_COLUMNS)
        .eq('animal_code', code)
        .maybeSingle();

      if (error) {
        throw toDataError(error);
      }

      return data ? mapAnimal(data) : null;
    },

    async countByStatus(status, accessToken) {
      const client = createClient(accessToken);
      const { count, error } = await client
        .from<{ id?: unknown }>('animals')
        .select('id', { count: 'exact', head: true })
        .eq('status', status);

      if (error) {
        throw toDataError(error);
      }
      // Si el conteo no viene como numero, la respuesta no es la esperada: se
      // trata como fallo de datos (503) y nunca como cero, para no inventar un
      // resumen incorrecto.
      if (typeof count !== 'number') {
        throw new DataAccessError();
      }

      return count;
    },

    async create(input, createdBy, accessToken) {
      // `animal_code` lo genera la base (trigger + secuencia): aqui nunca se
      // envia, para que el codigo sea unico y no elegido por el cliente.
      const values: Record<string, unknown> = {
        created_by: createdBy,
      };
      if (input.ear_tag_code !== undefined) {
        values.ear_tag_code = input.ear_tag_code;
      }
      if (input.sex !== undefined) {
        values.sex = input.sex;
      }
      if (input.breed !== undefined) {
        values.breed = input.breed;
      }
      if (input.birth_date !== undefined) {
        values.birth_date = input.birth_date;
      }
      if (input.origin !== undefined) {
        values.origin = input.origin;
      }
      if (input.mother_id !== undefined) {
        values.mother_id = input.mother_id;
      }
      if (input.father_id !== undefined) {
        values.father_id = input.father_id;
      }
      if (input.litter_id !== undefined) {
        values.litter_id = input.litter_id;
      }
      if (input.current_pen_id !== undefined) {
        values.current_pen_id = input.current_pen_id;
      }
      if (input.entry_date !== undefined) {
        values.entry_date = input.entry_date;
      }
      if (input.notes !== undefined) {
        values.notes = input.notes;
      }

      const client = createClient(accessToken);
      const { data, error } = await client
        .from<RawAnimal>('animals')
        .insert(values)
        .select(ANIMAL_COLUMNS)
        .single();

      if (error) {
        throw toDataError(error);
      }
      if (!data) {
        throw new DataAccessError();
      }

      return mapAnimal(data);
    },

    async update(id, input, accessToken) {
      const values: Record<string, unknown> = {};
      if (input.ear_tag_code !== undefined) {
        values.ear_tag_code = input.ear_tag_code;
      }
      if (input.sex !== undefined) {
        values.sex = input.sex;
      }
      if (input.breed !== undefined) {
        values.breed = input.breed;
      }
      if (input.birth_date !== undefined) {
        values.birth_date = input.birth_date;
      }
      if (input.origin !== undefined) {
        values.origin = input.origin;
      }
      if (input.mother_id !== undefined) {
        values.mother_id = input.mother_id;
      }
      if (input.father_id !== undefined) {
        values.father_id = input.father_id;
      }
      if (input.litter_id !== undefined) {
        values.litter_id = input.litter_id;
      }
      if (input.notes !== undefined) {
        values.notes = input.notes;
      }

      const client = createClient(accessToken);
      const { data, error } = await client
        .from<RawAnimal>('animals')
        .update(values)
        .eq('id', id)
        .select(ANIMAL_COLUMNS)
        .maybeSingle();

      if (error) {
        throw toDataError(error);
      }

      return data ? mapAnimal(data) : null;
    },

    async setStatus(id, status, accessToken) {
      const client = createClient(accessToken);
      const { data, error } = await client
        .from<RawAnimal>('animals')
        .update({ status })
        .eq('id', id)
        .select(ANIMAL_COLUMNS)
        .maybeSingle();

      if (error) {
        throw toDataError(error);
      }

      return data ? mapAnimal(data) : null;
    },

    async findLocation(id, accessToken) {
      const client = createClient(accessToken);

      const animal = await client
        .from<{ id?: unknown; current_pen_id?: unknown }>('animals')
        .select('id, current_pen_id')
        .eq('id', id)
        .maybeSingle();

      if (animal.error) {
        throw toDataError(animal.error);
      }
      if (!animal.data) {
        return null;
      }
      if (
        typeof animal.data.id !== 'string' ||
        !isNullableString(animal.data.current_pen_id)
      ) {
        throw new DataAccessError();
      }

      const penId = animal.data.current_pen_id;
      if (!penId) {
        return { animal_id: animal.data.id, current_pen_id: null, pen: null };
      }

      const pen = await client
        .from<{
          id?: unknown;
          area_id?: unknown;
          code?: unknown;
          name?: unknown;
          status?: unknown;
        }>('pens')
        .select('id, area_id, code, name, status')
        .eq('id', penId)
        .maybeSingle();

      if (pen.error) {
        throw toDataError(pen.error);
      }
      if (!pen.data) {
        return { animal_id: animal.data.id, current_pen_id: penId, pen: null };
      }
      if (
        typeof pen.data.id !== 'string' ||
        typeof pen.data.area_id !== 'string' ||
        typeof pen.data.code !== 'string' ||
        !isNullableString(pen.data.name) ||
        !isLocationStatus(pen.data.status)
      ) {
        throw new DataAccessError();
      }

      const area = await client
        .from<{ id?: unknown; name?: unknown; status?: unknown }>('areas')
        .select('id, name, status')
        .eq('id', pen.data.area_id)
        .maybeSingle();

      if (area.error) {
        throw toDataError(area.error);
      }

      let areaInfo: AnimalLocationArea | null = null;
      if (area.data) {
        if (
          typeof area.data.id !== 'string' ||
          typeof area.data.name !== 'string' ||
          !isLocationStatus(area.data.status)
        ) {
          throw new DataAccessError();
        }
        areaInfo = {
          id: area.data.id,
          name: area.data.name,
          status: area.data.status,
        };
      }

      return {
        animal_id: animal.data.id,
        current_pen_id: penId,
        pen: {
          id: pen.data.id,
          code: pen.data.code,
          name: pen.data.name,
          status: pen.data.status,
          area: areaInfo,
        },
      };
    },
  };
}

/** Repositorio por defecto (fail-closed): responde 503. */
export function createRejectingAnimalRepository(): AnimalRepository {
  return {
    async list() {
      throw new DataAccessError();
    },
    async findById() {
      throw new DataAccessError();
    },
    async findByCode() {
      throw new DataAccessError();
    },
    async countByStatus() {
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
    async findLocation() {
      throw new DataAccessError();
    },
  };
}
