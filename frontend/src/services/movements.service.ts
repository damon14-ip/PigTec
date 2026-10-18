import type { OperationalRole } from '../config/roles';
import type { ApiClient } from '../lib/http';
import type { AnimalStatus } from './animals.service';

/**
 * Contrato EXACTO de la API de movimientos (`/movements` y
 * `/animals/:id/movements`). Los nombres coinciden con las columnas reales de
 * `public.animal_movements` y con los esquemas del backend
 * (`backend/src/modules/movements/movements.schemas.ts`); no se inventan campos
 * ni valores de enum.
 *
 * Reglas del backend respetadas aquí:
 * - El historial es INMUTABLE: no hay `PUT`/`PATCH`/`DELETE` (el backend no los
 *   expone y la base deniega UPDATE/DELETE por privilegios y por trigger).
 * - `recorded_by` se toma del JWT: NUNCA se envía desde el frontend.
 * - `from_pen_id` no se envía: lo completa el backend con la ubicación vigente
 *   del porcino (trazabilidad).
 * - `to_pen_id` nulo solo es coherente en salidas externas (`sale` y `transfer`
 *   sin destino); el resto de motivos exige corral destino.
 * - La ubicación y el estado del animal los DERIVA el trigger de PostgreSQL
 *   (`apply_animal_movement`); el frontend no los calcula ni los fija.
 */

/** Enum `public.movement_reason` (esquema inicial, sección 9). */
export const MOVEMENT_REASONS = [
  'weaning',
  'growth_stage',
  'fattening',
  'breeding',
  'health_isolation',
  'sale',
  'transfer',
  'management',
  'other',
] as const;
export type MovementReason = (typeof MOVEMENT_REASONS)[number];

/** Etiquetas en español (la API y la base usan valores en inglés). */
export const MOVEMENT_REASON_LABELS: Record<MovementReason, string> = {
  weaning: 'Destete',
  growth_stage: 'Cambio de etapa (crecimiento)',
  fattening: 'Engorde',
  breeding: 'Reproducción',
  health_isolation: 'Aislamiento sanitario',
  sale: 'Venta (salida de la granja)',
  transfer: 'Traslado',
  management: 'Manejo',
  other: 'Otro',
};

/** Indica si un valor desconocido es un motivo de movimiento válido. */
export function isMovementReason(value: unknown): value is MovementReason {
  return (
    typeof value === 'string' &&
    (MOVEMENT_REASONS as readonly string[]).includes(value)
  );
}

/**
 * Motivos que SIEMPRE implican una salida del animal de la granja
 * (`to_pen_id` nulo). `transfer` se trata aparte porque puede ser interno
 * (cambio de corral) o externo (salida), según tenga o no corral destino.
 * Espejo de `EXTERNAL_EXIT_REASONS` del backend.
 */
export const EXTERNAL_EXIT_REASONS = ['sale'] as const;

/**
 * Motivos internos que exigen un corral destino. Espejo de
 * `DESTINATION_REQUIRED_REASONS` del backend.
 */
export const DESTINATION_REQUIRED_REASONS = [
  'weaning',
  'growth_stage',
  'fattening',
  'breeding',
  'health_isolation',
  'management',
  'other',
] as const;

/**
 * Estados de `public.animals` que admiten movimientos ordinarios. Los estados
 * terminales (`sold`, `dead`, `transferred_out`) y la baja lógica (`inactive`)
 * quedan fuera. Espejo de `MOVEMENT_COMPATIBLE_ANIMAL_STATUSES` del backend.
 */
export const MOVEMENT_COMPATIBLE_ANIMAL_STATUSES = [
  'active',
  'missing',
] as const;

/**
 * Roles autorizados por tipo de movimiento. Espejo EXACTO de
 * `allowedMovementRoles` del backend (`movements.service.ts`) y de la política
 * RLS `movements_insert_by_reason` (migración 005).
 */
export const MOVEMENT_INTERNAL_ROLES = [
  'admin',
  'manager',
  'operator',
] as const;
export const MOVEMENT_ISOLATION_ROLES = [
  'admin',
  'manager',
  'operator',
  'veterinarian',
] as const;
export const MOVEMENT_EXTERNAL_ROLES = ['admin', 'manager'] as const;

/**
 * Roles que pueden registrar un movimiento según su motivo. `transfer` se
 * resuelve según tenga o no corral destino (interno vs. salida externa).
 */
export function allowedMovementRoles(
  reason: MovementReason,
  hasDestination: boolean,
): readonly OperationalRole[] {
  if ((EXTERNAL_EXIT_REASONS as readonly string[]).includes(reason)) {
    return MOVEMENT_EXTERNAL_ROLES;
  }
  if (reason === 'transfer') {
    return hasDestination ? MOVEMENT_INTERNAL_ROLES : MOVEMENT_EXTERNAL_ROLES;
  }
  if (reason === 'health_isolation') {
    return MOVEMENT_ISOLATION_ROLES;
  }
  return MOVEMENT_INTERNAL_ROLES;
}

/** Indica si un estado de porcino admite movimientos (regla del backend). */
export function admitsMovements(status: AnimalStatus): boolean {
  return (MOVEMENT_COMPATIBLE_ANIMAL_STATUSES as readonly string[]).includes(
    status,
  );
}

/**
 * Motivos que el rol puede registrar en alguna forma. Para `transfer` se une la
 * forma interna con destino (operator incluido) y la salida externa
 * (admin/manager); el formulario decide después si exige destino.
 */
export function movementReasonOptionsFor(
  role: OperationalRole,
): readonly MovementReason[] {
  return MOVEMENT_REASONS.filter(
    (reason) =>
      allowedMovementRoles(reason, true).includes(role) ||
      allowedMovementRoles(reason, false).includes(role),
  );
}

/** Indica si el rol puede registrar una salida externa (venta o traslado fuera). */
export function canRegisterExternalExit(role: OperationalRole): boolean {
  return (MOVEMENT_EXTERNAL_ROLES as readonly string[]).includes(role);
}

/**
 * Indica si el motivo puede quedar SIN corral destino. Solo las salidas
 * externas (`sale`) y `transfer` sin destino lo permiten.
 */
export function allowsNullDestination(reason: MovementReason): boolean {
  return (
    (EXTERNAL_EXIT_REASONS as readonly string[]).includes(reason) ||
    reason === 'transfer'
  );
}

/** Movimiento tal como lo devuelve la API (snake_case, columnas reales). */
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

/** Filtro de listado global (`GET /movements?...`). */
export interface ListMovementsFilter {
  animal_id?: string;
  from_pen_id?: string;
  to_pen_id?: string;
  /** Movimientos que tocan un corral (origen o destino). */
  pen_id?: string;
  reason?: MovementReason;
  recorded_by?: string;
  /** Límite inferior inclusivo de `moved_at` (ISO 8601 con zona). */
  moved_from?: string;
  /** Límite superior inclusivo de `moved_at` (ISO 8601 con zona). */
  moved_to?: string;
  /** 1..500 (por defecto 100 en el backend). */
  limit?: number;
  offset?: number;
}

/** Filtro del historial de un porcino (`GET /animals/:id/movements?...`). */
export interface ListAnimalMovementsFilter {
  reason?: MovementReason;
  moved_from?: string;
  moved_to?: string;
  limit?: number;
  offset?: number;
}

/**
 * Datos de registro de un movimiento. `from_pen_id` NO forma parte del contrato:
 * lo completa el backend con la ubicación vigente. `recorded_by` tampoco (lo
 * toma del JWT).
 */
export interface CreateMovementInput {
  animal_id: string;
  reason: MovementReason;
  /** `null` en salidas externas (`sale` y `transfer` sin destino). */
  to_pen_id: string | null;
  /** Opcional: si se omite, la base usa `NOW()`. */
  moved_at?: string;
  notes?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** Comprueba que una respuesta desconocida tiene la forma de un movimiento. */
export function isMovement(value: unknown): value is Movement {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.animal_id === 'string' &&
    isNullableString(value.from_pen_id) &&
    isNullableString(value.to_pen_id) &&
    typeof value.moved_at === 'string' &&
    isMovementReason(value.reason) &&
    isNullableString(value.notes) &&
    isNullableString(value.recorded_by) &&
    typeof value.created_at === 'string'
  );
}

function isMovementList(value: unknown): value is Movement[] {
  return Array.isArray(value) && value.every(isMovement);
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

/** Construye el `query string` del historial global con los filtros reales. */
function movementsQuery(filter: ListMovementsFilter | undefined): string {
  const params = new URLSearchParams();
  setIfPresent(params, 'animal_id', filter?.animal_id);
  setIfPresent(params, 'from_pen_id', filter?.from_pen_id);
  setIfPresent(params, 'to_pen_id', filter?.to_pen_id);
  setIfPresent(params, 'pen_id', filter?.pen_id);
  setIfPresent(params, 'reason', filter?.reason);
  setIfPresent(params, 'recorded_by', filter?.recorded_by);
  setIfPresent(params, 'moved_from', filter?.moved_from);
  setIfPresent(params, 'moved_to', filter?.moved_to);
  setIfPresent(params, 'limit', filter?.limit);
  setIfPresent(params, 'offset', filter?.offset);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** Construye el `query string` del historial de un porcino. */
function animalMovementsQuery(
  filter: ListAnimalMovementsFilter | undefined,
): string {
  const params = new URLSearchParams();
  setIfPresent(params, 'reason', filter?.reason);
  setIfPresent(params, 'moved_from', filter?.moved_from);
  setIfPresent(params, 'moved_to', filter?.moved_to);
  setIfPresent(params, 'limit', filter?.limit);
  setIfPresent(params, 'offset', filter?.offset);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * Lista movimientos (`GET /movements`). Solo lectura.
 *
 * Sin paginación total del backend: la API devuelve una página (`limit`/`offset`)
 * ordenada por `moved_at` descendente y no informa del total. La interfaz lo
 * refleja y no simula un contador completo.
 */
export async function listMovements(
  client: ApiClient,
  filter?: ListMovementsFilter,
  options?: { signal?: AbortSignal },
): Promise<Movement[]> {
  const response = await client.get<unknown>(
    `/movements${movementsQuery(filter)}`,
    options,
  );
  if (!isMovementList(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }
  return response;
}

/** Obtiene un movimiento por id (`GET /movements/:id`). Solo lectura. */
export async function getMovement(
  client: ApiClient,
  id: string,
  options?: { signal?: AbortSignal },
): Promise<Movement> {
  const response = await client.get<unknown>(`/movements/${id}`, options);
  if (!isMovement(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }
  return response;
}

/** Historial de un porcino (`GET /animals/:id/movements`). Solo lectura. */
export async function listAnimalMovements(
  client: ApiClient,
  animalId: string,
  filter?: ListAnimalMovementsFilter,
  options?: { signal?: AbortSignal },
): Promise<Movement[]> {
  const response = await client.get<unknown>(
    `/animals/${animalId}/movements${animalMovementsQuery(filter)}`,
    options,
  );
  if (!isMovementList(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }
  return response;
}

/**
 * Registra un movimiento (`POST /movements`). El backend valida el motivo, el
 * destino, el estado del porcino y el permiso por acción, y el trigger de la
 * base deriva la ubicación/estado/`exit_date` en la misma transacción.
 */
export async function createMovement(
  client: ApiClient,
  input: CreateMovementInput,
): Promise<Movement> {
  const response = await client.post<unknown>('/movements', input);
  if (!isMovement(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }
  return response;
}
