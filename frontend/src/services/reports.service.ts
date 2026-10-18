import type { ApiClient } from '../lib/http';
import {
  ANIMAL_ORIGINS,
  ANIMAL_SEXES,
  ANIMAL_STATUSES,
  type AnimalOrigin,
  type AnimalSex,
  type AnimalStatus,
} from './animals.service';
import {
  HEALTH_EVENT_TYPES,
  type HealthEventType,
} from './health-events.service';
import {
  MOVEMENT_REASONS,
  type MovementReason,
} from './movements.service';

/**
 * Contrato EXACTO del resumen de reportes (`GET /reports/summary`).
 *
 * Los nombres coinciden con la respuesta real del backend
 * (`backend/src/modules/reports/reports.service.ts`). No se inventan metricas:
 * todo valor proviene de consultas de solo lectura sobre los datos reales.
 *
 * Convencion de honestidad de datos (igual que el backend):
 * - `0` significa que la consulta confirmo que no hay registros.
 * - `null` significa "no calculable" (nunca se sustituye por 0).
 * - `truncated`/`partial` avisan de que una exploracion acotada se corto y las
 *   cifras de esa seccion no son exactas.
 */

export interface ReportsPeriod {
  /** Limite inferior inclusivo (`YYYY-MM-DD`, UTC). */
  from: string;
  /** Limite superior inclusivo (`YYYY-MM-DD`, UTC). */
  to: string;
  /** Instante inferior inclusivo (ISO 8601). */
  fromIso: string;
  /** Instante superior inclusivo (ISO 8601). */
  toIso: string;
  /** Claves `YYYY-MM` del periodo, de la mas antigua a la mas reciente. */
  months: string[];
  /** Maximo de meses admitido por el backend (documentado en la respuesta). */
  maxMonths: number;
}

/** Filtros reales aplicados por el backend en esta respuesta. */
export interface ReportsFilters {
  movementReason: MovementReason | null;
  healthEventType: HealthEventType | null;
  sex: AnimalSex | null;
  origin: AnimalOrigin | null;
}

export interface ReportsDistribution<T> {
  value: T;
  count: number;
}

export interface ReportsCapacitySummary {
  registered: boolean;
  total: number | null;
  housedAnimals: number | null;
  usageRate: number | null;
  /** `true` si falta capacidad en algun corral activo (o la exploracion se corto). */
  partial: boolean;
}

export interface ReportsPenRow {
  id: string;
  code: string;
  name: string | null;
  area_name: string | null;
  capacity: number | null;
  occupants: number;
  usageRate: number | null;
}

export interface ReportsPensSummary {
  total: number;
  occupied: number | null;
  occupancyRate: number | null;
  capacity: ReportsCapacitySummary;
  truncated: boolean;
  byPen: ReportsPenRow[];
}

export interface ReportsLitterRow {
  id: string;
  litter_code: string | null;
  birth_date: string;
  total_born: number | null;
  born_alive: number | null;
  stillborn: number | null;
}

export interface ReportsLittersSummary {
  total: number;
  truncated: boolean;
  /** `true` si TODAS las camadas del periodo traen los tres conteos. */
  complete: boolean;
  totalBorn: number | null;
  bornAlive: number | null;
  stillborn: number | null;
  averageBornAlive: number | null;
  recent: ReportsLitterRow[];
}

export interface ReportsMovementsByMonth {
  month: string;
  count: number;
}

export interface ReportsSummary {
  generatedAt: string;
  period: ReportsPeriod;
  filters: ReportsFilters;
  animals: {
    total: number;
    byStatus: ReportsDistribution<AnimalStatus>[];
    bySex: ReportsDistribution<AnimalSex>[];
    /** Incluye el origen NO registrado como `value: null`. */
    byOrigin: ReportsDistribution<AnimalOrigin | null>[];
  };
  pens: ReportsPensSummary;
  movements: {
    total: number;
    byMonth: ReportsMovementsByMonth[];
    byReason: ReportsDistribution<MovementReason>[];
  };
  litters: ReportsLittersSummary;
  healthEvents: {
    total: number;
    byType: ReportsDistribution<HealthEventType>[];
  };
}

/**
 * Filtros de la consulta. Son EXACTAMENTE los que admite el backend: rango de
 * fechas (`YYYY-MM-DD`) y las categorias reales de los enums. No se inventan
 * criterios nuevos.
 */
export interface ReportsQuery {
  from?: string;
  to?: string;
  movement_reason?: MovementReason;
  health_event_type?: HealthEventType;
  sex?: AnimalSex;
  origin?: AnimalOrigin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Conteo: entero no negativo. */
function isCount(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value >= 0;
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isNumber(value);
}

function isNullableCount(value: unknown): value is number | null {
  return value === null || isCount(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** Tasa `0..1` o `null` (nunca una cifra fuera de rango). */
function isNullableRate(value: unknown): value is number | null {
  return value === null || (isNumber(value) && value >= 0 && value <= 1);
}

function isEnumValue<T extends string>(
  choices: readonly T[],
  value: unknown,
): value is T {
  return typeof value === 'string' && (choices as readonly string[]).includes(value);
}

function isDistribution<T>(
  items: unknown,
  isValue: (value: unknown) => value is T,
): items is ReportsDistribution<T>[] {
  return (
    Array.isArray(items) &&
    items.every(
      (item) =>
        isRecord(item) && isValue(item.value) && isCount(item.count),
    )
  );
}

function isNullableOrigin(value: unknown): value is AnimalOrigin | null {
  return value === null || isEnumValue(ANIMAL_ORIGINS, value);
}

function isPenRow(value: unknown): value is ReportsPenRow {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.code === 'string' &&
    isNullableString(value.name) &&
    isNullableString(value.area_name) &&
    isNullableCount(value.capacity) &&
    isCount(value.occupants) &&
    isNullableRate(value.usageRate)
  );
}

function isLitterRow(value: unknown): value is ReportsLitterRow {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    isNullableString(value.litter_code) &&
    typeof value.birth_date === 'string' &&
    isNullableCount(value.total_born) &&
    isNullableCount(value.born_alive) &&
    isNullableCount(value.stillborn)
  );
}

/**
 * Comprueba que la respuesta tiene la forma esperada antes de mostrarla. Evita
 * renderizar como validos datos inesperados del servidor.
 */
export function isReportsSummary(value: unknown): value is ReportsSummary {
  if (!isRecord(value)) {
    return false;
  }

  const { period, filters, animals, pens, movements, litters, healthEvents } =
    value;

  if (
    typeof value.generatedAt !== 'string' ||
    !isRecord(period) ||
    typeof period.from !== 'string' ||
    typeof period.to !== 'string' ||
    typeof period.fromIso !== 'string' ||
    typeof period.toIso !== 'string' ||
    !Array.isArray(period.months) ||
    !period.months.every((month) => typeof month === 'string') ||
    !isCount(period.maxMonths)
  ) {
    return false;
  }

  if (
    !isRecord(filters) ||
    !(filters.movementReason === null ||
      isEnumValue(MOVEMENT_REASONS, filters.movementReason)) ||
    !(filters.healthEventType === null ||
      isEnumValue(HEALTH_EVENT_TYPES, filters.healthEventType)) ||
    !(filters.sex === null || isEnumValue(ANIMAL_SEXES, filters.sex)) ||
    !(filters.origin === null || isEnumValue(ANIMAL_ORIGINS, filters.origin))
  ) {
    return false;
  }

  if (
    !isRecord(animals) ||
    !isCount(animals.total) ||
    !isDistribution(animals.byStatus, (item) =>
      isEnumValue(ANIMAL_STATUSES, item),
    ) ||
    !isDistribution(animals.bySex, (item) => isEnumValue(ANIMAL_SEXES, item)) ||
    !isDistribution(animals.byOrigin, isNullableOrigin)
  ) {
    return false;
  }

  if (
    !isRecord(pens) ||
    !isCount(pens.total) ||
    !isNullableCount(pens.occupied) ||
    !isNullableRate(pens.occupancyRate) ||
    !isRecord(pens.capacity) ||
    typeof pens.capacity.registered !== 'boolean' ||
    !isNullableCount(pens.capacity.total) ||
    !isNullableCount(pens.capacity.housedAnimals) ||
    !isNullableRate(pens.capacity.usageRate) ||
    typeof pens.capacity.partial !== 'boolean' ||
    typeof pens.truncated !== 'boolean' ||
    !Array.isArray(pens.byPen) ||
    !pens.byPen.every(isPenRow)
  ) {
    return false;
  }

  if (
    !isRecord(movements) ||
    !isCount(movements.total) ||
    !Array.isArray(movements.byMonth) ||
    !movements.byMonth.every(
      (item) =>
        isRecord(item) &&
        typeof item.month === 'string' &&
        isCount(item.count),
    ) ||
    !isDistribution(movements.byReason, (item) =>
      isEnumValue(MOVEMENT_REASONS, item),
    )
  ) {
    return false;
  }

  if (
    !isRecord(litters) ||
    !isCount(litters.total) ||
    typeof litters.truncated !== 'boolean' ||
    typeof litters.complete !== 'boolean' ||
    !isNullableCount(litters.totalBorn) ||
    !isNullableCount(litters.bornAlive) ||
    !isNullableCount(litters.stillborn) ||
    !isNullableNumber(litters.averageBornAlive) ||
    !Array.isArray(litters.recent) ||
    !litters.recent.every(isLitterRow)
  ) {
    return false;
  }

  if (
    !isRecord(healthEvents) ||
    !isCount(healthEvents.total) ||
    !isDistribution(healthEvents.byType, (item) =>
      isEnumValue(HEALTH_EVENT_TYPES, item),
    )
  ) {
    return false;
  }

  return true;
}

/** Anade un parametro solo cuando tiene valor. */
function setIfPresent(
  params: URLSearchParams,
  key: string,
  value: string | undefined,
): void {
  if (value !== undefined && value !== '') {
    params.set(key, value);
  }
}

/** Construye el `query string` con los filtros reales del backend. */
export function reportsQueryString(query?: ReportsQuery): string {
  const params = new URLSearchParams();
  setIfPresent(params, 'from', query?.from);
  setIfPresent(params, 'to', query?.to);
  setIfPresent(params, 'movement_reason', query?.movement_reason);
  setIfPresent(params, 'health_event_type', query?.health_event_type);
  setIfPresent(params, 'sex', query?.sex);
  setIfPresent(params, 'origin', query?.origin);
  const result = params.toString();
  return result ? `?${result}` : '';
}

/**
 * Obtiene el resumen de reportes con el JWT de la sesion.
 *
 * Es una consulta de SOLO LECTURA: unicamente llama a `GET /reports/summary`.
 */
export async function getReportsSummary(
  client: ApiClient,
  query?: ReportsQuery,
  options?: { signal?: AbortSignal },
): Promise<ReportsSummary> {
  const response = await client.get<unknown>(
    `/reports/summary${reportsQueryString(query)}`,
    options,
  );

  if (!isReportsSummary(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }

  return response;
}
