import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type {
  ProfileRepository,
  UserProfile,
} from '../src/modules/auth/profile-repository.js';
import type {
  AuthenticatedUser,
  TokenVerifier,
} from '../src/modules/auth/token-verifier.js';
import { ANIMAL_STATUSES } from '../src/modules/common/animal.js';
import { DataAccessError } from '../src/modules/common/data-errors.js';
import { HEALTH_EVENT_TYPES } from '../src/modules/common/health-event.js';
import { MOVEMENT_REASONS } from '../src/modules/common/movement.js';
import type { ReportsRepository } from '../src/modules/reports/reports.repository.js';

const USERS: Record<string, AuthenticatedUser> = {
  'jwt-admin': { id: 'u-admin' },
  'jwt-manager': { id: 'u-manager' },
  'jwt-operator': { id: 'u-operator' },
  'jwt-vet': { id: 'u-vet' },
  'jwt-viewer': { id: 'u-viewer' },
  'jwt-inactive': { id: 'u-inactive' },
};

const PROFILES: Record<string, UserProfile> = {
  'u-admin': { id: 'u-admin', role: 'admin', isActive: true },
  'u-manager': { id: 'u-manager', role: 'manager', isActive: true },
  'u-operator': { id: 'u-operator', role: 'operator', isActive: true },
  'u-vet': { id: 'u-vet', role: 'veterinarian', isActive: true },
  'u-viewer': { id: 'u-viewer', role: 'viewer', isActive: true },
  'u-inactive': { id: 'u-inactive', role: 'manager', isActive: false },
};

function createVerifier(): TokenVerifier {
  return {
    verify: vi.fn(async (token: string): Promise<AuthenticatedUser> => {
      const user = USERS[token];
      if (!user) {
        throw new Error('invalid token');
      }
      return user;
    }),
  };
}

function createProfileRepository(): ProfileRepository {
  return {
    findProfileById: vi.fn(async (userId: string) => PROFILES[userId] ?? null),
  };
}

function fill<T extends string>(keys: readonly T[], value = 0): Record<T, number> {
  const record = {} as Record<T, number>;
  for (const key of keys) {
    record[key] = value;
  }
  return record;
}

function createReportsRepository(
  overrides: Partial<ReportsRepository> = {},
): ReportsRepository {
  return {
    countAnimalsByStatus: vi.fn(async () => {
      const record = fill(ANIMAL_STATUSES);
      record.active = 4;
      return record;
    }),
    countAnimalsBySex: vi.fn(async () => ({
      male: 2,
      female: 2,
      unknown: 0,
    })),
    countAnimalsByOrigin: vi.fn(async () => ({
      born_on_farm: 3,
      purchased: 1,
      transferred_in: 0,
      unknown: 0,
    })),
    scanPenOccupancy: vi.fn(async () => ({
      byPen: { p1: 3 },
      housedAnimals: 3,
      truncated: false,
    })),
    listActivePens: vi.fn(async () => [
      {
        id: 'p1',
        code: 'C-1',
        name: null,
        area_id: 'a1',
        capacity: 10,
        status: 'active' as const,
      },
      {
        id: 'p2',
        code: 'C-2',
        name: 'Corral 2',
        area_id: 'a1',
        capacity: 10,
        status: 'active' as const,
      },
    ]),
    listAreas: vi.fn(async () => [{ id: 'a1', name: 'Gestación' }]),
    countMovements: vi.fn(async () => 2),
    countMovementsByReason: vi.fn(async () => {
      const record = fill(MOVEMENT_REASONS);
      record.weaning = 2;
      return record;
    }),
    countHealthEventsByType: vi.fn(async () => {
      const record = fill(HEALTH_EVENT_TYPES);
      record.treatment = 1;
      return record;
    }),
    scanLitters: vi.fn(async () => ({ rows: [], truncated: false })),
    ...overrides,
  };
}

function buildReportsApp(repository?: ReportsRepository) {
  return buildApp({
    logger: false,
    tokenVerifier: createVerifier(),
    profileRepository: createProfileRepository(),
    ...(repository ? { reportsRepository: repository } : {}),
  });
}

function callApp(
  app: ReturnType<typeof buildReportsApp>,
  token?: string,
  query = '',
) {
  return app.inject({
    method: 'GET',
    url: `/reports/summary${query}`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe('reports: autenticacion y permisos', () => {
  it('sin token -> 401', async () => {
    const app = buildReportsApp(createReportsRepository());
    expect((await callApp(app)).statusCode).toBe(401);
  });

  it('con viewer -> 403 (sin acceso operativo)', async () => {
    const app = buildReportsApp(createReportsRepository());
    expect((await callApp(app, 'jwt-viewer')).statusCode).toBe(403);
  });

  it('con usuario inactivo -> 403', async () => {
    const app = buildReportsApp(createReportsRepository());
    expect((await callApp(app, 'jwt-inactive')).statusCode).toBe(403);
  });

  it.each(['jwt-admin', 'jwt-manager', 'jwt-operator', 'jwt-vet'])(
    'con rol operativo %s -> 200',
    async (token) => {
      const app = buildReportsApp(createReportsRepository());
      expect((await callApp(app, token)).statusCode).toBe(200);
    },
  );
});

describe('reports: resumen agregado', () => {
  it('devuelve todas las secciones calculadas con datos reales', async () => {
    const repository = createReportsRepository();
    const app = buildReportsApp(repository);
    const response = await callApp(app, 'jwt-operator');
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      animals: {
        total: 4,
        byStatus: expect.arrayContaining([{ value: 'active', count: 4 }]),
      },
      pens: {
        total: 2,
        occupied: 1,
        capacity: { registered: true, total: 20, housedAnimals: 3 },
      },
      movements: { total: expect.any(Number) },
      healthEvents: { total: 1 },
      litters: { total: 0, complete: true },
    });
    expect(body.animals.bySex).toHaveLength(3);
    expect(body.animals.byOrigin).toHaveLength(5);
    expect(body.movements.byMonth).toHaveLength(6);
    expect(body.period.maxMonths).toBe(12);
  });

  it('consulta el repositorio con el JWT del usuario (identidad RLS)', async () => {
    const repository = createReportsRepository();
    const app = buildReportsApp(repository);
    await callApp(app, 'jwt-vet');

    expect(repository.countAnimalsByStatus).toHaveBeenCalledWith({}, 'jwt-vet');
    expect(repository.scanPenOccupancy).toHaveBeenCalledWith('jwt-vet');
    expect(repository.listActivePens).toHaveBeenCalledWith('jwt-vet');
    expect(repository.scanLitters).toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
      'jwt-vet',
    );
  });

  it('propaga los filtros de la consulta al repositorio', async () => {
    const repository = createReportsRepository();
    const app = buildReportsApp(repository);
    const response = await callApp(
      app,
      'jwt-admin',
      '?sex=female&origin=purchased&movement_reason=sale&health_event_type=treatment',
    );

    expect(response.statusCode).toBe(200);
    expect(repository.countAnimalsByStatus).toHaveBeenCalledWith(
      { sex: 'female', origin: 'purchased' },
      'jwt-admin',
    );
    expect(repository.countMovementsByReason).toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.any(String) }),
      'sale',
      'jwt-admin',
    );
    expect(repository.countHealthEventsByType).toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.any(String) }),
      'treatment',
      'jwt-admin',
    );
  });

  it('no realiza escrituras: el repositorio agregado es de solo lectura', async () => {
    const repository = createReportsRepository();
    const app = buildReportsApp(repository);
    await callApp(app, 'jwt-admin');

    const methods = Object.keys(repository);
    expect(methods).not.toContain('create');
    expect(methods).not.toContain('update');
    expect(methods).not.toContain('insert');
    expect(methods).not.toContain('delete');
  });
});

describe('reports: validacion de la consulta', () => {
  it('rechaza un enum no previsto con 400', async () => {
    const app = buildReportsApp(createReportsRepository());
    const response = await callApp(app, 'jwt-admin', '?sex=otro');
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_query' });
  });

  it('rechaza un campo no previsto con 400 (consulta estricta)', async () => {
    const app = buildReportsApp(createReportsRepository());
    const response = await callApp(app, 'jwt-admin', '?limit=100000');
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_query' });
  });

  it('rechaza una fecha con formato invalido con 400', async () => {
    const app = buildReportsApp(createReportsRepository());
    const response = await callApp(app, 'jwt-admin', '?from=18-10-2026');
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_query' });
  });

  it('rechaza un periodo invertido con 400', async () => {
    const app = buildReportsApp(createReportsRepository());
    const response = await callApp(
      app,
      'jwt-admin',
      '?from=2026-05-02&to=2026-05-01',
    );
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });
  });

  it('rechaza un periodo mayor que doce meses con 400', async () => {
    const app = buildReportsApp(createReportsRepository());
    const response = await callApp(
      app,
      'jwt-admin',
      '?from=2024-01-01&to=2026-01-01',
    );
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });
  });
});

describe('reports: fallos de API (fail-closed)', () => {
  it('sin reportsRepository responde 503', async () => {
    const app = buildReportsApp();
    expect((await callApp(app, 'jwt-admin')).statusCode).toBe(503);
  });

  it('si el repositorio falla -> 503 (no se inventan cifras)', async () => {
    const repository = createReportsRepository({
      countAnimalsByStatus: vi.fn(async () => {
        throw new DataAccessError();
      }),
    });
    const app = buildReportsApp(repository);
    const response = await callApp(app, 'jwt-admin');

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'service_unavailable' });
  });
});
