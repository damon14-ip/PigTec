import { ANIMAL_STATUSES, type AnimalStatus } from '../common/animal.js';
import { DataAccessError, toDataError } from '../common/data-errors.js';
import { isLocationStatus, type LocationStatus } from '../common/location.js';
import type { PostgrestClientFactory } from '../common/postgrest.js';

/**
 * Modelo de LECTURA agregado del dashboard.
 *
 * Este repositorio NO corresponde a una tabla del esquema: es un "read model"
 * que combina consultas de solo lectura ya existentes (animals, pens,
 * animal_movements, health_events, litters) para calcular los indicadores del
 * panel sin descargar filas al navegador.
 *
 * Reglas de la etapa S5-B:
 * - Se usan SIEMPRE conteos exactos de PostgREST (`count: 'exact', head: true`)
 *   para no traer registros completos.
 * - La unica lectura con filas es la exploracion acotada de `current_pen_id`
 *   de los porcinos activos, necesaria para contar CORRALES OCUPADOS distintos
 *   (PostgREST no permite `DISTINCT` sin un RPC/vista, que no se puede crear en
 *   esta etapa). Se pagina y se limita (`MAX_PEN_SCAN`); si se alcanza el
 *   limite, el resultado se marca como parcial y NUNCA se presenta como exacto.
 * - Ningun calculo depende de datos ficticios: valores fuera de los enums se
 *   rechazan como fallo de datos (503).
 */

/** Corral minimo necesario para calcular ocupacion y capacidad. */
export interface DashboardPen {
  id: string;
  capacity: number | null;
  status: LocationStatus;
}

/** Rango de fechas inclusivo, en ISO 8601 (para `timestamptz`). */
export interface IsoRange {
  from: string;
  to: string;
}

/**
 * Limite de corrales activos que se listan para sumar capacidad. Un numero
 * mayor se considera fuera de alcance y se marca como parcial.
 */
export const MAX_PENS = 1000;

/**
 * Limite de porcinos activos explorados para contar corrales ocupados.
 * Evita un escaneo sin cota y se alinea con el tamano previsto de la granja.
 */
export const MAX_PEN_SCAN = 10000;

/**
 * Tamano de pagina de PostgREST. Supabase limita por defecto a 1000 filas por
 * peticion; se usa un valor menor y estable.
 */
const PAGE_SIZE = 500;

/** Resultado de la exploracion de corrales ocupados. */
export interface HousedAnimalPenScan {
  /** Ids DISTINTOS de corral con al menos un porcino activo alojado. */
  penIds: string[];
  /** Numero de porcinos activos con corral asignado. */
  housedAnimals: number;
  /** `true` si se alcanzo `MAX_PEN_SCAN`: el conteo es parcial, no exacto. */
  truncated: boolean;
}

export interface DashboardRepository {
  /** Conteo exacto de porcinos por cada estado del enum `animal_status`. */
  countAnimalsByStatus(
    accessToken: string,
  ): Promise<Record<AnimalStatus, number>>;
  /** Exploracion acotada de los corrales ocupados por porcinos activos. */
  scanHousedAnimalPens(accessToken: string): Promise<HousedAnimalPenScan>;
  /** Corrales ACTIVOS (id, capacidad, estado) para ocupacion y capacidad. */
  listActivePens(accessToken: string): Promise<DashboardPen[]>;
  /** Conteo exacto de movimientos cuyo `moved_at` cae en el rango. */
  countMovements(range: IsoRange, accessToken: string): Promise<number>;
  /** Conteo exacto de eventos sanitarios cuyo `occurred_at` cae en el rango. */
  countHealthEvents(range: IsoRange, accessToken: string): Promise<number>;
  /** Conteo exacto de camadas; si `range` es `null`, cuenta todas. */
  countLitters(
    range: { from: string; to: string } | null,
    accessToken: string,
  ): Promise<number>;
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

/**
 * Acceso de lectura agregado. Cada operacion crea un cliente PostgREST por
 * peticion con el JWT verificado, de modo que PostgreSQL aplica RLS con la
 * identidad del usuario (nunca `service_role`).
 */
export function createSupabaseDashboardRepository(
  createClient: PostgrestClientFactory,
): DashboardRepository {
  return {
    async countAnimalsByStatus(accessToken) {
      const client = createClient(accessToken);

      // Un conteo exacto por estado (sin descargar filas), en paralelo.
      const entries = await Promise.all(
        ANIMAL_STATUSES.map(async (status) => {
          const { count, error } = await client
            .from<{ id?: unknown }>('animals')
            .select('id', { count: 'exact', head: true })
            .eq('status', status);

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

    async scanHousedAnimalPens(accessToken) {
      const client = createClient(accessToken);
      const penIds = new Set<string>();
      let housedAnimals = 0;
      let from = 0;

      // Paginacion acotada: solo se lee `current_pen_id` de los activos.
      for (;;) {
        const { data, error } = await client
          .from<{ current_pen_id?: unknown }>('animals')
          .select('current_pen_id')
          .eq('status', 'active')
          .order('id', { ascending: true })
          .range(from, from + PAGE_SIZE - 1);

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
          penIds.add(penId);
          housedAnimals += 1;
        }

        from += rows.length;

        if (rows.length < PAGE_SIZE) {
          return { penIds: [...penIds], housedAnimals, truncated: false };
        }
        if (from >= MAX_PEN_SCAN) {
          return { penIds: [...penIds], housedAnimals, truncated: true };
        }
      }
    },

    async listActivePens(accessToken) {
      const client = createClient(accessToken);
      const { data, error } = await client
        .from<{ id?: unknown; capacity?: unknown; status?: unknown }>('pens')
        .select('id, capacity, status')
        .eq('status', 'active')
        .order('code', { ascending: true })
        .range(0, MAX_PENS - 1);

      if (error) {
        throw toDataError(error);
      }

      return (data ?? []).map((row) => {
        if (
          typeof row.id !== 'string' ||
          !isNullableInt(row.capacity) ||
          !isLocationStatus(row.status)
        ) {
          throw new DataAccessError();
        }
        return { id: row.id, capacity: row.capacity, status: row.status };
      });
    },

    async countMovements(range, accessToken) {
      const client = createClient(accessToken);
      const { count, error } = await client
        .from<{ id?: unknown }>('animal_movements')
        .select('id', { count: 'exact', head: true })
        .gte('moved_at', range.from)
        .lte('moved_at', range.to);

      if (error) {
        throw toDataError(error);
      }
      return requireCount(count);
    },

    async countHealthEvents(range, accessToken) {
      const client = createClient(accessToken);
      const { count, error } = await client
        .from<{ id?: unknown }>('health_events')
        .select('id', { count: 'exact', head: true })
        .gte('occurred_at', range.from)
        .lte('occurred_at', range.to);

      if (error) {
        throw toDataError(error);
      }
      return requireCount(count);
    },

    async countLitters(range, accessToken) {
      const client = createClient(accessToken);
      let query = client
        .from<{ id?: unknown }>('litters')
        .select('id', { count: 'exact', head: true });

      if (range) {
        query = query.gte('birth_date', range.from).lte('birth_date', range.to);
      }

      const { count, error } = await query;
      if (error) {
        throw toDataError(error);
      }
      return requireCount(count);
    },
  };
}

/** Repositorio por defecto (fail-closed): responde 503. */
export function createRejectingDashboardRepository(): DashboardRepository {
  return {
    async countAnimalsByStatus() {
      throw new DataAccessError();
    },
    async scanHousedAnimalPens() {
      throw new DataAccessError();
    },
    async listActivePens() {
      throw new DataAccessError();
    },
    async countMovements() {
      throw new DataAccessError();
    },
    async countHealthEvents() {
      throw new DataAccessError();
    },
    async countLitters() {
      throw new DataAccessError();
    },
  };
}
