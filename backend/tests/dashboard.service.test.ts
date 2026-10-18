import { describe, expect, it, vi } from 'vitest';
import { ANIMAL_STATUSES } from '../src/modules/common/animal.js';
import type {
  DashboardPen,
  DashboardRepository,
  HousedAnimalPenScan,
} from '../src/modules/dashboard/dashboard.repository.js';
import {
  createDashboardService,
  MOVEMENTS_MONTHS_WINDOW,
} from '../src/modules/dashboard/dashboard.service.js';

const TOKEN = 'jwt-operator';
const NOW = new Date('2026-10-18T12:00:00.000Z');

/** Clave `YYYY-MM` de un instante ISO. */
function keyOf(iso: string): string {
  return iso.slice(0, 7);
}

interface FakeOptions {
  statusCounts?: Partial<Record<string, number>>;
  pens?: DashboardPen[];
  scan?: HousedAnimalPenScan;
  /** Conteo de movimientos por mes `YYYY-MM`. */
  movementsByMonth?: Record<string, number>;
  healthEvents?: number;
  littersTotal?: number;
  littersMonth?: number;
}

function makeRepository(options: FakeOptions = {}): DashboardRepository {
  const statusCounts = options.statusCounts ?? {};
  const pens = options.pens ?? [];
  const scan = options.scan ?? {
    penIds: [],
    housedAnimals: 0,
    truncated: false,
  };
  const movementsByMonth = options.movementsByMonth ?? {};

  return {
    countAnimalsByStatus: vi.fn(async () => {
      const record = {} as Record<string, number>;
      for (const status of ANIMAL_STATUSES) {
        record[status] = statusCounts[status] ?? 0;
      }
      return record as Awaited<
        ReturnType<DashboardRepository['countAnimalsByStatus']>
      >;
    }),
    scanHousedAnimalPens: vi.fn(async () => scan),
    listActivePens: vi.fn(async () => pens),
    countMovements: vi.fn(async (range) => movementsByMonth[keyOf(range.from)] ?? 0),
    countHealthEvents: vi.fn(async () => options.healthEvents ?? 0),
    countLitters: vi.fn(async (range) =>
      range === null ? (options.littersTotal ?? 0) : (options.littersMonth ?? 0),
    ),
  };
}

function makeService(repository: DashboardRepository) {
  return createDashboardService(repository, { now: () => NOW });
}

describe('dashboard.service: base de datos vacia', () => {
  it('devuelve ceros confirmados y metricas no calculables como null', async () => {
    const repository = makeRepository();
    const summary = await makeService(repository).getSummary(TOKEN);

    expect(summary.animals.total).toBe(0);
    expect(summary.animals.active).toBe(0);
    expect(summary.animals.byStatus).toEqual(
      ANIMAL_STATUSES.map((status) => ({ status, count: 0 })),
    );
    expect(summary.movements.month).toBe(0);
    expect(summary.healthEvents.month).toBe(0);
    expect(summary.litters.total).toBe(0);
    expect(summary.litters.month).toBe(0);

    // Sin corrales: la ocupacion no es calculable (nunca 0%).
    expect(summary.pens.total).toBe(0);
    expect(summary.pens.occupied).toBe(0);
    expect(summary.pens.occupancyRate).toBeNull();
    // Sin capacidad registrada: null, no 0.
    expect(summary.pens.capacity.registered).toBe(false);
    expect(summary.pens.capacity.total).toBeNull();
    expect(summary.pens.capacity.usageRate).toBeNull();
    expect(summary.pens.capacity.partial).toBe(false);

    // El grafico siempre tiene el periodo reciente completo, con ceros reales.
    expect(summary.movements.byMonth).toHaveLength(MOVEMENTS_MONTHS_WINDOW);
    expect(summary.movements.byMonth.every((item) => item.count === 0)).toBe(true);
  });
});

describe('dashboard.service: distribucion por estado', () => {
  it('cuenta por estado y calcula el total y los activos', async () => {
    const repository = makeRepository({
      statusCounts: { active: 12, sold: 3, dead: 1, inactive: 4 },
    });
    const summary = await makeService(repository).getSummary(TOKEN);

    expect(summary.animals.active).toBe(12);
    expect(summary.animals.total).toBe(20);
    expect(summary.animals.byStatus).toEqual([
      { status: 'active', count: 12 },
      { status: 'sold', count: 3 },
      { status: 'dead', count: 1 },
      { status: 'transferred_out', count: 0 },
      { status: 'missing', count: 0 },
      { status: 'inactive', count: 4 },
    ]);
  });
});

describe('dashboard.service: ocupacion de corrales', () => {
  const pens: DashboardPen[] = [
    { id: 'p1', capacity: 10, status: 'active' },
    { id: 'p2', capacity: 10, status: 'active' },
    { id: 'p3', capacity: null, status: 'active' },
    { id: 'p4', capacity: null, status: 'active' },
    { id: 'p5', capacity: null, status: 'active' },
  ];

  it('con capacidad incompleta: no presenta un porcentaje exacto', async () => {
    const repository = makeRepository({
      pens,
      scan: { penIds: ['p1', 'p2', 'p3'], housedAnimals: 18, truncated: false },
    });
    const summary = await makeService(repository).getSummary(TOKEN);

    expect(summary.pens.total).toBe(5);
    expect(summary.pens.occupied).toBe(3);
    expect(summary.pens.occupancyRate).toBeCloseTo(0.6);
    // Capacidad solo de corrales con capacidad registrada.
    expect(summary.pens.capacity.registered).toBe(true);
    expect(summary.pens.capacity.total).toBe(20);
    expect(summary.pens.capacity.housedAnimals).toBe(18);
    // Faltan capacidades (3 corrales sin registrar): la utilizacion NO se
    // calcula (seria enganosa) y se marca la capacidad como parcial.
    expect(summary.pens.capacity.partial).toBe(true);
    expect(summary.pens.capacity.usageRate).toBeNull();
  });

  it('con capacidad completa: calcula la utilizacion real', async () => {
    const repository = makeRepository({
      pens: [
        { id: 'p1', capacity: 10, status: 'active' },
        { id: 'p2', capacity: 10, status: 'active' },
      ],
      scan: { penIds: ['p1'], housedAnimals: 3, truncated: false },
    });
    const summary = await makeService(repository).getSummary(TOKEN);

    expect(summary.pens.capacity.registered).toBe(true);
    expect(summary.pens.capacity.partial).toBe(false);
    expect(summary.pens.capacity.total).toBe(20);
    expect(summary.pens.capacity.usageRate).toBeCloseTo(0.15);
  });

  it('ignora corrales ocupados que ya no estan activos', async () => {
    const repository = makeRepository({
      pens: [pens[0], pens[1]],
      scan: { penIds: ['p1', 'p-inactivo'], housedAnimals: 5, truncated: false },
    });
    const summary = await makeService(repository).getSummary(TOKEN);
    expect(summary.pens.occupied).toBe(1);
    expect(summary.pens.occupancyRate).toBeCloseTo(0.5);
  });

  it('sin capacidad registrada: total y uso son null (no se divide por cero)', async () => {
    const repository = makeRepository({
      pens: pens.map((pen) => ({ ...pen, capacity: null })),
      scan: { penIds: ['p1'], housedAnimals: 4, truncated: false },
    });
    const summary = await makeService(repository).getSummary(TOKEN);

    expect(summary.pens.total).toBe(5);
    expect(summary.pens.occupied).toBe(1);
    expect(summary.pens.occupancyRate).toBeCloseTo(0.2);
    expect(summary.pens.capacity.registered).toBe(false);
    expect(summary.pens.capacity.total).toBeNull();
    expect(summary.pens.capacity.usageRate).toBeNull();
    expect(summary.pens.capacity.partial).toBe(false);
  });

  it('exploracion parcial (truncada): ocupacion y alojados quedan no calculables', async () => {
    const repository = makeRepository({
      pens,
      scan: { penIds: ['p1', 'p2'], housedAnimals: 9999, truncated: true },
    });
    const summary = await makeService(repository).getSummary(TOKEN);

    expect(summary.pens.occupied).toBeNull();
    expect(summary.pens.occupancyRate).toBeNull();
    expect(summary.pens.capacity.housedAnimals).toBeNull();
    expect(summary.pens.capacity.usageRate).toBeNull();
    expect(summary.pens.capacity.total).toBe(20);
  });
});

describe('dashboard.service: fechas y agrupacion mensual', () => {
  it('define un periodo reciente de 6 meses que termina en el mes actual', async () => {
    const repository = makeRepository();
    const summary = await makeService(repository).getSummary(TOKEN);

    expect(summary.period.month).toBe('2026-10');
    expect(summary.period.months).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(summary.period.from).toBe('2026-10-01T00:00:00.000Z');
    expect(summary.period.to).toBe('2026-10-31T23:59:59.999Z');
  });

  it('agrupa los movimientos por mes y toma el mes actual como indicador', async () => {
    const repository = makeRepository({
      movementsByMonth: {
        '2026-05': 2,
        '2026-07': 5,
        '2026-10': 9,
      },
    });
    const summary = await makeService(repository).getSummary(TOKEN);

    expect(summary.movements.byMonth).toEqual([
      { month: '2026-05', count: 2 },
      { month: '2026-06', count: 0 },
      { month: '2026-07', count: 5 },
      { month: '2026-08', count: 0 },
      { month: '2026-09', count: 0 },
      { month: '2026-10', count: 9 },
    ]);
    expect(summary.movements.month).toBe(9);
  });

  it('cuenta los eventos sanitarios y las camadas del mes actual', async () => {
    const repository = makeRepository({
      healthEvents: 7,
      littersTotal: 25,
      littersMonth: 3,
    });
    const summary = await makeService(repository).getSummary(TOKEN);

    expect(summary.healthEvents.month).toBe(7);
    expect(summary.litters.total).toBe(25);
    expect(summary.litters.month).toBe(3);
  });

  it('usa el rango correcto de fechas para sanitarios y camadas del mes', async () => {
    const repository = makeRepository();
    await makeService(repository).getSummary(TOKEN);

    expect(repository.countHealthEvents).toHaveBeenCalledWith(
      { from: '2026-10-01T00:00:00.000Z', to: '2026-10-31T23:59:59.999Z' },
      TOKEN,
    );
    expect(repository.countLitters).toHaveBeenCalledWith(
      { from: '2026-10-01', to: '2026-10-31' },
      TOKEN,
    );
    expect(repository.countLitters).toHaveBeenCalledWith(null, TOKEN);
  });
});

describe('dashboard.service: propagacion de fallos', () => {
  it('propaga el fallo del repositorio (el dashboard no inventa un resumen)', async () => {
    const repository = makeRepository();
    repository.countAnimalsByStatus = vi.fn(async () => {
      throw new Error('fallo de datos');
    });

    await expect(makeService(repository).getSummary(TOKEN)).rejects.toThrow(
      'fallo de datos',
    );
  });
});
