import { ANIMAL_STATUSES, type AnimalStatus } from '../common/animal.js';
import {
  MAX_PENS,
  type DashboardPen,
  type DashboardRepository,
  type IsoRange,
} from './dashboard.repository.js';

/**
 * Calculo de los indicadores del dashboard.
 *
 * Toda la logica de negocio (rangos de mes, divisiones protegidas, agregacion)
 * vive aqui y es PURA respecto del repositorio inyectado, de modo que se puede
 * probar sin red ni base de datos. La fecha "actual" es inyectable (`now`) para
 * que la agrupacion mensual sea determinista en las pruebas.
 *
 * Reglas de honestidad de los datos:
 * - Un valor `null` significa "no calculable" (nunca se sustituye por 0).
 * - Un `0` significa que la consulta confirmo que no hay registros.
 * - Nunca se divide por cero: las tasas son `null` si el denominador es 0.
 */

/** Meses incluidos en el grafico de movimientos (incluye el mes actual). */
export const MOVEMENTS_MONTHS_WINDOW = 6;

export interface DashboardStatusCount {
  status: AnimalStatus;
  count: number;
}

export interface DashboardCapacitySummary {
  /** `true` si al menos un corral activo tiene capacidad registrada. */
  registered: boolean;
  /** Suma de las capacidades registradas; `null` si no hay ninguna. */
  total: number | null;
  /** Porcinos activos alojados; `null` si la exploracion fue parcial. */
  housedAnimals: number | null;
  /**
   * `housedAnimals / total` (0..1); `null` si no es calculable o si la
   * capacidad esta incompleta (`partial`). Nunca se presenta un porcentaje
   * exacto cuando faltan capacidades por registrar: seria enganoso.
   */
  usageRate: number | null;
  /**
   * `true` si la capacidad NO esta completa: algun corral activo no tiene
   * capacidad registrada (o la lista de corrales se trunco). En ese caso
   * `usageRate` es `null` y solo se informa la suma parcial, claramente
   * etiquetada, sin porcentaje.
   */
  partial: boolean;
}

export interface DashboardPensSummary {
  /** Corrales activos. */
  total: number;
  /** Corrales activos con al menos un porcino activo; `null` si no calculable. */
  occupied: number | null;
  /** `occupied / total` (0..1); `null` si no calculable o total es 0. */
  occupancyRate: number | null;
  capacity: DashboardCapacitySummary;
}

export interface DashboardMovementsByMonth {
  /** Mes en formato `YYYY-MM`. */
  month: string;
  count: number;
}

export interface DashboardSummary {
  /** Marca de tiempo (UTC, ISO 8601) en que se calculo el resumen. */
  generatedAt: string;
  period: {
    /** Mes actual `YYYY-MM`. */
    month: string;
    /** Inicio y fin inclusivos del mes actual (ISO 8601). */
    from: string;
    to: string;
    /** Meses del grafico, del mas antiguo al mas reciente. */
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

export interface DashboardService {
  getSummary(accessToken: string): Promise<DashboardSummary>;
}

export interface DashboardServiceOptions {
  /** Fuente de la fecha actual (inyectable en pruebas). Por defecto `new Date`. */
  now?: () => Date;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Clave `YYYY-MM` del mes de una fecha (UTC). */
function monthKeyOf(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

/** Numero de dias del mes indicado (UTC). */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Rango `timestamptz` inclusivo que cubre un mes `YYYY-MM` completo (UTC). */
function monthIsoRange(key: string): IsoRange {
  const [year, month] = key.split('-').map(Number);
  const lastDay = daysInMonth(year, month);
  return {
    from: `${key}-01T00:00:00.000Z`,
    to: `${key}-${pad(lastDay)}T23:59:59.999Z`,
  };
}

/** Rango `date` inclusivo que cubre un mes `YYYY-MM` completo. */
function monthDateRange(key: string): { from: string; to: string } {
  const [year, month] = key.split('-').map(Number);
  const lastDay = daysInMonth(year, month);
  return { from: `${key}-01`, to: `${key}-${pad(lastDay)}` };
}

/** Devuelve las ultimas `count` claves de mes, de la mas antigua a la actual. */
function recentMonthKeys(now: Date, count: number): string[] {
  const keys: string[] = [];
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-based
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(year, month - offset, 1));
    keys.push(monthKeyOf(date));
  }
  return keys;
}

/** Tasa `numerator/denominator`, o `null` si no es calculable (sin dividir por 0). */
function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

export function createDashboardService(
  repository: DashboardRepository,
  options: DashboardServiceOptions = {},
): DashboardService {
  const now = options.now ?? (() => new Date());

  return {
    async getSummary(accessToken) {
      const reference = now();
      const currentMonth = monthKeyOf(reference);
      const currentRange = monthIsoRange(currentMonth);
      const months = recentMonthKeys(reference, MOVEMENTS_MONTHS_WINDOW);

      // Consultas independientes en paralelo (sin dependencias entre si).
      const [
        statusCounts,
        scan,
        pens,
        movementsByMonth,
        healthEventsMonth,
        littersTotal,
        littersMonth,
      ] = await Promise.all([
        repository.countAnimalsByStatus(accessToken),
        repository.scanHousedAnimalPens(accessToken),
        repository.listActivePens(accessToken),
        Promise.all(
          months.map((month) =>
            repository.countMovements(monthIsoRange(month), accessToken),
          ),
        ),
        repository.countHealthEvents(currentRange, accessToken),
        repository.countLitters(null, accessToken),
        repository.countLitters(monthDateRange(currentMonth), accessToken),
      ]);

      const byStatus: DashboardStatusCount[] = ANIMAL_STATUSES.map((status) => ({
        status,
        count: statusCounts[status],
      }));
      const total = byStatus.reduce((sum, item) => sum + item.count, 0);

      const summaryPens = summarizePens(pens, scan);

      const byMonth: DashboardMovementsByMonth[] = months.map((month, index) => ({
        month,
        count: movementsByMonth[index],
      }));

      return {
        generatedAt: reference.toISOString(),
        period: {
          month: currentMonth,
          from: currentRange.from,
          to: currentRange.to,
          months,
        },
        animals: {
          total,
          active: statusCounts.active,
          byStatus,
        },
        pens: summaryPens,
        movements: {
          // El mes actual es la ultima entrada del grafico: no se repite consulta.
          month: byMonth[byMonth.length - 1]?.count ?? 0,
          byMonth,
        },
        healthEvents: {
          month: healthEventsMonth,
        },
        litters: {
          total: littersTotal,
          month: littersMonth,
        },
      };
    },
  };
}

/** Agrega ocupacion y capacidad a partir de los corrales y la exploracion. */
function summarizePens(
  pens: DashboardPen[],
  scan: { penIds: string[]; housedAnimals: number; truncated: boolean },
): DashboardPensSummary {
  // Si la lista de corrales alcanzo el limite, la ocupacion no es fiable.
  const pensTruncated = pens.length >= MAX_PENS;

  const activePenIds = new Set(pens.map((pen) => pen.id));
  const occupiedPenIds =
    scan.truncated || pensTruncated
      ? null
      : new Set(scan.penIds.filter((id) => activePenIds.has(id)));

  const occupied = occupiedPenIds ? occupiedPenIds.size : null;
  const occupancyRate =
    occupied === null ? null : rate(occupied, pens.length);

  const capacities = pens
    .map((pen) => pen.capacity)
    .filter((capacity): capacity is number => capacity !== null);
  const registeredCount = capacities.length;
  const registered = registeredCount > 0;
  // La capacidad esta completa solo si TODOS los corrales activos la registran.
  // "Parcial" aplica cuando hay capacidad registrada pero falta en otros
  // corrales (si no hay ninguna, el estado es "sin capacidad", no "parcial").
  const missingCapacity = registeredCount < pens.length;
  const partial = pensTruncated || (registered && missingCapacity);
  const capacityTotal = pensTruncated
    ? null
    : registered
      ? capacities.reduce((sum, value) => sum + value, 0)
      : null;

  const housedAnimals = scan.truncated || pensTruncated ? null : scan.housedAnimals;
  // Con capacidad incompleta no se calcula el porcentaje: el denominador no
  // representa la capacidad real de la granja y la cifra seria enganosa.
  const usageRate =
    housedAnimals === null || capacityTotal === null || partial
      ? null
      : rate(housedAnimals, capacityTotal);

  return {
    total: pens.length,
    occupied,
    occupancyRate,
    capacity: {
      registered: registered && !pensTruncated,
      total: capacityTotal,
      housedAnimals,
      usageRate,
      partial,
    },
  };
}
