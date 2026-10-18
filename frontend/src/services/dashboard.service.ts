import type { ApiClient } from '../lib/http';

/**
 * Resumen agregado del dashboard: contrato EXACTO de
 * `GET /dashboard/summary` del backend. Los nombres coinciden con las columnas
 * y enums reales del esquema; no se anaden metricas ficticias.
 *
 * Convencion de honestidad de datos (igual que el backend):
 * - `0` significa que la consulta confirmo que no hay registros.
 * - `null` significa "no calculable" y se muestra como "Sin datos suficientes".
 */

export const ANIMAL_STATUSES = [
  'active',
  'sold',
  'dead',
  'transferred_out',
  'missing',
  'inactive',
] as const;

export type AnimalStatus = (typeof ANIMAL_STATUSES)[number];

export interface DashboardStatusCount {
  status: AnimalStatus;
  count: number;
}

export interface DashboardCapacitySummary {
  registered: boolean;
  total: number | null;
  housedAnimals: number | null;
  usageRate: number | null;
  /**
   * `true` si la capacidad NO está completa (algún corral activo sin capacidad
   * registrada). Cuando es `true`, `usageRate` es `null`: no se presenta un
   * porcentaje de utilización potencialmente engañoso.
   */
  partial: boolean;
}

export interface DashboardPensSummary {
  total: number;
  occupied: number | null;
  occupancyRate: number | null;
  capacity: DashboardCapacitySummary;
}

export interface DashboardMovementsByMonth {
  month: string;
  count: number;
}

export interface DashboardSummary {
  generatedAt: string;
  period: {
    month: string;
    from: string;
    to: string;
    months: string[];
  };
  animals: {
    total: number;
    active: number;
    byStatus: DashboardStatusCount[];
  };
  pens: DashboardPensSummary;
  movements: {
    month: number;
    byMonth: DashboardMovementsByMonth[];
  };
  healthEvents: {
    month: number;
  };
  litters: {
    total: number;
    month: number;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isNumber(value);
}

function isNullableRate(value: unknown): value is number | null {
  return value === null || (isNumber(value) && value >= 0 && value <= 1);
}

function isAnimalStatus(value: unknown): value is AnimalStatus {
  return (
    typeof value === 'string' &&
    (ANIMAL_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Comprueba que la respuesta tiene la forma esperada antes de mostrarla. Evita
 * renderizar como validos datos inesperados del servidor.
 */
export function isDashboardSummary(value: unknown): value is DashboardSummary {
  if (!isRecord(value)) {
    return false;
  }
  const animals = value.animals;
  const period = value.period;
  const pens = value.pens;
  const movements = value.movements;
  const healthEvents = value.healthEvents;
  const litters = value.litters;

  if (
    typeof value.generatedAt !== 'string' ||
    !isRecord(period) ||
    typeof period.month !== 'string' ||
    !Array.isArray(period.months) ||
    !period.months.every((month) => typeof month === 'string') ||
    !isRecord(animals) ||
    !isNumber(animals.total) ||
    !isNumber(animals.active) ||
    !Array.isArray(animals.byStatus) ||
    !animals.byStatus.every(
      (item) =>
        isRecord(item) && isAnimalStatus(item.status) && isNumber(item.count),
    ) ||
    !isRecord(pens) ||
    !isNumber(pens.total) ||
    !isNullableNumber(pens.occupied) ||
    !isNullableRate(pens.occupancyRate) ||
    !isRecord(pens.capacity) ||
    typeof pens.capacity.registered !== 'boolean' ||
    !isNullableNumber(pens.capacity.total) ||
    !isNullableNumber(pens.capacity.housedAnimals) ||
    !isNullableRate(pens.capacity.usageRate) ||
    typeof pens.capacity.partial !== 'boolean' ||
    !isRecord(movements) ||
    !isNumber(movements.month) ||
    !Array.isArray(movements.byMonth) ||
    !movements.byMonth.every(
      (item) =>
        isRecord(item) && typeof item.month === 'string' && isNumber(item.count),
    ) ||
    !isRecord(healthEvents) ||
    !isNumber(healthEvents.month) ||
    !isRecord(litters) ||
    !isNumber(litters.total) ||
    !isNumber(litters.month)
  ) {
    return false;
  }

  return true;
}

/**
 * Obtiene el resumen del dashboard con el JWT de la sesion.
 *
 * Es una consulta de SOLO LECTURA: unicamente llama a `GET /dashboard/summary`.
 */
export async function getDashboardSummary(
  client: ApiClient,
  options?: { signal?: AbortSignal },
): Promise<DashboardSummary> {
  const response = await client.get<unknown>('/dashboard/summary', options);

  if (!isDashboardSummary(response)) {
    throw new Error('Respuesta no valida del servidor.');
  }

  return response;
}
