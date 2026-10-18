import { describe, expect, it, vi } from 'vitest';
import {
  ANIMAL_ORIGINS,
  ANIMAL_SEXES,
  ANIMAL_STATUSES,
  type AnimalOrigin,
  type AnimalSex,
  type AnimalStatus,
} from '../src/modules/common/animal.js';
import { ValidationError } from '../src/modules/common/data-errors.js';
import {
  HEALTH_EVENT_TYPES,
  type HealthEventType,
} from '../src/modules/common/health-event.js';
import {
  MOVEMENT_REASONS,
  type MovementReason,
} from '../src/modules/common/movement.js';
import type {
  LitterScanRow,
  ReportArea,
  ReportPen,
  ReportsRepository,
} from '../src/modules/reports/reports.repository.js';
import {
  createReportsService,
  REPORTS_DEFAULT_MONTHS,
  REPORTS_MAX_MONTHS,
} from '../src/modules/reports/reports.service.js';

const TOKEN = 'jwt-operator';
const NOW = new Date('2026-10-18T12:00:00.000Z');

interface FakeOptions {
  statusCounts?: Partial<Record<AnimalStatus, number>>;
  sexCounts?: Partial<Record<AnimalSex, number>>;
  originCounts?: Partial<Record<AnimalOrigin, number>>;
  pens?: ReportPen[];
  areas?: ReportArea[];
  byPen?: Record<string, number>;
  penScanTruncated?: boolean;
  /** Conteo por `range.from` (instante ISO) de la serie mensual. */
  movementCounts?: Record<string, number>;
  reasonCounts?: Partial<Record<MovementReason, number>>;
  typeCounts?: Partial<Record<HealthEventType, number>>;
  litters?: LitterScanRow[];
  littersTruncated?: boolean;
}

function fill<T extends string>(
  keys: readonly T[],
  values: Partial<Record<T, number>> | undefined,
): Record<T, number> {
  const record = {} as Record<T, number>;
  for (const key of keys) {
    record[key] = values?.[key] ?? 0;
  }
  return record;
}

function makeRepository(options: FakeOptions = {}): ReportsRepository {
  const movementCounts = options.movementCounts ?? {};
  return {
    countAnimalsByStatus: vi.fn(async () =>
      fill(ANIMAL_STATUSES, options.statusCounts),
    ),
    countAnimalsBySex: vi.fn(async () => fill(ANIMAL_SEXES, options.sexCounts)),
    countAnimalsByOrigin: vi.fn(async () =>
      fill(ANIMAL_ORIGINS, options.originCounts),
    ),
    scanPenOccupancy: vi.fn(async () => ({
      byPen: options.byPen ?? {},
      housedAnimals: Object.values(options.byPen ?? {}).reduce(
        (sum, value) => sum + value,
        0,
      ),
      truncated: options.penScanTruncated ?? false,
    })),
    listActivePens: vi.fn(async () => options.pens ?? []),
    listAreas: vi.fn(async () => options.areas ?? []),
    countMovements: vi.fn(async (range: { from: string }) =>
      movementCounts[range.from] ?? 0,
    ),
    countMovementsByReason: vi.fn(
      async (_range: unknown, reason: MovementReason | null) =>
        reason
          ? {
              ...fill(MOVEMENT_REASONS, {}),
              [reason]: movementCounts.__reason ?? 0,
            }
          : fill(MOVEMENT_REASONS, options.reasonCounts),
    ),
    countHealthEventsByType: vi.fn(
      async (_range: unknown, eventType: HealthEventType | null) =>
        eventType
          ? {
              ...fill(HEALTH_EVENT_TYPES, {}),
              [eventType]: options.typeCounts?.[eventType] ?? 0,
            }
          : fill(HEALTH_EVENT_TYPES, options.typeCounts),
    ),
    scanLitters: vi.fn(async () => ({
      rows: options.litters ?? [],
      truncated: options.littersTruncated ?? false,
    })),
  };
}

function makeService(repository: ReportsRepository) {
  return createReportsService(repository, { now: () => NOW });
}

describe('reports.service: base de datos vacia', () => {
  it('devuelve ceros confirmados y metricas no calculables como null', async () => {
    const repository = makeRepository();
    const summary = await makeService(repository).getSummary({}, TOKEN);

    expect(summary.animals.total).toBe(0);
    expect(summary.animals.byStatus).toEqual(
      ANIMAL_STATUSES.map((status) => ({ value: status, count: 0 })),
    );
    expect(summary.animals.bySex).toEqual(
      ANIMAL_SEXES.map((sex) => ({ value: sex, count: 0 })),
    );
    expect(summary.animals.byOrigin).toEqual([
      ...ANIMAL_ORIGINS.map((origin) => ({ value: origin, count: 0 })),
      { value: null, count: 0 },
    ]);

    // Sin corrales: la ocupacion no es calculable (nunca 0%).
    expect(summary.pens.total).toBe(0);
    expect(summary.pens.occupied).toBe(0);
    expect(summary.pens.occupancyRate).toBeNull();
    expect(summary.pens.capacity.registered).toBe(false);
    expect(summary.pens.capacity.total).toBeNull();
    expect(summary.pens.capacity.usageRate).toBeNull();
    expect(summary.pens.capacity.partial).toBe(false);
    expect(summary.pens.truncated).toBe(false);
    expect(summary.pens.byPen).toEqual([]);

    expect(summary.movements.total).toBe(0);
    expect(summary.movements.byMonth.every((item) => item.count === 0)).toBe(
      true,
    );
    expect(summary.movements.byReason).toEqual(
      MOVEMENT_REASONS.map((reason) => ({ value: reason, count: 0 })),
    );

    expect(summary.litters.total).toBe(0);
    expect(summary.litters.totalBorn).toBeNull();
    expect(summary.litters.bornAlive).toBeNull();
    expect(summary.litters.stillborn).toBeNull();
    expect(summary.litters.averageBornAlive).toBeNull();
    expect(summary.litters.recent).toEqual([]);

    expect(summary.healthEvents.total).toBe(0);
    expect(summary.healthEvents.byType).toEqual(
      HEALTH_EVENT_TYPES.map((type) => ({ value: type, count: 0 })),
    );

    expect(summary.filters).toEqual({
      movementReason: null,
      healthEventType: null,
      sex: null,
      origin: null,
    });
  });

  it('aplica un periodo por defecto de seis meses que termina hoy (UTC)', async () => {
    const repository = makeRepository();
    const summary = await makeService(repository).getSummary({}, TOKEN);

    expect(REPORTS_DEFAULT_MONTHS).toBe(6);
    expect(summary.period.from).toBe('2026-05-01');
    expect(summary.period.to).toBe('2026-10-18');
    expect(summary.period.months).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(summary.period.fromIso).toBe('2026-05-01T00:00:00.000Z');
    expect(summary.period.toIso).toBe('2026-10-18T23:59:59.999Z');
    expect(summary.period.maxMonths).toBe(REPORTS_MAX_MONTHS);
    expect(summary.generatedAt).toBe(NOW.toISOString());
  });
});

describe('reports.service: distribucion de porcinos', () => {
  it('agrupa por estado, sexo y origen (incluido el no registrado)', async () => {
    const repository = makeRepository({
      statusCounts: { active: 12, sold: 3, dead: 1, inactive: 4 },
      sexCounts: { male: 5, female: 10, unknown: 5 },
      originCounts: { born_on_farm: 12, purchased: 5 },
    });
    const summary = await makeService(repository).getSummary({}, TOKEN);

    expect(summary.animals.total).toBe(20);
    expect(summary.animals.byStatus).toEqual([
      { value: 'active', count: 12 },
      { value: 'sold', count: 3 },
      { value: 'dead', count: 1 },
      { value: 'transferred_out', count: 0 },
      { value: 'missing', count: 0 },
      { value: 'inactive', count: 4 },
    ]);
    expect(summary.animals.bySex).toEqual([
      { value: 'male', count: 5 },
      { value: 'female', count: 10 },
      { value: 'unknown', count: 5 },
    ]);
    // 20 totales, 17 con origen canonico: 3 sin registrar (derivado, no contado).
    expect(summary.animals.byOrigin).toEqual([
      { value: 'born_on_farm', count: 12 },
      { value: 'purchased', count: 5 },
      { value: 'transferred_in', count: 0 },
      { value: 'unknown', count: 0 },
      { value: null, count: 3 },
    ]);
  });

  it('propaga los filtros de inventario al repositorio (mismos de GET /animals)', async () => {
    const repository = makeRepository();
    await makeService(repository).getSummary(
      {
        sex: 'female',
        origin: 'purchased',
        movement_reason: 'sale',
        health_event_type: 'treatment',
        from: '2026-01-01',
        to: '2026-03-31',
      },
      TOKEN,
    );

    expect(repository.countAnimalsByStatus).toHaveBeenCalledWith(
      { sex: 'female', origin: 'purchased' },
      TOKEN,
    );
    expect(repository.countAnimalsBySex).toHaveBeenCalledWith(
      { sex: 'female', origin: 'purchased' },
      TOKEN,
    );
    expect(repository.countAnimalsByOrigin).toHaveBeenCalledWith(
      { sex: 'female', origin: 'purchased' },
      TOKEN,
    );
  });
});

describe('reports.service: ocupacion de corrales', () => {
  const pens: ReportPen[] = [
    { id: 'p1', code: 'C-1', name: null, area_id: 'a1', capacity: 10, status: 'active' },
    { id: 'p2', code: 'C-2', name: 'Corral 2', area_id: 'a1', capacity: 10, status: 'active' },
    { id: 'p3', code: 'C-3', name: null, area_id: 'a2', capacity: null, status: 'active' },
  ];
  const areas: ReportArea[] = [
    { id: 'a1', name: 'Gestación' },
    { id: 'a2', name: 'Engorde' },
  ];

  it('construye la tabla por corral y calcula ocupacion', async () => {
    const repository = makeRepository({
      pens,
      areas,
      byPen: { p1: 8, p3: 2 },
    });
    const summary = await makeService(repository).getSummary({}, TOKEN);

    expect(summary.pens.total).toBe(3);
    expect(summary.pens.occupied).toBe(2);
    expect(summary.pens.occupancyRate).toBeCloseTo(2 / 3);
    expect(summary.pens.truncated).toBe(false);
    expect(summary.pens.byPen).toEqual([
      {
        id: 'p1',
        code: 'C-1',
        name: null,
        area_name: 'Gestación',
        capacity: 10,
        occupants: 8,
        usageRate: 0.8,
      },
      {
        id: 'p2',
        code: 'C-2',
        name: 'Corral 2',
        area_name: 'Gestación',
        capacity: 10,
        occupants: 0,
        usageRate: 0,
      },
      {
        id: 'p3',
        code: 'C-3',
        name: null,
        area_name: 'Engorde',
        capacity: null,
        occupants: 2,
        usageRate: null,
      },
    ]);
  });

  it('con capacidad incompleta no presenta un porcentaje de utilizacion', async () => {
    const repository = makeRepository({ pens, areas, byPen: { p1: 8 } });
    const summary = await makeService(repository).getSummary({}, TOKEN);

    expect(summary.pens.capacity.registered).toBe(true);
    expect(summary.pens.capacity.total).toBe(20);
    expect(summary.pens.capacity.housedAnimals).toBe(8);
    expect(summary.pens.capacity.partial).toBe(true);
    expect(summary.pens.capacity.usageRate).toBeNull();
  });

  it('con capacidad completa calcula la utilizacion real', async () => {
    const completePens: ReportPen[] = pens.map((pen) => ({
      ...pen,
      capacity: pen.capacity ?? 5,
    }));
    const repository = makeRepository({
      pens: completePens,
      areas,
      byPen: { p1: 8, p3: 2 },
    });
    const summary = await makeService(repository).getSummary({}, TOKEN);

    expect(summary.pens.capacity.partial).toBe(false);
    expect(summary.pens.capacity.total).toBe(25);
    expect(summary.pens.capacity.housedAnimals).toBe(10);
    expect(summary.pens.capacity.usageRate).toBeCloseTo(0.4);
  });

  it('con exploracion truncada la ocupacion y la tabla quedan no calculables', async () => {
    const repository = makeRepository({
      pens,
      areas,
      byPen: { p1: 8 },
      penScanTruncated: true,
    });
    const summary = await makeService(repository).getSummary({}, TOKEN);

    expect(summary.pens.truncated).toBe(true);
    expect(summary.pens.occupied).toBeNull();
    expect(summary.pens.occupancyRate).toBeNull();
    expect(summary.pens.capacity.housedAnimals).toBeNull();
    expect(summary.pens.capacity.usageRate).toBeNull();
    expect(summary.pens.byPen).toEqual([]);
  });

  it('ignora los ocupantes de corrales no activos (no aparecen en la lista)', async () => {
    const repository = makeRepository({
      pens: [pens[0]],
      areas,
      byPen: { p1: 8, 'p-inactivo': 5 },
    });
    const summary = await makeService(repository).getSummary({}, TOKEN);

    expect(summary.pens.capacity.housedAnimals).toBe(8);
    expect(summary.pens.byPen).toHaveLength(1);
  });
});

describe('reports.service: movimientos del periodo', () => {
  it('recorta cada mes a los limites del periodo (sin doble conteo)', async () => {
    const repository = makeRepository({
      movementCounts: {
        '2026-03-15T00:00:00.000Z': 4,
        '2026-04-01T00:00:00.000Z': 3,
      },
    });
    const summary = await makeService(repository).getSummary(
      { from: '2026-03-15', to: '2026-04-10' },
      TOKEN,
    );

    expect(repository.countMovements).toHaveBeenNthCalledWith(
      1,
      { from: '2026-03-15T00:00:00.000Z', to: '2026-03-31T23:59:59.999Z' },
      null,
      TOKEN,
    );
    expect(repository.countMovements).toHaveBeenNthCalledWith(
      2,
      { from: '2026-04-01T00:00:00.000Z', to: '2026-04-10T23:59:59.999Z' },
      null,
      TOKEN,
    );
    expect(summary.movements.byMonth).toEqual([
      { month: '2026-03', count: 4 },
      { month: '2026-04', count: 3 },
    ]);
    expect(summary.movements.total).toBe(7);
  });

  it('con filtro de motivo solo el motivo elegido puede ser > 0', async () => {
    const repository = makeRepository({
      movementCounts: { __reason: 5 },
    });
    const summary = await makeService(repository).getSummary(
      { movement_reason: 'sale' },
      TOKEN,
    );

    const nonZero = summary.movements.byReason.filter((item) => item.count > 0);
    expect(nonZero).toEqual([{ value: 'sale', count: 5 }]);
    expect(summary.filters.movementReason).toBe('sale');
  });

  it('desglosa todos los motivos del periodo por defecto', async () => {
    const reasonCounts: Partial<Record<MovementReason, number>> = {
      weaning: 2,
      sale: 1,
      other: 3,
    };
    const repository = makeRepository({ reasonCounts });
    const summary = await makeService(repository).getSummary({}, TOKEN);

    expect(summary.movements.byReason).toEqual(
      MOVEMENT_REASONS.map((reason) => ({
        value: reason,
        count: reasonCounts[reason] ?? 0,
      })),
    );
  });
});

describe('reports.service: camadas y nacimientos', () => {
  function litter(overrides: Partial<LitterScanRow> = {}): LitterScanRow {
    return {
      id: 'l1',
      litter_code: 'CAM-1',
      birth_date: '2026-09-10',
      total_born: 10,
      born_alive: 8,
      stillborn: 2,
      ...overrides,
    };
  }

  it('suma nacimientos cuando todas las camadas traen conteos', async () => {
    const repository = makeRepository({
      litters: [
        litter({ id: 'l1', total_born: 10, born_alive: 8, stillborn: 2 }),
        litter({ id: 'l2', total_born: 6, born_alive: 6, stillborn: 0 }),
      ],
    });
    const summary = await makeService(repository).getSummary(
      { from: '2026-09-01', to: '2026-09-30' },
      TOKEN,
    );

    expect(summary.litters.total).toBe(2);
    expect(summary.litters.complete).toBe(true);
    expect(summary.litters.totalBorn).toBe(16);
    expect(summary.litters.bornAlive).toBe(14);
    expect(summary.litters.stillborn).toBe(2);
    expect(summary.litters.averageBornAlive).toBeCloseTo(7);
    expect(summary.litters.recent).toHaveLength(2);
  });

  it('marca el periodo como incompleto si falta algun conteo y no promedia', async () => {
    const repository = makeRepository({
      litters: [
        litter({ id: 'l1', total_born: 10, born_alive: 8, stillborn: 2 }),
        litter({ id: 'l2', total_born: null, born_alive: null, stillborn: null }),
      ],
    });
    const summary = await makeService(repository).getSummary({}, TOKEN);

    expect(summary.litters.total).toBe(2);
    expect(summary.litters.complete).toBe(false);
    expect(summary.litters.totalBorn).toBe(10);
    expect(summary.litters.bornAlive).toBe(8);
    expect(summary.litters.stillborn).toBe(2);
    expect(summary.litters.averageBornAlive).toBeNull();
  });

  it('con exploracion truncada las sumas son parciales', async () => {
    const repository = makeRepository({
      litters: [litter()],
      littersTruncated: true,
    });
    const summary = await makeService(repository).getSummary({}, TOKEN);

    expect(summary.litters.truncated).toBe(true);
    expect(summary.litters.complete).toBe(false);
    expect(summary.litters.averageBornAlive).toBeNull();
  });

  it('consulta las camadas con el rango de fechas del periodo', async () => {
    const repository = makeRepository();
    await makeService(repository).getSummary(
      { from: '2026-02-01', to: '2026-02-28' },
      TOKEN,
    );

    expect(repository.scanLitters).toHaveBeenCalledWith(
      { from: '2026-02-01', to: '2026-02-28' },
      TOKEN,
    );
  });
});

describe('reports.service: validacion del periodo', () => {
  it('rechaza un periodo invertido', async () => {
    const repository = makeRepository();
    await expect(
      makeService(repository).getSummary(
        { from: '2026-05-02', to: '2026-05-01' },
        TOKEN,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rechaza un periodo mayor que el maximo de meses', async () => {
    const repository = makeRepository();
    await expect(
      makeService(repository).getSummary(
        { from: '2024-01-01', to: '2026-01-01' },
        TOKEN,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(REPORTS_MAX_MONTHS).toBe(12);
  });

  it('acepta exactamente el maximo de meses', async () => {
    const repository = makeRepository();
    const summary = await makeService(repository).getSummary(
      { from: '2025-11-01', to: '2026-10-01' },
      TOKEN,
    );
    expect(summary.period.months).toHaveLength(REPORTS_MAX_MONTHS);
  });
});

describe('reports.service: propagacion de fallos', () => {
  it('propaga el fallo del repositorio (los reportes no inventan cifras)', async () => {
    const repository = makeRepository();
    repository.countAnimalsByStatus = vi.fn(async () => {
      throw new Error('fallo de datos');
    });

    await expect(makeService(repository).getSummary({}, TOKEN)).rejects.toThrow(
      'fallo de datos',
    );
  });
});
