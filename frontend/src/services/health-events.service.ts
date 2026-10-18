import type { OperationalRole } from '../config/roles';
import type { ApiClient } from '../lib/http';
import type { AnimalStatus } from './animals.service';

/**
 * Contrato EXACTO de la API de eventos sanitarios (`/health-events` y
 * `/animals/:id/health-events`). Los nombres coinciden con las columnas reales
 * de `public.health_events` y con los esquemas del backend
 * (`backend/src/modules/health/health-events.schemas.ts`).
 *
 * Reglas del backend respetadas aquí:
 * - El historial es INMUTABLE: no hay `PATCH`/`PUT`/`DELETE` (el backend no los
 *   expone y la migración 007 no concede privilegio UPDATE/DELETE). La interfaz
 *   no ofrece edición ni borrado.
 * - `recorded_by` NO se envía: lo toma el backend del JWT.
 * - El autor por TIPO de evento gobierna quién puede registrarlo (matriz 5.1):
 *   observaciones/síntomas los registra cualquier rol operativo; los eventos
 *   clínicos, solo el veterinario; la mortalidad, admin/manager/veterinario.
 * - `details` es un objeto JSON de claves libres; el esquema del proyecto no fija
 *   claves concretas, por lo que la interfaz no lo edita (el backend lo deja en
 *   `{}` por defecto).
 * - La mortalidad la DERIVA el trigger `apply_mortality_event` de PostgreSQL: el
 *   frontend nunca calcula ni fija el estado del porcino.
 */

/** Enum `public.health_event_type` (esquema inicial, sección 10). */
export const HEALTH_EVENT_TYPES = [
  'observation',
  'symptom_report',
  'documented_diagnosis',
  'treatment',
  'vaccination',
  'deworming',
  'mortality',
  'recovery',
  'other',
] as const;
export type HealthEventType = (typeof HEALTH_EVENT_TYPES)[number];

/** Etiquetas en español (la API y la base usan valores en inglés). */
export const HEALTH_EVENT_TYPE_LABELS: Record<HealthEventType, string> = {
  observation: 'Observación',
  symptom_report: 'Reporte de síntomas',
  documented_diagnosis: 'Diagnóstico documentado',
  treatment: 'Tratamiento',
  vaccination: 'Vacunación',
  deworming: 'Desparasitación',
  mortality: 'Mortalidad',
  recovery: 'Recuperación',
  other: 'Otro',
};

/**
 * Eventos de observación/captura cotidiana: los registra cualquier rol
 * operativo. `other` se agrupa aquí por ser un evento genérico sin facultad
 * clínica implícita. Espejo de `OBSERVATION_EVENT_TYPES` del backend.
 */
export const OBSERVATION_EVENT_TYPES = [
  'observation',
  'symptom_report',
  'other',
] as const;

/**
 * Eventos clínicos especializados (diagnóstico, tratamiento, vacunación,
 * desparasitación y recuperación). Hoy SOLO el veterinario los registra
 * (política clínica pendiente para admin/manager). Espejo de
 * `CLINICAL_EVENT_TYPES` del backend.
 */
export const CLINICAL_EVENT_TYPES = [
  'documented_diagnosis',
  'treatment',
  'vaccination',
  'deworming',
  'recovery',
] as const;

/** Evento de mortalidad: deriva el estado del porcino (trigger de la base). */
export const MORTALITY_EVENT_TYPE = 'mortality' as const;

/**
 * Estados de `public.animals` que admiten NUEVOS eventos sanitarios. Un porcino
 * vendido, muerto, transferido al exterior o dado de baja no admite operaciones
 * con historial. Espejo de `HEALTH_EVENT_COMPATIBLE_ANIMAL_STATUSES`.
 */
export const HEALTH_EVENT_COMPATIBLE_ANIMAL_STATUSES = [
  'active',
  'missing',
] as const;

/** Roles autorizados a registrar un evento según su tipo (matriz 5.1). */
const OPERATIONAL_EVENT_ROLES: readonly OperationalRole[] = [
  'admin',
  'manager',
  'operator',
  'veterinarian',
];
const CLINICAL_EVENT_ROLES: readonly OperationalRole[] = ['veterinarian'];
const MORTALITY_EVENT_ROLES: readonly OperationalRole[] = [
  'admin',
  'manager',
  'veterinarian',
];

/** Indica si un valor desconocido es un tipo de evento sanitario valido. */
export function isHealthEventType(value: unknown): value is HealthEventType {
  return (
    typeof value === 'string' &&
    (HEALTH_EVENT_TYPES as readonly string[]).includes(value)
  );
}

/** Roles que pueden registrar un evento del tipo indicado. */
export function allowedHealthEventRoles(
  eventType: HealthEventType,
): readonly OperationalRole[] {
  if ((CLINICAL_EVENT_TYPES as readonly string[]).includes(eventType)) {
    return CLINICAL_EVENT_ROLES;
  }
  if (eventType === MORTALITY_EVENT_TYPE) {
    return MORTALITY_EVENT_ROLES;
  }
  if ((OBSERVATION_EVENT_TYPES as readonly string[]).includes(eventType)) {
    return OPERATIONAL_EVENT_ROLES;
  }
  // Tipo desconocido: no se autoriza (fail-closed).
  return [];
}

/** Indica si el rol puede registrar un evento del tipo indicado. */
export function canRegisterHealthEvent(
  role: OperationalRole,
  eventType: HealthEventType,
): boolean {
  return allowedHealthEventRoles(eventType).includes(role);
}

/** Tipos de evento que el rol puede registrar (para el formulario). */
export function healthEventTypeOptionsFor(
  role: OperationalRole,
): readonly HealthEventType[] {
  return HEALTH_EVENT_TYPES.filter((eventType) =>
    canRegisterHealthEvent(role, eventType),
  );
}

/** Indica si un estado de porcino admite eventos sanitarios (regla del backend). */
export function admitsHealthEvents(status: AnimalStatus): boolean {
  return (HEALTH_EVENT_COMPATIBLE_ANIMAL_STATUSES as readonly string[]).includes(
    status,
  );
}

/** Evento sanitario tal como lo devuelve la API (snake_case, columnas reales). */
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

/** Filtro del historial sanitario global (`GET /health-events?...`). */
export interface ListHealthEventsFilter {
  animal_id?: string;
  event_type?: HealthEventType;
  recorded_by?: string;
  /** Límite inferior inclusivo de `occurred_at` (ISO 8601 con zona). */
  occurred_from?: string;
  /** Límite superior inclusivo de `occurred_at` (ISO 8601 con zona). */
  occurred_to?: string;
  /** 1..500 (por defecto 100 en el backend). */
  limit?: number;
  offset?: number;
}

/** Filtro del historial de un porcino (`GET /animals/:id/health-events?...`). */
export interface ListAnimalHealthEventsFilter {
  event_type?: HealthEventType;
  occurred_from?: string;
  occurred_to?: string;
  limit?: number;
  offset?: number;
}

/**
 * Datos de registro de un evento sanitario. `animal_id`, `event_type` y `title`
 * son obligatorios. `recorded_by` NO forma parte del contrato (lo toma el JWT).
 */
export interface CreateHealthEventInput {
  animal_id: string;
  event_type: HealthEventType;
  title: string;
  /** Opcional: si se omite, la base usa `NOW()`. */
  occurred_at?: string;
  description?: string | null;
  documented_by?: string | null;
  attachment_url?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** `details` debe ser un objeto JSON (no nulo ni arreglo), como exige el CHECK. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Comprueba que una respuesta desconocida tiene la forma de un evento. */
export function isHealthEvent(value: unknown): value is HealthEvent {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.animal_id === 'string' &&
    isHealthEventType(value.event_type) &&
    typeof value.occurred_at === 'string' &&
    typeof value.title === 'string' &&
    isNullableString(value.description) &&
    isNullableString(value.documented_by) &&
    isJsonObject(value.details) &&
    isNullableString(value.attachment_url) &&
    isNullableString(value.recorded_by) &&
    typeof value.created_at === 'string' &&
    typeof value.updated_at === 'string'
  );
}

function isHealthEventList(value: unknown): value is HealthEvent[] {
  return Array.isArray(value) && value.every(isHealthEvent);
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
function healthEventsQuery(filter: ListHealthEventsFilter | undefined): string {
  const params = new URLSearchParams();
  setIfPresent(params, 'animal_id', filter?.animal_id);
  setIfPresent(params, 'event_type', filter?.event_type);
  setIfPresent(params, 'recorded_by', filter?.recorded_by);
  setIfPresent(params, 'occurred_from', filter?.occurred_from);
  setIfPresent(params, 'occurred_to', filter?.occurred_to);
  setIfPresent(params, 'limit', filter?.limit);
  setIfPresent(params, 'offset', filter?.offset);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** Construye el `query string` del historial de un porcino. */
function animalHealthEventsQuery(
  filter: ListAnimalHealthEventsFilter | undefined,
): string {
  const params = new URLSearchParams();
  setIfPresent(params, 'event_type', filter?.event_type);
  setIfPresent(params, 'occurred_from', filter?.occurred_from);
  setIfPresent(params, 'occurred_to', filter?.occurred_to);
  setIfPresent(params, 'limit', filter?.limit);
  setIfPresent(params, 'offset', filter?.offset);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * Lista eventos sanitarios (`GET /health-events`). Solo lectura. El backend
 * ordena por `occurred_at` descendente y NO informa del total; la interfaz
 * pagina con `limit`/`offset` sin simular un contador.
 */
export async function listHealthEvents(
  client: ApiClient,
  filter?: ListHealthEventsFilter,
  options?: { signal?: AbortSignal },
): Promise<HealthEvent[]> {
  const response = await client.get<unknown>(
    `/health-events${healthEventsQuery(filter)}`,
    options,
  );
  if (!isHealthEventList(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }
  return response;
}

/** Obtiene un evento por id (`GET /health-events/:id`). Solo lectura. */
export async function getHealthEvent(
  client: ApiClient,
  id: string,
  options?: { signal?: AbortSignal },
): Promise<HealthEvent> {
  const response = await client.get<unknown>(`/health-events/${id}`, options);
  if (!isHealthEvent(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }
  return response;
}

/** Historial sanitario de un porcino (`GET /animals/:id/health-events`). */
export async function listAnimalHealthEvents(
  client: ApiClient,
  animalId: string,
  filter?: ListAnimalHealthEventsFilter,
  options?: { signal?: AbortSignal },
): Promise<HealthEvent[]> {
  const response = await client.get<unknown>(
    `/animals/${animalId}/health-events${animalHealthEventsQuery(filter)}`,
    options,
  );
  if (!isHealthEventList(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }
  return response;
}

/**
 * Registra un evento sanitario (`POST /health-events`). El backend valida el
 * tipo, el estado del porcino y el permiso por acción (matriz 5.1), y para la
 * mortalidad el trigger de la base deriva el estado `dead`.
 */
export async function createHealthEvent(
  client: ApiClient,
  input: CreateHealthEventInput,
): Promise<HealthEvent> {
  const response = await client.post<unknown>('/health-events', input);
  if (!isHealthEvent(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }
  return response;
}
