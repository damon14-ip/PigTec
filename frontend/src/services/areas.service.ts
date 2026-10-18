import type { ApiClient } from '../lib/http';
import { isLocationStatus, type LocationStatus } from './location-status';

/**
 * Contrato EXACTO de la API de areas (`/areas`). Los nombres coinciden con las
 * columnas reales de `public.areas`; no se inventan campos (p. ej. no existe un
 * `code` de area). La validacion se hace en tiempo de ejecucion para no
 * renderizar datos inesperados del servidor.
 */

export interface Area {
  id: string;
  name: string;
  description: string | null;
  status: LocationStatus;
  created_at: string;
  updated_at: string;
}

/** Filtro de listado soportado por el backend (`GET /areas?status=`). */
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** Comprueba que una respuesta desconocida tiene la forma de un area. */
export function isArea(value: unknown): value is Area {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isNullableString(value.description) &&
    isLocationStatus(value.status) &&
    typeof value.created_at === 'string' &&
    typeof value.updated_at === 'string'
  );
}

function isAreaList(value: unknown): value is Area[] {
  return Array.isArray(value) && value.every(isArea);
}

/** Construye el `query string` del filtro soportado por el backend. */
function areasQuery(filter: ListAreasFilter | undefined): string {
  const params = new URLSearchParams();
  if (filter?.status) {
    params.set('status', filter.status);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** Lista areas (`GET /areas`). Solo lectura. */
export async function listAreas(
  client: ApiClient,
  filter?: ListAreasFilter,
  options?: { signal?: AbortSignal },
): Promise<Area[]> {
  const response = await client.get<unknown>(
    `/areas${areasQuery(filter)}`,
    options,
  );
  if (!isAreaList(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }
  return response;
}

/** Registra un area (`POST /areas`, solo admin/manager). */
export async function createArea(
  client: ApiClient,
  input: CreateAreaInput,
): Promise<Area> {
  const response = await client.post<unknown>('/areas', input);
  if (!isArea(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }
  return response;
}

/** Edita un area (`PATCH /areas/:id`, solo admin/manager). */
export async function updateArea(
  client: ApiClient,
  id: string,
  input: UpdateAreaInput,
): Promise<Area> {
  const response = await client.patch<unknown>(`/areas/${id}`, input);
  if (!isArea(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }
  return response;
}

/**
 * Baja LOGICA de un area (`DELETE /areas/:id` -> `status='inactive'`). No borra
 * la fila: los corrales y el historial quedan intactos.
 */
export async function deactivateArea(
  client: ApiClient,
  id: string,
): Promise<Area> {
  const response = await client.delete<unknown>(`/areas/${id}`);
  if (!isArea(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }
  return response;
}
