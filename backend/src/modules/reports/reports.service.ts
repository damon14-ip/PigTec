import {
  ANIMAL_ORIGINS,
  ANIMAL_SEXES,
  ANIMAL_STATUSES,
  type AnimalOrigin,
  type AnimalSex,
  type AnimalStatus,
} from '../common/animal.js';
import { ValidationError } from '../common/data-errors.js';
import {
  HEALTH_EVENT_TYPES,
  type HealthEventType,
} from '../common/health-event.js';
import {
  MOVEMENT_REASONS,
  type MovementReason,
} from '../common/movement.js';
import {
  MAX_PENS,
  type AnimalDistributionFilter,
  type ReportArea,
  type ReportPen,
  type ReportsRepository,
} from './reports.repository.js';
import type { ReportsQuery } from './reports.schemas.js';

/**
 * Calculo de las estadisticas de la seccion "Reportes y analisis".
 *
 * Toda la logica de negocio (periodo, claves de mes, divisiones protegidas,
 * agregacion y banderas de honestidad) vive aqui y es PURA respecto del
 * repositorio inyectado, de modo que se puede probar sin red ni base de datos. La
 * fecha "actual" es inyectable (`now`) para que el periodo por defecto sea
 * determinista en las pruebas.
 *
 * Reglas de honestidad de los datos:
 * - Un valor `null` significa "no calculable" (nunca se sustituye por 0).
 * - Un `0` significa que la consulta confirmo que no hay registros.
 * - Nunca se divide por cero: las tasas son `null` si el denominador es 0.
 * - Si una exploracion acotada se trunca, la metrica afectada se marca como
 *   parcial y no se presenta como exacta.
 */

/** Meses del periodo por defecto (incluye el mes actual). */
export const REPORTS_DEFAULT_MONTHS = 6;

/**
 * Maximo de meses que puede abarcar un periodo. Acota el numero de consultas
 * mensuales y evita series desproporcionadas. Un rango mayor se rechaza (400).
 */
export const REPORTS_MAX_MONTHS = 12;

/** Numero maximo de camadas recientes devueltas para la tabla. */
export const REPORTS_RECENT_LITTERS = 20;

export interface ReportsPeriod {
  /** Limite inferior inclusivo del periodo (`YYYY-MM-DD`, UTC). */
  from: string;
  /** Limite superior inclusivo del periodo (`YYYY-MM-DD`, UTC). */
  to: string;
  /** Instante inferior inclusivo (`timestamptz`). */
  fromIso: string;
  /** Instante superior inclusivo (`timestamptz`). */
  toIso: string;
  /** Claves `YYYY-MM` del periodo, de la mas antigua a la mas reciente. */
  months: string[];
  /** Maximo de meses admitido (documentado en la respuesta). */
  maxMonths: number;
}

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
  /** `true` si una exploracion se trunco: la tabla y la ocupacion son parciales. */
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
  /** Nacidos vivos por camada; solo si el periodo esta completo (si no, `null`). */
  averageBornAlive: number | null;
  recent: ReportsLitterRow[];
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
    byMonth: { month: string; count: number }[];
    byReason: ReportsDistribution<MovementReason>[];
  };
  litters: ReportsLittersSummary;
  healthEvents: {
    total: number;
    byType: ReportsDistribution<HealthEventType>[];
  };
}

export interface ReportsService {
  getSummary(query: ReportsQuery, accessToken: string): Promise<ReportsSummary>;
}

export interface ReportsServiceOptions {
  /** Fuente de la fecha actual (inyectable en pruebas). Por defecto `new Date`. */
  now?: () => Date;
}

interface ResolvedPeriod {
  from: string;
  to: string;
  fromIso: string;
  toIso: string;
  months: string[];
  monthRanges: { from: string; to: string }[];
  isoRange: { from: string; to: string };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Numero de dias del mes indicado (UTC). */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Instante de inicio de un dia de calendario (UTC). */
function startOfDayIso(date: string): string {
  return `${date}T00:00:00.000Z`;
}

/** Instante de fin de un dia de calendario (UTC). */
function endOfDayIso(date: string): string {
  return `${date}T23:59:59.999Z`;
}

/**
 * Claves `YYYY-MM` entre dos fechas de calendario (inclusive). Se detiene al
 * superar `REPORTS_MAX_MONTHS`: el llamador rechaza un periodo demasiado largo.
 */
function monthKeysBetween(from: string, to: string): string[] {
  const [startYear, startMonth] = from.split('-').map(Number);
  const [endYear, endMonth] = to.split('-').map(Number);
  const keys: string[] = [];
  let year = startYear;
  let month = startMonth;

  for (;;) {
    keys.push(`${year}-${pad(month)}`);
    if (year === endYear && month === endMonth) {
      return keys;
    }
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    if (keys.length > REPORTS_MAX_MONTHS) {
      return keys;
    }
  }
}

/**
 * Rango `timestamptz` de un mes, RECORTADO a los limites del periodo para que la
 * suma de la serie mensual coincida EXACTAMENTE con el total del periodo (nunca
 * se cuenta dos veces ni se incluyen dias fuera del rango).
 */
function intersectMonth(
  monthKey: string,
  from: string,
  to: string,
): { from: string; to: string } {
  const [year, month] = monthKey.split('-').map(Number);
  const lastDay = daysInMonth(year, month);
  const monthStart = `${monthKey}-01`;
  const monthEnd = `${monthKey}-${pad(lastDay)}`;
  // Fechas `YYYY-MM-DD`: la comparacion lexicografica equivale a la cronologica.
  const startDate = monthStart > from ? monthStart : from;
  const endDate = monthEnd < to ? monthEnd : to;
  return { from: startOfDayIso(startDate), to: endOfDayIso(endDate) };
}

/** Tasa `numerator/denominator`, o `null` si no es calculable. */
function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

/** Resuelve el periodo pedido (o el de por defecto) y valida sus limites. */
function resolvePeriod(query: ReportsQuery, now: Date): ResolvedPeriod {
  const today = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(
    now.getUTCDate(),
  )}`;
  const start = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - (REPORTS_DEFAULT_MONTHS - 1),
      1,
    ),
  );
  const defaultFrom = `${start.getUTCFullYear()}-${pad(
    start.getUTCMonth() + 1,
  )}-01`;

  const from = query.from ?? defaultFrom;
  const to = query.to ?? today;

  if (from > to) {
    throw new ValidationError('"from" no puede ser posterior a "to"');
  }

  const months = monthKeysBetween(from, to);
  if (months.length > REPORTS_MAX_MONTHS) {
    throw new ValidationError(
      `el periodo no puede superar ${REPORTS_MAX_MONTHS} meses`,
    );
  }

  return {
    from,
    to,
    fromIso: startOfDayIso(from),
    toIso: endOfDayIso(to),
    months,
    monthRanges: months.map((month) => intersectMonth(month, from, to)),
    isoRange: { from: startOfDayIso(from), to: endOfDayIso(to) },
  };
}

/** Agrega ocupacion y capacidad de los corrales ACTIVOS. */
function summarizePens(
  pens: ReportPen[],
  areas: ReportArea[],
  scan: { byPen: Record<string, number>; truncated: boolean },
): ReportsPensSummary {
  // Si la lista de corrales alcanzo el limite, la ocupacion no es fiable.
  const pensTruncated = pens.length >= MAX_PENS;
  const truncated = pensTruncated || scan.truncated;

  const areaNames = new Map(areas.map((area) => [area.id, area.name]));

  let occupiedCount = 0;
  let housedInActivePens = 0;
  const rows: ReportsPenRow[] = [];

  for (const pen of pens) {
    const occupants = scan.byPen[pen.id] ?? 0;
    if (occupants > 0) {
      occupiedCount += 1;
    }
    housedInActivePens += occupants;
    rows.push({
      id: pen.id,
      code: pen.code,
      name: pen.name,
      area_name: areaNames.get(pen.area_id) ?? null,
      capacity: pen.capacity,
      occupants,
      usageRate:
        pen.capacity !== null && pen.capacity > 0
          ? occupants / pen.capacity
          : null,
    });
  }

  const occupied = truncated ? null : occupiedCount;
  const occupancyRate =
    occupied === null ? null : rate(occupied, pens.length);

  const capacities = pens
    .map((pen) => pen.capacity)
    .filter((capacity): capacity is number => capacity !== null);
  const registeredCount = capacities.length;
  const registered = registeredCount > 0;
  // La capacidad esta completa solo si TODOS los corrales activos la registran.
  const missingCapacity = registeredCount < pens.length;
  const partial = truncated || (registered && missingCapacity);
  const capacityTotal = pensTruncated
    ? null
    : registered
      ? capacities.reduce((sum, value) => sum + value, 0)
      : null;

  // Solo se cuentan los porcinos alojados en corrales ACTIVOS, para que la cifra
  // case con la tabla de ocupacion (sin doble conteo).
  const housedAnimals = truncated ? null : housedInActivePens;
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
    truncated,
    byPen: truncated ? [] : rows,
  };
}

/** Suma nacimientos del periodo a partir de las camadas exploradas. */
function summarizeLitters(
  rows: ReportsLitterRow[],
  truncated: boolean,
): ReportsLittersSummary {
  let totalBorn = 0;
  let bornAlive = 0;
  let stillborn = 0;
  let totalBornCount = 0;
  let bornAliveCount = 0;
  let stillbornCount = 0;
  let incomplete = false;

  for (const row of rows) {
    if (
      row.total_born === null ||
      row.born_alive === null ||
      row.stillborn === null
    ) {
      incomplete = true;
    }
    if (row.total_born !== null) {
      totalBorn += row.total_born;
      totalBornCount += 1;
    }
    if (row.born_alive !== null) {
      bornAlive += row.born_alive;
      bornAliveCount += 1;
    }
    if (row.stillborn !== null) {
      stillborn += row.stillborn;
      stillbornCount += 1;
    }
  }

  const total = rows.length;
  const complete = !incomplete && !truncated;

  return {
    total,
    truncated,
    complete,
    // `null` (no calculable) cuando ninguna camada trae el conteo; nunca 0 por
    // omision.
    totalBorn: totalBornCount > 0 ? totalBorn : null,
    bornAlive: bornAliveCount > 0 ? bornAlive : null,
    stillborn: stillbornCount > 0 ? stillborn : null,
    averageBornAlive:
      complete && total > 0 && bornAliveCount === total
        ? bornAlive / total
        : null,
    recent: rows.slice(0, REPORTS_RECENT_LITTERS),
  };
}

export function createReportsService(
  repository: ReportsRepository,
  options: ReportsServiceOptions = {},
): ReportsService {
  const now = options.now ?? (() => new Date());

  return {
    async getSummary(query, accessToken) {
      const reference = now();
      const period = resolvePeriod(query, reference);
      const reason = query.movement_reason ?? null;
      const eventType = query.health_event_type ?? null;

      const filter: AnimalDistributionFilter = {};
      if (query.sex) {
        filter.sex = query.sex;
      }
      if (query.origin) {
        filter.origin = query.origin;
      }

      // Consultas independientes en paralelo (sin dependencias entre si).
      const [
        statusCounts,
        sexCounts,
        originCounts,
        movementMonthCounts,
        reasonCounts,
        typeCounts,
        pens,
        areas,
        penScan,
        litterScan,
      ] = await Promise.all([
        repository.countAnimalsByStatus(filter, accessToken),
        repository.countAnimalsBySex(filter, accessToken),
        repository.countAnimalsByOrigin(filter, accessToken),
        Promise.all(
          period.monthRanges.map((range) =>
            repository.countMovements(range, reason, accessToken),
          ),
        ),
        repository.countMovementsByReason(period.isoRange, reason, accessToken),
        repository.countHealthEventsByType(
          period.isoRange,
          eventType,
          accessToken,
        ),
        repository.listActivePens(accessToken),
        repository.listAreas(accessToken),
        repository.scanPenOccupancy(accessToken),
        repository.scanLitters(
          { from: period.from, to: period.to },
          accessToken,
        ),
      ]);

      const byStatus: ReportsDistribution<AnimalStatus>[] = ANIMAL_STATUSES.map(
        (status) => ({ value: status, count: statusCounts[status] }),
      );
      const total = byStatus.reduce((sum, item) => sum + item.count, 0);

      const bySex: ReportsDistribution<AnimalSex>[] = ANIMAL_SEXES.map((sex) => ({
        value: sex,
        count: sexCounts[sex],
      }));

      const byOrigin: ReportsDistribution<AnimalOrigin | null>[] =
        ANIMAL_ORIGINS.map((origin) => ({
          value: origin,
          count: originCounts[origin],
        }));
      // El origen NO registrado (`origin IS NULL`) se deriva del total: ambos
      // particionan el mismo conjunto filtrado.
      const originSum = byOrigin.reduce((sum, item) => sum + item.count, 0);
      byOrigin.push({
        value: null,
        count: Math.max(total - originSum, 0),
      });

      const byMonth = period.months.map((month, index) => ({
        month,
        count: movementMonthCounts[index],
      }));

      const byReason: ReportsDistribution<MovementReason>[] =
        MOVEMENT_REASONS.map((value) => ({
          value,
          count: reasonCounts[value],
        }));

      const byType: ReportsDistribution<HealthEventType>[] =
        HEALTH_EVENT_TYPES.map((value) => ({
          value,
          count: typeCounts[value],
        }));

      const litterRows: ReportsLitterRow[] = litterScan.rows.map((row) => ({
        id: row.id,
        litter_code: row.litter_code,
        birth_date: row.birth_date,
        total_born: row.total_born,
        born_alive: row.born_alive,
        stillborn: row.stillborn,
      }));

      return {
        generatedAt: reference.toISOString(),
        period: {
          from: period.from,
          to: period.to,
          fromIso: period.fromIso,
          toIso: period.toIso,
          months: period.months,
          maxMonths: REPORTS_MAX_MONTHS,
        },
        filters: {
          movementReason: reason,
          healthEventType: eventType,
          sex: query.sex ?? null,
          origin: query.origin ?? null,
        },
        animals: {
          total,
          byStatus,
          bySex,
          byOrigin,
        },
        pens: summarizePens(pens, areas, penScan),
        movements: {
          // La serie mensual cubre EXACTAMENTE el periodo: el total es su suma.
          total: byMonth.reduce((sum, item) => sum + item.count, 0),
          byMonth,
          byReason,
        },
        litters: summarizeLitters(litterRows, litterScan.truncated),
        healthEvents: {
          total: byType.reduce((sum, item) => sum + item.count, 0),
          byType,
        },
      };
    },
  };
}
