import {
  ANIMAL_ORIGINS,
  ANIMAL_SEXES,
  ANIMAL_STATUSES,
  type AnimalOrigin,
  type AnimalSex,
  type AnimalStatus,
} from '../common/animal.js';
import { DataAccessError, toDataError } from '../common/data-errors.js';
import {
  HEALTH_EVENT_TYPES,
  type HealthEventType,
} from '../common/health-event.js';
import { isLocationStatus, type LocationStatus } from '../common/location.js';
import {
  MOVEMENT_REASONS,
  type MovementReason,
} from '../common/movement.js';
import type {
  PostgrestClientFactory,
  PostgrestQuery,
} from '../common/postgrest.js';

/**
 * Modelo de LECTURA agregado de reportes.
 *
 * NO corresponde a una tabla del esquema: es un "read model" que combina
 * consultas de solo lectura ya existentes (animals, pens, areas,
 * animal_movements, health_events, litters) para calcular estadisticas sin
 * descargar el inventario al navegador.
 *
 * Reglas de la etapa S5-E1:
 * - Las distribuciones por categoria se calculan con **conteos exactos** de
 *   PostgREST (`count: 'exact', head: true`): una consulta por valor de enum, sin
 *   traer filas. PostgREST no permite `GROUP BY`/`DISTINCT` sin un RPC/vista, y en
 *   esta etapa no se pueden crear objetos en la base.
 * - Las dos unicas lecturas con filas son exploraciones **paginadas y acotadas**:
 *   `animals.current_pen_id` (ocupacion por corral) y las columnas de conteo de
 *   `litters` (sumas de nacimientos). Si se alcanza el tope, el resultado se marca
 *   como parcial y NUNCA se presenta como exacto.
 * - Ningun calculo depende de datos ficticios: un valor fuera de los enums se
 *   rechaza como fallo de datos (503).
 */

/** Rango ISO 8601 (`timestamptz`) inclusivo. */
export interface IsoRange {
  from: string;
  to: string;
}

/** Rango de fechas de calendario `YYYY-MM-DD` inclusivo. */
export interface CalendarRange {
  from: string;
  to: string;
}

/**
 * Filtros del inventario. Son EXACTAMENTE los que admite `GET /animals`
 * (`sex`, `origin`): no se inventan filtros nuevos.
 */
export interface AnimalDistributionFilter {
  sex?: AnimalSex;
  origin?: AnimalOrigin;
}

/** Corral activo con los datos necesarios para la tabla de ocupacion. */
export interface ReportPen {
  id: string;
  code: string;
  name: string | null;
  area_id: string;
  capacity: number | null;
  status: LocationStatus;
}

/** Area minima necesaria para etiquetar los corrales. */
export interface ReportArea {
  id: string;
  name: string;
}

/** Resultado de la exploracion de ocupacion. */
export interface PenOccupancyScan {
  /** Ocupantes por id de corral (solo porcinos activos con corral asignado). */
  byPen: Record<string, number>;
  /** Total de porcinos activos con corral asignado. */
  housedAnimals: number;
  /** `true` si se alcanzo `MAX_PEN_SCAN`: el conteo es parcial, no exacto. */
  truncated: boolean;
}

/** Fila de camada leida para sumar nacimientos (subconjunto de columnas). */
export interface LitterScanRow {
  id: string;
  litter_code: string | null;
  birth_date: string;
  total_born: number | null;
  born_alive: number | null;
  stillborn: number | null;
}

export interface LitterScan {
  rows: LitterScanRow[];
  /** `true` si se alcanzo `MAX_LITTER_SCAN`: las sumas son parciales. */
  truncated: boolean;
}

/**
 * Limite de corrales activos que se listan. Un numero mayor se considera fuera
 * de alcance y la ocupacion se marca como parcial.
 */
export const MAX_PENS = 1000;

/** Limite de porcinos activos explorados para contar ocupacion por corral. */
export const MAX_PEN_SCAN = 10000;

/** Limite de camadas exploradas para sumar nacimientos del periodo. */
export const MAX_LITTER_SCAN = 5000;

/** Tamano de pagina de PostgREST (por debajo del tope por defecto de 1000). */
const PAGE_SIZE = 500;

export interface ReportsRepository {
  /** Conteo exacto de porcinos por estado, con los filtros aplicados. */
  countAnimalsByStatus(
    filter: AnimalDistributionFilter,
    accessToken: string,
  ): Promise<Record<AnimalStatus, number>>;
  /** Conteo exacto de porcinos por sexo, con los filtros aplicados. */
  countAnimalsBySex(
    filter: AnimalDistributionFilter,
    accessToken: string,
  ): Promise<Record<AnimalSex, number>>;
  /**
   * Conteo exacto de porcinos por cada origen canonico, con los filtros
   * aplicados. El origen NO registrado (`NULL`) lo deriva el servicio.
   */
  countAnimalsByOrigin(
    filter: AnimalDistributionFilter,
    accessToken: string,
  ): Promise<Record<AnimalOrigin, number>>;
  /** Exploracion acotada de los porcinos activos por corral. */
  scanPenOccupancy(accessToken: string): Promise<PenOccupancyScan>;
  /** Corrales ACTIVOS (con su area) para ocupacion y capacidad. */
  listActivePens(accessToken: string): Promise<ReportPen[]>;
  /** Areas (id, nombre) para etiquetar los corrales. */
  listAreas(accessToken: string): Promise<ReportArea[]>;
  /** Conteo exacto de movimientos en el rango, opcionalmente por motivo. */
  countMovements(
    range: IsoRange,
    reason: MovementReason | null,
    accessToken: string,
  ): Promise<number>;
  /** Conteo exacto de movimientos por motivo; un filtro deja el resto en 0. */
  countMovementsByReason(
    range: IsoRange,
    reason: MovementReason | null,
    accessToken: string,
  ): Promise<Record<MovementReason, number>>;
  /** Conteo exacto de eventos sanitarios por tipo; un filtro deja el resto en 0. */
  countHealthEventsByType(
    range: IsoRange,
    eventType: HealthEventType | null,
    accessToken: string,
  ): Promise<Record<HealthEventType, number>>;
  /** Exploracion acotada de las camadas del periodo (para sumar nacimientos). */
  scanLitters(range: CalendarRange, accessToken: string): Promise<LitterScan>;
}

/** Valida el `count` exacto de PostgREST; nunca lo sustituye por 0. */
function requireCount(count: number | null | undefined): number {
  if (typeof count !== 'number') {
    throw new DataAccessError();
  }
  return count;
}

function isNullableInt(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value));
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** Aplica los filtros de inventario (los mismos de `GET /animals`). */
function applyAnimalFilter<T>(
  query: PostgrestQuery<T>,
  filter: AnimalDistributionFilter,
): PostgrestQuery<T> {
  let result = query;
  if (filter.sex) {
    result = result.eq('sex', filter.sex);
  }
  if (filter.origin) {
    result = result.eq('origin', filter.origin);
  }
  return result;
}

/**
 * Acceso de lectura agregado. Cada operacion crea un cliente PostgREST por
 * peticion con el JWT verificado, de modo que PostgreSQL aplica RLS con la
 * identidad del usuario (nunca `service_role`). Es un repositorio de SOLO
 * LECTURA: no expone ninguna operacion de escritura.
 */
export function createSupabaseReportsRepository(
  createClient: PostgrestClientFactory,
): ReportsRepository {
  return {
    async countAnimalsByStatus(filter, accessToken) {
      const client = createClient(accessToken);
      const entries = await Promise.all(
        ANIMAL_STATUS_VALUES.map(async (status) => {
          const { count, error } = await applyAnimalFilter(
            client
              .from<{ id?: unknown }>('animals')
              .select('id', { count: 'exact', head: true }),
            filter,
          ).eq('status', status);

          if (error) {
            throw toDataError(error);
          }
          return [status, requireCount(count)] as const;
        }),
      );

      const byStatus = {} as Record<AnimalStatus, number>;
      for (const [status, count] of entries) {
        byStatus[status] = count;
      }
      return byStatus;
    },

    async countAnimalsBySex(filter, accessToken) {
      const client = createClient(accessToken);
      const entries = await Promise.all(
        ANIMAL_SEX_VALUES.map(async (sex) => {
          const { count, error } = await applyAnimalFilter(
            client
              .from<{ id?: unknown }>('animals')
              .select('id', { count: 'exact', head: true }),
            filter,
          ).eq('sex', sex);

          if (error) {
            throw toDataError(error);
          }
          return [sex, requireCount(count)] as const;
        }),
      );

      const bySex = {} as Record<AnimalSex, number>;
      for (const [sex, count] of entries) {
        bySex[sex] = count;
      }
      return bySex;
    },

    async countAnimalsByOrigin(filter, accessToken) {
      const client = createClient(accessToken);
      const entries = await Promise.all(
        ANIMAL_ORIGIN_VALUES.map(async (origin) => {
          const { count, error } = await applyAnimalFilter(
            client
              .from<{ id?: unknown }>('animals')
              .select('id', { count: 'exact', head: true }),
            filter,
          ).eq('origin', origin);

          if (error) {
            throw toDataError(error);
          }
          return [origin, requireCount(count)] as const;
        }),
      );

      const byOrigin = {} as Record<AnimalOrigin, number>;
      for (const [origin, count] of entries) {
        byOrigin[origin] = count;
      }
      return byOrigin;
    },

    async scanPenOccupancy(accessToken) {
      const client = createClient(accessToken);
      const byPen: Record<string, number> = {};
      let housedAnimals = 0;
      let offset = 0;

      // Paginacion acotada: solo se lee `current_pen_id` de los activos.
      for (;;) {
        const { data, error } = await client
          .from<{ current_pen_id?: unknown }>('animals')
          .select('current_pen_id')
          .eq('status', 'active')
          .order('id', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);

        if (error) {
          throw toDataError(error);
        }

        const rows = data ?? [];
        for (const row of rows) {
          const penId = row.current_pen_id;
          if (penId === null) {
            continue;
          }
          if (typeof penId !== 'string') {
            throw new DataAccessError();
          }
          byPen[penId] = (byPen[penId] ?? 0) + 1;
          housedAnimals += 1;
        }

        offset += rows.length;

        if (rows.length < PAGE_SIZE) {
          return { byPen, housedAnimals, truncated: false };
        }
        if (offset >= MAX_PEN_SCAN) {
          return { byPen, housedAnimals, truncated: true };
        }
      }
    },

    async listActivePens(accessToken) {
      const client = createClient(accessToken);
      const { data, error } = await client
        .from<{
          id?: unknown;
          code?: unknown;
          name?: unknown;
          area_id?: unknown;
          capacity?: unknown;
          status?: unknown;
        }>('pens')
        .select('id, code, name, area_id, capacity, status')
        .eq('status', 'active')
        .order('code', { ascending: true })
        .range(0, MAX_PENS - 1);

      if (error) {
        throw toDataError(error);
      }

      return (data ?? []).map((row) => {
        if (
          typeof row.id !== 'string' ||
          typeof row.code !== 'string' ||
          !isNullableString(row.name) ||
          typeof row.area_id !== 'string' ||
          !isNullableInt(row.capacity) ||
          !isLocationStatus(row.status)
        ) {
          throw new DataAccessError();
        }
        return {
          id: row.id,
          code: row.code,
          name: row.name,
          area_id: row.area_id,
          capacity: row.capacity,
          status: row.status,
        };
      });
    },

    async listAreas(accessToken) {
      const client = createClient(accessToken);
      const { data, error } = await client
        .from<{ id?: unknown; name?: unknown }>('areas')
        .select('id, name')
        .order('name', { ascending: true });

      if (error) {
        throw toDataError(error);
      }

      return (data ?? []).map((row) => {
        if (typeof row.id !== 'string' || typeof row.name !== 'string') {
          throw new DataAccessError();
        }
        return { id: row.id, name: row.name };
      });
    },

    async countMovements(range, reason, accessToken) {
      const client = createClient(accessToken);
      let query = client
        .from<{ id?: unknown }>('animal_movements')
        .select('id', { count: 'exact', head: true })
        .gte('moved_at', range.from)
        .lte('moved_at', range.to);

      if (reason) {
        query = query.eq('reason', reason);
      }

      const { count, error } = await query;
      if (error) {
        throw toDataError(error);
      }
      return requireCount(count);
    },

    async countMovementsByReason(range, reason, accessToken) {
      const client = createClient(accessToken);
      const byReason = {} as Record<MovementReason, number>;

      if (reason) {
        // Con un filtro de motivo solo el motivo seleccionado puede ser > 0.
        for (const candidate of MOVEMENT_REASON_VALUES) {
          byReason[candidate] = 0;
        }
        const { count, error } = await client
          .from<{ id?: unknown }>('animal_movements')
          .select('id', { count: 'exact', head: true })
          .gte('moved_at', range.from)
          .lte('moved_at', range.to)
          .eq('reason', reason);

        if (error) {
          throw toDataError(error);
        }
        byReason[reason] = requireCount(count);
        return byReason;
      }

      const entries = await Promise.all(
        MOVEMENT_REASON_VALUES.map(async (candidate) => {
          const { count, error } = await client
            .from<{ id?: unknown }>('animal_movements')
            .select('id', { count: 'exact', head: true })
            .gte('moved_at', range.from)
            .lte('moved_at', range.to)
            .eq('reason', candidate);

          if (error) {
            throw toDataError(error);
          }
          return [candidate, requireCount(count)] as const;
        }),
      );

      for (const [candidate, count] of entries) {
        byReason[candidate] = count;
      }
      return byReason;
    },

    async countHealthEventsByType(range, eventType, accessToken) {
      const client = createClient(accessToken);
      const byType = {} as Record<HealthEventType, number>;

      if (eventType) {
        for (const candidate of HEALTH_EVENT_TYPE_VALUES) {
          byType[candidate] = 0;
        }
        const { count, error } = await client
          .from<{ id?: unknown }>('health_events')
          .select('id', { count: 'exact', head: true })
          .gte('occurred_at', range.from)
          .lte('occurred_at', range.to)
          .eq('event_type', eventType);

        if (error) {
          throw toDataError(error);
        }
        byType[eventType] = requireCount(count);
        return byType;
      }

      const entries = await Promise.all(
        HEALTH_EVENT_TYPE_VALUES.map(async (candidate) => {
          const { count, error } = await client
            .from<{ id?: unknown }>('health_events')
            .select('id', { count: 'exact', head: true })
            .gte('occurred_at', range.from)
            .lte('occurred_at', range.to)
            .eq('event_type', candidate);

          if (error) {
            throw toDataError(error);
          }
          return [candidate, requireCount(count)] as const;
        }),
      );

      for (const [candidate, count] of entries) {
        byType[candidate] = count;
      }
      return byType;
    },

    async scanLitters(range, accessToken) {
      const client = createClient(accessToken);
      const rows: LitterScanRow[] = [];
      let offset = 0;

      for (;;) {
        const { data, error } = await client
          .from<{
            id?: unknown;
            litter_code?: unknown;
            birth_date?: unknown;
            total_born?: unknown;
            born_alive?: unknown;
            stillborn?: unknown;
          }>('litters')
          .select('id, litter_code, birth_date, total_born, born_alive, stillborn')
          .gte('birth_date', range.from)
          .lte('birth_date', range.to)
          .order('birth_date', { ascending: false })
          .order('id', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);

        if (error) {
          throw toDataError(error);
        }

        const page = data ?? [];
        for (const row of page) {
          if (
            typeof row.id !== 'string' ||
            !isNullableString(row.litter_code) ||
            typeof row.birth_date !== 'string' ||
            !isNullableInt(row.total_born) ||
            !isNullableInt(row.born_alive) ||
            !isNullableInt(row.stillborn)
          ) {
            throw new DataAccessError();
          }
          rows.push({
            id: row.id,
            litter_code: row.litter_code,
            birth_date: row.birth_date,
            total_born: row.total_born,
            born_alive: row.born_alive,
            stillborn: row.stillborn,
          });
        }

        offset += page.length;

        if (page.length < PAGE_SIZE) {
          return { rows, truncated: false };
        }
        if (offset >= MAX_LITTER_SCAN) {
          return { rows, truncated: true };
        }
      }
    },
  };
}

/**
 * Valores de los enums del esquema, importados de los modulos comunes (fuente
 * unica de verdad del proyecto): se recorren para contar una vez por valor.
 */
const ANIMAL_STATUS_VALUES = ANIMAL_STATUSES;
const ANIMAL_SEX_VALUES = ANIMAL_SEXES;
const ANIMAL_ORIGIN_VALUES = ANIMAL_ORIGINS;
const MOVEMENT_REASON_VALUES = MOVEMENT_REASONS;
const HEALTH_EVENT_TYPE_VALUES = HEALTH_EVENT_TYPES;

/** Repositorio por defecto (fail-closed): responde 503. */
export function createRejectingReportsRepository(): ReportsRepository {
  return {
    async countAnimalsByStatus() {
      throw new DataAccessError();
    },
    async countAnimalsBySex() {
      throw new DataAccessError();
    },
    async countAnimalsByOrigin() {
      throw new DataAccessError();
    },
    async scanPenOccupancy() {
      throw new DataAccessError();
    },
    async listActivePens() {
      throw new DataAccessError();
    },
    async listAreas() {
      throw new DataAccessError();
    },
    async countMovements() {
      throw new DataAccessError();
    },
    async countMovementsByReason() {
      throw new DataAccessError();
    },
    async countHealthEventsByType() {
      throw new DataAccessError();
    },
    async scanLitters() {
      throw new DataAccessError();
    },
  };
}
