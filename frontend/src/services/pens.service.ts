import type { ApiClient } from '../lib/http';
import { isLocationStatus, type LocationStatus } from './location-status';

/**
 * Contrato EXACTO de la API de corrales (`/pens`). Los nombres coinciden con las
 * columnas reales de `public.pens`; se valida en tiempo de ejecucion antes de
 * mostrar los datos.
 *
 * Limitacion del backend respetada aqui: al EDITAR un corral no se puede
 * reasignar su area (`area_id` no se acepta en `PATCH`). El estado se cambia
 * solo con la baja logica (`DELETE`), que no borra la fila.
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

/** Filtro de listado soportado por el backend (`GET /pens?area_id=&status=`). */
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

export interface UpdatePenInput {
  code?: string;
  name?: string | null;
  capacity?: number | null;
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

/** Comprueba que una respuesta desconocida tiene la forma de un corral. */
export function isPen(value: unknown): value is Pen {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.area_id === 'string' &&
    typeof value.code === 'string' &&
    isNullableString(value.name) &&
    isNullableInt(value.capacity) &&
    isNullableString(value.notes) &&
    isLocationStatus(value.status) &&
    typeof value.created_at === 'string' &&
    typeof value.updated_at === 'string'
  );
}

function isPenList(value: unknown): value is Pen[] {
  return Array.isArray(value) && value.every(isPen);
}

/** Construye el `query string` con los filtros soportados por el backend. */
function pensQuery(filter: ListPensFilter | undefined): string {
  const params = new URLSearchParams();
  if (filter?.area_id) {
    params.set('area_id', filter.area_id);
  }
  if (filter?.status) {
    params.set('status', filter.status);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** Lista corrales (`GET /pens`). Solo lectura. */
export async function listPens(
  client: ApiClient,
  filter?: ListPensFilter,
  options?: { signal?: AbortSignal },
): Promise<Pen[]> {
  const response = await client.get<unknown>(
    `/pens${pensQuery(filter)}`,
    options,
  );
  if (!isPenList(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }
  return response;
}

/** Registra un corral asociado a un area (`POST /pens`, solo admin/manager). */
export async function createPen(
  client: ApiClient,
  input: CreatePenInput,
): Promise<Pen> {
  const response = await client.post<unknown>('/pens', input);
  if (!isPen(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }
  return response;
}

/** Edita un corral (`PATCH /pens/:id`, solo admin/manager). */
export async function updatePen(
  client: ApiClient,
  id: string,
  input: UpdatePenInput,
): Promise<Pen> {
  const response = await client.patch<unknown>(`/pens/${id}`, input);
  if (!isPen(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }
  return response;
}

/**
 * Baja LOGICA de un corral (`DELETE /pens/:id` -> `status='inactive'`). No borra
 * la fila: los animales y el historial de movimientos quedan intactos.
 */
export async function deactivatePen(
  client: ApiClient,
  id: string,
): Promise<Pen> {
  const response = await client.delete<unknown>(`/pens/${id}`);
  if (!isPen(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }
  return response;
}
