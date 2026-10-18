import type { OperationalRole } from '../config/roles';
import type { ApiClient } from '../lib/http';
import { isAnimalSex, isAnimalStatus, type AnimalSex, type AnimalStatus } from './animals.service';

/**
 * Contrato EXACTO de la API de camadas (`/litters`). Los nombres coinciden con
 * las columnas reales de `public.litters` y con los esquemas del backend
 * (`backend/src/modules/litters/litters.schemas.ts`); no se inventan campos ni
 * valores.
 *
 * Reglas del backend respetadas aquí:
 * - La camada NO se elimina (decisión D-09; el backend no expone `DELETE` y la
 *   migración 006 no concede privilegio ni política de borrado).
 * - `mother_id` es obligatorio al registrar y debe ser una hembra; `father_id`
 *   es opcional y, si se indica, debe ser macho. La validación definitiva la
 *   aplica el backend.
 * - `litter_code` es opcional; su unicidad la garantiza la base.
 * - Las cantidades son enteros no negativos y `born_alive`/`stillborn` no pueden
 *   superar `total_born` (regla reforzada por el backend).
 * - Las crías (`GET /litters/:id/offspring`) son porcinos cuyo `litter_id` apunta
 *   a la camada; esta API NO crea porcinos a partir de una camada.
 */

/** Roles que pueden registrar y editar camadas (espejo del backend y RLS 006). */
export const LITTER_WRITE_ROLES = ['admin', 'manager', 'operator'] as const;

export type LitterWriteRole = (typeof LITTER_WRITE_ROLES)[number];

/** Indica si un rol operativo puede registrar o editar camadas. */
export function canWriteLitters(role: OperationalRole): boolean {
  return (LITTER_WRITE_ROLES as readonly string[]).includes(role);
}

/** Camada tal como la devuelve la API (snake_case, columnas reales). */
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

/**
 * Cría (lechón) asociada a una camada: subconjunto estable de `public.animals`
 * cuyo `litter_id` apunta a la camada. El backend no expone la fila completa.
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

/** Filtro de listado soportado por el backend (`GET /litters?...`). */
export interface ListLittersFilter {
  mother_id?: string;
  father_id?: string;
  /** Límite inferior inclusivo de `birth_date` (`YYYY-MM-DD`). */
  birth_from?: string;
  /** Límite superior inclusivo de `birth_date` (`YYYY-MM-DD`). */
  birth_to?: string;
  /** 1..500 (por defecto 100 en el backend). */
  limit?: number;
  offset?: number;
}

/**
 * Datos de registro de una camada. `mother_id` es obligatorio. Las cantidades
 * vacías se OMITEN (el esquema de alta no admite `null`); `father_id`,
 * `birth_date`, `litter_code` y `notes` sí admiten `null`.
 */
export interface CreateLitterInput {
  mother_id: string;
  litter_code?: string | null;
  father_id?: string | null;
  birth_date?: string | null;
  total_born?: number;
  born_alive?: number;
  stillborn?: number;
  notes?: string | null;
}

/**
 * Campos editables de una camada. `mother_id` solo se reemplaza por otra madre
 * válida (no se anula); `father_id` sí puede anularse. El esquema de
 * actualización exige al menos un campo.
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableInt(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value));
}

/** Comprueba que una respuesta desconocida tiene la forma de una camada. */
export function isLitter(value: unknown): value is Litter {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    isNullableString(value.litter_code) &&
    isNullableString(value.mother_id) &&
    isNullableString(value.father_id) &&
    isNullableString(value.birth_date) &&
    isNullableInt(value.total_born) &&
    isNullableInt(value.born_alive) &&
    isNullableInt(value.stillborn) &&
    isNullableString(value.notes) &&
    typeof value.created_at === 'string' &&
    typeof value.updated_at === 'string'
  );
}

function isLitterList(value: unknown): value is Litter[] {
  return Array.isArray(value) && value.every(isLitter);
}

/** Comprueba que una respuesta desconocida tiene la forma de una cría. */
export function isLitterOffspring(value: unknown): value is LitterOffspring {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.animal_code === 'string' &&
    isNullableString(value.ear_tag_code) &&
    isAnimalSex(value.sex) &&
    isNullableString(value.birth_date) &&
    isAnimalStatus(value.status) &&
    isNullableString(value.mother_id) &&
    isNullableString(value.father_id)
  );
}

function isLitterOffspringList(value: unknown): value is LitterOffspring[] {
  return Array.isArray(value) && value.every(isLitterOffspring);
}

/** Añade un parámetro solo cuando tiene valor (filtros opcionales). */
function setIfPresent(
  params: URLSearchParams,
  key: string,
  value: string | number | undefined,
): void {
  if (value !== undefined) {
    params.set(key, String(value));
  }
}

/** Construye el `query string` del listado con los filtros reales. */
function littersQuery(filter: ListLittersFilter | undefined): string {
  const params = new URLSearchParams();
  setIfPresent(params, 'mother_id', filter?.mother_id);
  setIfPresent(params, 'father_id', filter?.father_id);
  setIfPresent(params, 'birth_from', filter?.birth_from);
  setIfPresent(params, 'birth_to', filter?.birth_to);
  setIfPresent(params, 'limit', filter?.limit);
  setIfPresent(params, 'offset', filter?.offset);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * Lista camadas (`GET /litters`). Solo lectura. El backend ordena por
 * `birth_date` descendente y luego por `created_at` descendente, y NO informa
 * del total: la interfaz pagina con `limit`/`offset` sin simular un contador.
 */
export async function listLitters(
  client: ApiClient,
  filter?: ListLittersFilter,
  options?: { signal?: AbortSignal },
): Promise<Litter[]> {
  const response = await client.get<unknown>(
    `/litters${littersQuery(filter)}`,
    options,
  );
  if (!isLitterList(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }
  return response;
}

/** Obtiene una camada por id (`GET /litters/:id`). Solo lectura. */
export async function getLitter(
  client: ApiClient,
  id: string,
  options?: { signal?: AbortSignal },
): Promise<Litter> {
  const response = await client.get<unknown>(`/litters/${id}`, options);
  if (!isLitter(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }
  return response;
}

/**
 * Consulta la descendencia de una camada (`GET /litters/:id/offspring`). Solo
 * lectura. Devuelve las crías cuyo `litter_id` apunta a la camada.
 */
export async function listLitterOffspring(
  client: ApiClient,
  litterId: string,
  options?: { signal?: AbortSignal },
): Promise<LitterOffspring[]> {
  const response = await client.get<unknown>(
    `/litters/${litterId}/offspring`,
    options,
  );
  if (!isLitterOffspringList(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }
  return response;
}

/**
 * Registra una camada (`POST /litters`). El backend valida que la madre exista
 * y sea hembra, que el padre (si se indica) sea macho y la coherencia de las
 * cantidades. No crea porcinos individuales.
 */
export async function createLitter(
  client: ApiClient,
  input: CreateLitterInput,
): Promise<Litter> {
  const response = await client.post<unknown>('/litters', input);
  if (!isLitter(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }
  return response;
}

/** Edita los campos permitidos de una camada (`PATCH /litters/:id`). */
export async function updateLitter(
  client: ApiClient,
  id: string,
  input: UpdateLitterInput,
): Promise<Litter> {
  const response = await client.patch<unknown>(`/litters/${id}`, input);
  if (!isLitter(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }
  return response;
}
