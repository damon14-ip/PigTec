import {
  isAnimalOrigin,
  isAnimalSex,
  isAnimalStatus,
  type AnimalOrigin,
  type AnimalSex,
  type AnimalStatus,
} from '../../common/animal.js';
import { DataAccessError, toDataError } from '../../common/data-errors.js';
import {
  isHealthEventType,
  type HealthEventType,
} from '../../common/health-event.js';
import { isLocationStatus, type LocationStatus } from '../../common/location.js';
import { isMovementReason, type MovementReason } from '../../common/movement.js';
import type {
  PostgrestClientFactory,
  PostgrestQuery,
} from '../../common/postgrest.js';

/**
 * Modelo de LECTURA detallado para las exportaciones (Excel y PDF).
 *
 * Complementa a `reports.repository.ts`, que solo calcula agregados: aqui se
 * leen las FILAS reales que se imprimen en los documentos. Es de SOLO LECTURA
 * (no expone ninguna operacion de escritura) y cada consulta crea un cliente
 * PostgREST por peticion con el JWT verificado, de modo que PostgreSQL aplica
 * RLS con la identidad del usuario (nunca `service_role`).
 *
 * Reglas de volumen:
 * - Cada conjunto se pagina hasta agotarlo o hasta `MAX_EXPORT_ROWS`. Si se
 *   alcanza el tope, `truncated` es `true` y el documento lo indica; NUNCA se
 *   truncan registros en silencio.
 * - Los catalogos (areas y corrales) se acotan con `MAX_EXPORT_CATALOG`.
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

/** Resultado paginado de una exploracion: filas + aviso de truncamiento. */
export interface ExportScan<T> {
  rows: T[];
  /** `true` si se alcanzo el tope y quedan registros sin leer. */
  truncated: boolean;
}

/** Filtros del inventario exportado (los mismos que `GET /animals`). */
export interface ExportAnimalFilter {
  sex?: AnimalSex;
  origin?: AnimalOrigin;
}

export interface ExportAnimalRow {
  id: string;
  animal_code: string;
  ear_tag_code: string | null;
  sex: AnimalSex;
  breed: string | null;
  birth_date: string | null;
  origin: AnimalOrigin | null;
  litter_id: string | null;
  current_pen_id: string | null;
  status: AnimalStatus;
  entry_date: string;
  exit_date: string | null;
}

/** Subconjunto minimo para resolver `id -> animal_code` en otros registros. */
export interface ExportAnimalCodeRow {
  id: string;
  animal_code: string;
  ear_tag_code: string | null;
}

export interface ExportMovementRow {
  id: string;
  animal_id: string;
  from_pen_id: string | null;
  to_pen_id: string | null;
  moved_at: string;
  reason: MovementReason;
  notes: string | null;
}

export interface ExportLitterRow {
  id: string;
  litter_code: string | null;
  mother_id: string | null;
  father_id: string | null;
  birth_date: string | null;
  total_born: number | null;
  born_alive: number | null;
  stillborn: number | null;
}

export interface ExportHealthEventRow {
  id: string;
  animal_id: string;
  event_type: HealthEventType;
  occurred_at: string;
  title: string;
  description: string | null;
  documented_by: string | null;
}

export interface ExportAreaRow {
  id: string;
  name: string;
  description: string | null;
  status: LocationStatus;
}

export interface ExportPenRow {
  id: string;
  area_id: string;
  code: string;
  name: string | null;
  capacity: number | null;
  status: LocationStatus;
}

/** Limite de filas por conjunto exportado (aviso explicito si se alcanza). */
export const MAX_EXPORT_ROWS = 20000;

/** Limite de filas de catalogos (areas y corrales). */
export const MAX_EXPORT_CATALOG = 2000;

/** Tamano de pagina de PostgREST (por debajo del tope por defecto de 1000). */
const PAGE_SIZE = 500;

export interface ReportsExportRepository {
  listAnimals(
    filter: ExportAnimalFilter,
    accessToken: string,
  ): Promise<ExportScan<ExportAnimalRow>>;
  /** Sin filtros: resuelve `id -> codigo` para etiquetar movimientos y camadas. */
  listAnimalCodes(accessToken: string): Promise<ExportScan<ExportAnimalCodeRow>>;
  listMovements(
    range: IsoRange,
    reason: MovementReason | null,
    accessToken: string,
  ): Promise<ExportScan<ExportMovementRow>>;
  listLitters(
    range: CalendarRange,
    accessToken: string,
  ): Promise<ExportScan<ExportLitterRow>>;
  listHealthEvents(
    range: IsoRange,
    eventType: HealthEventType | null,
    accessToken: string,
  ): Promise<ExportScan<ExportHealthEventRow>>;
  listAreas(accessToken: string): Promise<ExportScan<ExportAreaRow>>;
  listPens(accessToken: string): Promise<ExportScan<ExportPenRow>>;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableInt(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value));
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

function mapAnimal(row: Record<string, unknown>): ExportAnimalRow {
  if (
    typeof row.id !== 'string' ||
    typeof row.animal_code !== 'string' ||
    !isNullableString(row.ear_tag_code) ||
    !isAnimalSex(row.sex) ||
    !isNullableString(row.breed) ||
    !isNullableString(row.birth_date) ||
    !(row.origin === null || isAnimalOrigin(row.origin)) ||
    !isNullableString(row.litter_id) ||
    !isNullableString(row.current_pen_id) ||
    !isAnimalStatus(row.status) ||
    typeof row.entry_date !== 'string' ||
    !isNullableString(row.exit_date)
  ) {
    throw new DataAccessError();
  }

  return {
    id: row.id,
    animal_code: row.animal_code,
    ear_tag_code: row.ear_tag_code,
    sex: row.sex,
    breed: row.breed,
    birth_date: row.birth_date,
    origin: row.origin,
    litter_id: row.litter_id,
    current_pen_id: row.current_pen_id,
    status: row.status,
    entry_date: row.entry_date,
    exit_date: row.exit_date,
  };
}

function mapMovement(row: Record<string, unknown>): ExportMovementRow {
  if (
    typeof row.id !== 'string' ||
    typeof row.animal_id !== 'string' ||
    !isNullableString(row.from_pen_id) ||
    !isNullableString(row.to_pen_id) ||
    typeof row.moved_at !== 'string' ||
    !isMovementReason(row.reason) ||
    !isNullableString(row.notes)
  ) {
    throw new DataAccessError();
  }

  return {
    id: row.id,
    animal_id: row.animal_id,
    from_pen_id: row.from_pen_id,
    to_pen_id: row.to_pen_id,
    moved_at: row.moved_at,
    reason: row.reason,
    notes: row.notes,
  };
}

function mapLitter(row: Record<string, unknown>): ExportLitterRow {
  if (
    typeof row.id !== 'string' ||
    !isNullableString(row.litter_code) ||
    !isNullableString(row.mother_id) ||
    !isNullableString(row.father_id) ||
    !isNullableString(row.birth_date) ||
    !isNullableInt(row.total_born) ||
    !isNullableInt(row.born_alive) ||
    !isNullableInt(row.stillborn)
  ) {
    throw new DataAccessError();
  }

  return {
    id: row.id,
    litter_code: row.litter_code,
    mother_id: row.mother_id,
    father_id: row.father_id,
    birth_date: row.birth_date,
    total_born: row.total_born,
    born_alive: row.born_alive,
    stillborn: row.stillborn,
  };
}

function mapHealthEvent(row: Record<string, unknown>): ExportHealthEventRow {
  if (
    typeof row.id !== 'string' ||
    typeof row.animal_id !== 'string' ||
    !isHealthEventType(row.event_type) ||
    typeof row.occurred_at !== 'string' ||
    typeof row.title !== 'string' ||
    !isNullableString(row.description) ||
    !isNullableString(row.documented_by)
  ) {
    throw new DataAccessError();
  }

  return {
    id: row.id,
    animal_id: row.animal_id,
    event_type: row.event_type,
    occurred_at: row.occurred_at,
    title: row.title,
    description: row.description,
    documented_by: row.documented_by,
  };
}

function mapArea(row: Record<string, unknown>): ExportAreaRow {
  if (
    typeof row.id !== 'string' ||
    typeof row.name !== 'string' ||
    !isNullableString(row.description) ||
    !isLocationStatus(row.status)
  ) {
    throw new DataAccessError();
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
  };
}

function mapPen(row: Record<string, unknown>): ExportPenRow {
  if (
    typeof row.id !== 'string' ||
    typeof row.area_id !== 'string' ||
    typeof row.code !== 'string' ||
    !isNullableString(row.name) ||
    !isNullableNumber(row.capacity) ||
    !isLocationStatus(row.status)
  ) {
    throw new DataAccessError();
  }

  return {
    id: row.id,
    area_id: row.area_id,
    code: row.code,
    name: row.name,
    capacity: row.capacity,
    status: row.status,
  };
}

/**
 * Exploracion paginada y acotada de una tabla. `applyFilters` recibe la consulta
 * encadenable y devuelve la version filtrada; `mapRow` valida cada fila.
 */
async function scanTable<TRow>(
  createClient: PostgrestClientFactory,
  accessToken: string,
  table: string,
  columns: string,
  order: readonly { column: string; ascending: boolean }[],
  maxRows: number,
  applyFilters: (
    query: PostgrestQuery<Record<string, unknown>>,
  ) => PostgrestQuery<Record<string, unknown>>,
  mapRow: (row: Record<string, unknown>) => TRow,
): Promise<ExportScan<TRow>> {
  const client = createClient(accessToken);
  const rows: TRow[] = [];
  let offset = 0;

  for (;;) {
    let query = client
      .from<Record<string, unknown>>(table)
      .select(columns);
    query = applyFilters(query);
    for (const key of order) {
      query = query.order(key.column, { ascending: key.ascending });
    }
    query = query.range(offset, offset + PAGE_SIZE - 1);

    const { data, error } = await query;
    if (error) {
      throw toDataError(error);
    }

    const page = data ?? [];
    for (const row of page) {
      rows.push(mapRow(row));
    }
    offset += page.length;

    if (page.length < PAGE_SIZE) {
      return { rows, truncated: false };
    }
    if (offset >= maxRows) {
      return { rows, truncated: true };
    }
  }
}

/**
 * Acceso de lectura detallado para exportaciones. De SOLO LECTURA: no expone
 * operaciones de escritura. Cada metodo crea su cliente con el JWT del usuario.
 */
export function createSupabaseReportsExportRepository(
  createClient: PostgrestClientFactory,
): ReportsExportRepository {
  const identity = (
    query: PostgrestQuery<Record<string, unknown>>,
  ) => query;

  return {
    listAnimals(filter, accessToken) {
      return scanTable(
        createClient,
        accessToken,
        'animals',
        'id, animal_code, ear_tag_code, sex, breed, birth_date, origin, litter_id, current_pen_id, status, entry_date, exit_date',
        [
          { column: 'animal_code', ascending: true },
          { column: 'id', ascending: true },
        ],
        MAX_EXPORT_ROWS,
        (query) => {
          let result = query;
          if (filter.sex) {
            result = result.eq('sex', filter.sex);
          }
          if (filter.origin) {
            result = result.eq('origin', filter.origin);
          }
          return result;
        },
        mapAnimal,
      );
    },

    listAnimalCodes(accessToken) {
      return scanTable(
        createClient,
        accessToken,
        'animals',
        'id, animal_code, ear_tag_code',
        [{ column: 'id', ascending: true }],
        MAX_EXPORT_ROWS,
        identity,
        (row) => {
          if (
            typeof row.id !== 'string' ||
            typeof row.animal_code !== 'string' ||
            !isNullableString(row.ear_tag_code)
          ) {
            throw new DataAccessError();
          }
          return {
            id: row.id,
            animal_code: row.animal_code,
            ear_tag_code: row.ear_tag_code,
          };
        },
      );
    },

    listMovements(range, reason, accessToken) {
      return scanTable(
        createClient,
        accessToken,
        'animal_movements',
        'id, animal_id, from_pen_id, to_pen_id, moved_at, reason, notes',
        [
          { column: 'moved_at', ascending: false },
          { column: 'id', ascending: true },
        ],
        MAX_EXPORT_ROWS,
        (query) => {
          let result = query
            .gte('moved_at', range.from)
            .lte('moved_at', range.to);
          if (reason) {
            result = result.eq('reason', reason);
          }
          return result;
        },
        mapMovement,
      );
    },

    listLitters(range, accessToken) {
      return scanTable(
        createClient,
        accessToken,
        'litters',
        'id, litter_code, mother_id, father_id, birth_date, total_born, born_alive, stillborn',
        [
          { column: 'birth_date', ascending: false },
          { column: 'id', ascending: true },
        ],
        MAX_EXPORT_ROWS,
        (query) =>
          query
            .gte('birth_date', range.from)
            .lte('birth_date', range.to),
        mapLitter,
      );
    },

    listHealthEvents(range, eventType, accessToken) {
      return scanTable(
        createClient,
        accessToken,
        'health_events',
        'id, animal_id, event_type, occurred_at, title, description, documented_by',
        [
          { column: 'occurred_at', ascending: false },
          { column: 'id', ascending: true },
        ],
        MAX_EXPORT_ROWS,
        (query) => {
          let result = query
            .gte('occurred_at', range.from)
            .lte('occurred_at', range.to);
          if (eventType) {
            result = result.eq('event_type', eventType);
          }
          return result;
        },
        mapHealthEvent,
      );
    },

    listAreas(accessToken) {
      return scanTable(
        createClient,
        accessToken,
        'areas',
        'id, name, description, status',
        [{ column: 'name', ascending: true }, { column: 'id', ascending: true }],
        MAX_EXPORT_CATALOG,
        identity,
        mapArea,
      );
    },

    listPens(accessToken) {
      return scanTable(
        createClient,
        accessToken,
        'pens',
        'id, area_id, code, name, capacity, status',
        [{ column: 'code', ascending: true }, { column: 'id', ascending: true }],
        MAX_EXPORT_CATALOG,
        identity,
        mapPen,
      );
    },
  };
}

/** Repositorio por defecto (fail-closed): cualquier lectura responde 503. */
export function createRejectingReportsExportRepository(): ReportsExportRepository {
  return {
    async listAnimals() {
      throw new DataAccessError();
    },
    async listAnimalCodes() {
      throw new DataAccessError();
    },
    async listMovements() {
      throw new DataAccessError();
    },
    async listLitters() {
      throw new DataAccessError();
    },
    async listHealthEvents() {
      throw new DataAccessError();
    },
    async listAreas() {
      throw new DataAccessError();
    },
    async listPens() {
      throw new DataAccessError();
    },
  };
}
