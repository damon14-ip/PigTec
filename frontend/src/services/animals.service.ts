import type { ApiClient } from '../lib/http';
import { isLocationStatus, type LocationStatus } from './location-status';

/**
 * Contrato EXACTO de la API de porcinos (`/animals`). Los nombres coinciden con
 * las columnas reales de `public.animals` y con los esquemas del backend
 * (`backend/src/modules/animals/animals.schemas.ts`); no se inventan campos ni
 * valores de enum.
 *
 * Reglas del backend respetadas aqui:
 * - `animal_code` NO se envia nunca: lo genera la base de datos (`PIG-000001`)
 *   y es inmutable.
 * - `status`, `current_pen_id` (al editar), `exit_date` y `created_by` no son
 *   editables por esta via. La ubicacion se cambia con movimientos y el estado
 *   terminal se deriva de operaciones con historial.
 * - El estado administrativo se cambia con `PATCH /animals/:id/status` y solo
 *   admite `active`, `inactive` y `missing`.
 */

/** Enum `public.animal_sex`. */
export const ANIMAL_SEXES = ['male', 'female', 'unknown'] as const;
export type AnimalSex = (typeof ANIMAL_SEXES)[number];

/** Enum `public.animal_status`. */
export const ANIMAL_STATUSES = [
  'active',
  'sold',
  'dead',
  'transferred_out',
  'missing',
  'inactive',
] as const;
export type AnimalStatus = (typeof ANIMAL_STATUSES)[number];

/**
 * Subconjunto de `animal_status` que la API puede fijar directamente (estados
 * administrativos). Los estados terminales (`sold`, `dead`, `transferred_out`)
 * se derivan de movimientos y eventos sanitarios: no se ofrecen en la interfaz.
 */
export const ADMINISTRATIVE_ANIMAL_STATUSES = [
  'active',
  'inactive',
  'missing',
] as const;
export type AdministrativeAnimalStatus =
  (typeof ADMINISTRATIVE_ANIMAL_STATUSES)[number];

/** Valores canonicos de `animals.origin` (`null` = "no registrado"). */
export const ANIMAL_ORIGINS = [
  'born_on_farm',
  'purchased',
  'transferred_in',
  'unknown',
] as const;
export type AnimalOrigin = (typeof ANIMAL_ORIGINS)[number];

/** Formato del codigo oficial generado por la base (`PIG-` + 6 digitos). */
export const ANIMAL_CODE_PATTERN = /^PIG-\d{6}$/;

/** Etiquetas en espanol (la API y la base usan valores en ingles). */
export const ANIMAL_SEX_LABELS: Record<AnimalSex, string> = {
  male: 'Macho',
  female: 'Hembra',
  unknown: 'Sin definir',
};

export const ANIMAL_STATUS_LABELS: Record<AnimalStatus, string> = {
  active: 'Activo',
  sold: 'Vendido',
  dead: 'Fallecido',
  transferred_out: 'Transferido',
  missing: 'No localizado',
  inactive: 'Inactivo',
};

export const ANIMAL_ORIGIN_LABELS: Record<AnimalOrigin, string> = {
  born_on_farm: 'Nacido en la granja',
  purchased: 'Comprado',
  transferred_in: 'Recibido por transferencia',
  unknown: 'Origen desconocido',
};

export const ADMINISTRATIVE_ANIMAL_STATUS_LABELS: Record<
  AdministrativeAnimalStatus,
  string
> = {
  active: 'Activo',
  inactive: 'Inactivo',
  missing: 'No localizado',
};

/** Porcino tal como lo devuelve la API (snake_case, columnas reales). */
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

/** Filtro de listado soportado por el backend (`GET /animals?...`). */
export interface ListAnimalsFilter {
  status?: AnimalStatus;
  sex?: AnimalSex;
  origin?: AnimalOrigin;
  breed?: string;
  current_pen_id?: string;
  /** Busqueda por `animal_code` o `ear_tag_code` (`ilike`). */
  q?: string;
}

/**
 * Datos de alta. `animal_code` NO forma parte del contrato (lo genera la base).
 * `status` siempre es `active` y `created_by` se toma del JWT.
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

/**
 * Campos editables de un porcino. Sin `animal_code`, `status`, `current_pen_id`,
 * `entry_date`, `exit_date` ni `created_by` (el backend los rechaza).
 */
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

/** Ubicacion actual (`GET /animals/:id/location`). */
export interface AnimalLocation {
  animal_id: string;
  current_pen_id: string | null;
  pen: AnimalLocationPen | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function isAnimalSex(value: unknown): value is AnimalSex {
  return (
    typeof value === 'string' &&
    (ANIMAL_SEXES as readonly string[]).includes(value)
  );
}

export function isAnimalStatus(value: unknown): value is AnimalStatus {
  return (
    typeof value === 'string' &&
    (ANIMAL_STATUSES as readonly string[]).includes(value)
  );
}

export function isAnimalOrigin(value: unknown): value is AnimalOrigin {
  return (
    typeof value === 'string' &&
    (ANIMAL_ORIGINS as readonly string[]).includes(value)
  );
}

/** Comprueba que una respuesta desconocida tiene la forma de un porcino. */
export function isAnimal(value: unknown): value is Animal {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.animal_code === 'string' &&
    isNullableString(value.ear_tag_code) &&
    isAnimalSex(value.sex) &&
    isNullableString(value.breed) &&
    isNullableString(value.birth_date) &&
    (value.origin === null || isAnimalOrigin(value.origin)) &&
    isNullableString(value.mother_id) &&
    isNullableString(value.father_id) &&
    isNullableString(value.litter_id) &&
    isNullableString(value.current_pen_id) &&
    isAnimalStatus(value.status) &&
    typeof value.entry_date === 'string' &&
    isNullableString(value.exit_date) &&
    isNullableString(value.notes) &&
    isNullableString(value.created_by) &&
    typeof value.created_at === 'string' &&
    typeof value.updated_at === 'string'
  );
}

function isAnimalList(value: unknown): value is Animal[] {
  return Array.isArray(value) && value.every(isAnimal);
}

function isAnimalLocationArea(value: unknown): value is AnimalLocationArea {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isLocationStatus(value.status)
  );
}

function isAnimalLocationPen(value: unknown): value is AnimalLocationPen {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.code === 'string' &&
    isNullableString(value.name) &&
    isLocationStatus(value.status) &&
    (value.area === null || isAnimalLocationArea(value.area))
  );
}

/** Comprueba que una respuesta desconocida es una ubicacion de porcino. */
export function isAnimalLocation(value: unknown): value is AnimalLocation {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.animal_id === 'string' &&
    isNullableString(value.current_pen_id) &&
    (value.pen === null || isAnimalLocationPen(value.pen))
  );
}

/** Construye el `query string` con los filtros soportados por el backend. */
function animalsQuery(filter: ListAnimalsFilter | undefined): string {
  const params = new URLSearchParams();
  if (filter?.status) {
    params.set('status', filter.status);
  }
  if (filter?.sex) {
    params.set('sex', filter.sex);
  }
  if (filter?.origin) {
    params.set('origin', filter.origin);
  }
  if (filter?.breed) {
    params.set('breed', filter.breed);
  }
  if (filter?.current_pen_id) {
    params.set('current_pen_id', filter.current_pen_id);
  }
  if (filter?.q) {
    params.set('q', filter.q);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** Lista porcinos (`GET /animals`). Solo lectura. */
export async function listAnimals(
  client: ApiClient,
  filter?: ListAnimalsFilter,
  options?: { signal?: AbortSignal },
): Promise<Animal[]> {
  const response = await client.get<unknown>(
    `/animals${animalsQuery(filter)}`,
    options,
  );
  if (!isAnimalList(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }
  return response;
}

/** Obtiene un porcino por id (`GET /animals/:id`). Solo lectura. */
export async function getAnimal(
  client: ApiClient,
  id: string,
  options?: { signal?: AbortSignal },
): Promise<Animal> {
  const response = await client.get<unknown>(`/animals/${id}`, options);
  if (!isAnimal(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }
  return response;
}

/** Ubicacion actual de un porcino (`GET /animals/:id/location`). Solo lectura. */
export async function getAnimalLocation(
  client: ApiClient,
  id: string,
  options?: { signal?: AbortSignal },
): Promise<AnimalLocation> {
  const response = await client.get<unknown>(
    `/animals/${id}/location`,
    options,
  );
  if (!isAnimalLocation(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }
  return response;
}

/** Registra un porcino (`POST /animals`, solo admin/manager). */
export async function createAnimal(
  client: ApiClient,
  input: CreateAnimalInput,
): Promise<Animal> {
  const response = await client.post<unknown>('/animals', input);
  if (!isAnimal(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }
  return response;
}

/** Edita los campos permitidos (`PATCH /animals/:id`, solo admin/manager). */
export async function updateAnimal(
  client: ApiClient,
  id: string,
  input: UpdateAnimalInput,
): Promise<Animal> {
  const response = await client.patch<unknown>(`/animals/${id}`, input);
  if (!isAnimal(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }
  return response;
}

/**
 * Cambia el estado administrativo (`PATCH /animals/:id/status`, solo
 * admin/manager). Solo admite `active`, `inactive` y `missing`.
 */
export async function updateAnimalStatus(
  client: ApiClient,
  id: string,
  status: AdministrativeAnimalStatus,
): Promise<Animal> {
  const response = await client.patch<unknown>(`/animals/${id}/status`, {
    status,
  });
  if (!isAnimal(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }
  return response;
}
