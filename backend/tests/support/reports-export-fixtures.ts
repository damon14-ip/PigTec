import { vi } from 'vitest';
import type { ReportsSummary } from '../../src/modules/reports/reports.service.js';
import type {
  ExportAnimalCodeRow,
  ExportAnimalRow,
  ExportAreaRow,
  ExportHealthEventRow,
  ExportLitterRow,
  ExportMovementRow,
  ExportPenRow,
  ExportScan,
  ReportsExportRepository,
} from '../../src/modules/reports/export/export.repository.js';

/**
 * Fixtures compartidas por las pruebas de exportacion (S5-E2).
 *
 * Son datos FICTICIOS de prueba (nunca de la base real) que reproducen el
 * contrato exacto del repositorio de exportacion y del resumen de reportes. Dos
 * valores incluyen formulas (`=1+1`, `@SUM(A1)`) para comprobar el saneado
 * anti-inyeccion en el Excel.
 */

export const EXPORT_TOKEN = 'jwt-operator';

export const ANIMALS: ExportAnimalRow[] = [
  {
    id: 'a1',
    animal_code: 'PIG-000001',
    ear_tag_code: 'AR-1',
    sex: 'female',
    breed: 'Landrace',
    birth_date: '2026-01-10',
    origin: 'born_on_farm',
    litter_id: 'l1',
    current_pen_id: 'p1',
    status: 'active',
    entry_date: '2026-01-10',
    exit_date: null,
  },
  {
    id: 'a2',
    animal_code: 'PIG-000002',
    ear_tag_code: null,
    sex: 'male',
    breed: '=1+1',
    birth_date: null,
    origin: 'purchased',
    litter_id: null,
    current_pen_id: null,
    status: 'sold',
    entry_date: '2026-02-01',
    exit_date: '2026-06-01',
  },
];

export const ANIMAL_CODES: ExportAnimalCodeRow[] = [
  { id: 'a1', animal_code: 'PIG-000001', ear_tag_code: 'AR-1' },
  { id: 'a2', animal_code: 'PIG-000002', ear_tag_code: null },
];

export const MOVEMENTS: ExportMovementRow[] = [
  {
    id: 'm1',
    animal_id: 'a1',
    from_pen_id: 'p1',
    to_pen_id: 'p2',
    moved_at: '2026-06-15T08:30:00.000Z',
    reason: 'weaning',
    notes: '@SUM(A1)',
  },
  {
    id: 'm2',
    animal_id: 'a2',
    from_pen_id: 'p2',
    to_pen_id: null,
    moved_at: '2026-06-20T09:00:00.000Z',
    reason: 'sale',
    notes: null,
  },
];

export const LITTERS: ExportLitterRow[] = [
  {
    id: 'l1',
    litter_code: 'CAM-2026-001',
    mother_id: 'a1',
    father_id: 'padre-desconocido',
    birth_date: '2026-03-01',
    total_born: 12,
    born_alive: 10,
    stillborn: 2,
  },
  {
    id: 'l2',
    litter_code: null,
    mother_id: null,
    father_id: null,
    birth_date: null,
    total_born: null,
    born_alive: null,
    stillborn: null,
  },
];

export const HEALTH_EVENTS: ExportHealthEventRow[] = [
  {
    id: 'h1',
    animal_id: 'a1',
    event_type: 'treatment',
    occurred_at: '2026-07-01T10:00:00.000Z',
    title: '=HYPERLINK("http://malicioso")',
    description: 'Tratamiento aplicado',
    documented_by: 'veterinario-1',
  },
];

export const AREAS: ExportAreaRow[] = [
  { id: 'ar1', name: 'Gestación', description: null, status: 'active' },
  { id: 'ar2', name: 'Cuarentena', description: null, status: 'inactive' },
];

export const PENS: ExportPenRow[] = [
  { id: 'p1', area_id: 'ar1', code: 'C-1', name: null, capacity: 10, status: 'active' },
  { id: 'p2', area_id: 'ar1', code: 'C-2', name: 'Corral 2', capacity: null, status: 'inactive' },
];

/** Resumen de reportes de prueba (forma exacta de `ReportsSummary`). */
export function makeSummary(
  overrides: Partial<ReportsSummary> = {},
): ReportsSummary {
  return {
    generatedAt: '2026-10-18T12:34:56.000Z',
    period: {
      from: '2026-05-01',
      to: '2026-10-18',
      fromIso: '2026-05-01T00:00:00.000Z',
      toIso: '2026-10-18T23:59:59.999Z',
      months: ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'],
      maxMonths: 12,
    },
    filters: {
      movementReason: null,
      healthEventType: null,
      sex: null,
      origin: null,
    },
    animals: {
      total: 2,
      byStatus: [
        { value: 'active', count: 1 },
        { value: 'sold', count: 1 },
      ],
      bySex: [
        { value: 'female', count: 1 },
        { value: 'male', count: 1 },
      ],
      byOrigin: [
        { value: 'born_on_farm', count: 1 },
        { value: 'purchased', count: 1 },
      ],
    },
    pens: {
      total: 2,
      occupied: 1,
      occupancyRate: 0.5,
      capacity: {
        registered: true,
        total: 10,
        housedAnimals: 1,
        usageRate: 0.1,
        partial: false,
      },
      truncated: false,
      byPen: [
        {
          id: 'p1',
          code: 'C-1',
          name: null,
          area_name: 'Gestación',
          capacity: 10,
          occupants: 1,
          usageRate: 0.1,
        },
      ],
    },
    movements: {
      total: 2,
      byMonth: [{ month: '2026-06', count: 2 }],
      byReason: [{ value: 'weaning', count: 1 }],
    },
    litters: {
      total: 2,
      truncated: false,
      complete: false,
      totalBorn: 12,
      bornAlive: 10,
      stillborn: 2,
      averageBornAlive: null,
      recent: [],
    },
    healthEvents: {
      total: 1,
      byType: [{ value: 'treatment', count: 1 }],
    },
    ...overrides,
  };
}

export interface FakeExportOptions {
  animals?: ExportScan<ExportAnimalRow>;
  animalCodes?: ExportScan<ExportAnimalCodeRow>;
  movements?: ExportScan<ExportMovementRow>;
  litters?: ExportScan<ExportLitterRow>;
  healthEvents?: ExportScan<ExportHealthEventRow>;
  areas?: ExportScan<ExportAreaRow>;
  pens?: ExportScan<ExportPenRow>;
}

function scan<T>(rows: T[], truncated = false): ExportScan<T> {
  return { rows, truncated };
}

/** Repositorio de exportacion de prueba: registra llamadas y devuelve filas. */
export function makeExportRepository(
  options: FakeExportOptions = {},
): ReportsExportRepository {
  return {
    listAnimals: vi.fn(async () => options.animals ?? scan(ANIMALS)),
    listAnimalCodes: vi.fn(
      async () => options.animalCodes ?? scan(ANIMAL_CODES),
    ),
    listMovements: vi.fn(async () => options.movements ?? scan(MOVEMENTS)),
    listLitters: vi.fn(async () => options.litters ?? scan(LITTERS)),
    listHealthEvents: vi.fn(
      async () => options.healthEvents ?? scan(HEALTH_EVENTS),
    ),
    listAreas: vi.fn(async () => options.areas ?? scan(AREAS)),
    listPens: vi.fn(async () => options.pens ?? scan(PENS)),
  };
}
