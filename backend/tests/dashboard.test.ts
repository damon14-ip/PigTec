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
import { DataAccessError } from '../src/modules/common/data-errors.js';
import { ANIMAL_STATUSES } from '../src/modules/common/animal.js';
import type {
  DashboardRepository,
} from '../src/modules/dashboard/dashboard.repository.js';

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

function createDashboardRepository(
  overrides: Partial<DashboardRepository> = {},
): DashboardRepository {
  return {
    countAnimalsByStatus: vi.fn(async () => {
      const record = {} as Record<string, number>;
      for (const status of ANIMAL_STATUSES) {
        record[status] = 0;
      }
      record.active = 4;
      return record as Awaited<
        ReturnType<DashboardRepository['countAnimalsByStatus']>
      >;
    }),
    scanHousedAnimalPens: vi.fn(async () => ({
      penIds: ['p1'],
      housedAnimals: 3,
      truncated: false,
    })),
    listActivePens: vi.fn(async () => [
      { id: 'p1', capacity: 10, status: 'active' as const },
      { id: 'p2', capacity: 10, status: 'active' as const },
    ]),
    countMovements: vi.fn(async () => 6),
    countHealthEvents: vi.fn(async () => 2),
    countLitters: vi.fn(async (range) => (range === null ? 5 : 1)),
    ...overrides,
  };
}

function buildDashboardApp(repository?: DashboardRepository) {
  return buildApp({
    logger: false,
    tokenVerifier: createVerifier(),
    profileRepository: createProfileRepository(),
    ...(repository ? { dashboardRepository: repository } : {}),
  });
}

function callApp(
  app: ReturnType<typeof buildDashboardApp>,
  token?: string,
) {
  return app.inject({
    method: 'GET',
    url: '/dashboard/summary',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe('dashboard: autenticacion y permisos', () => {
  it('sin token -> 401', async () => {
    const app = buildDashboardApp(createDashboardRepository());
    expect((await callApp(app)).statusCode).toBe(401);
  });

  it('con viewer -> 403 (sin acceso operativo)', async () => {
    const app = buildDashboardApp(createDashboardRepository());
    expect((await callApp(app, 'jwt-viewer')).statusCode).toBe(403);
  });

  it('con usuario inactivo -> 403', async () => {
    const app = buildDashboardApp(createDashboardRepository());
    expect((await callApp(app, 'jwt-inactive')).statusCode).toBe(403);
  });

  it.each(['jwt-admin', 'jwt-manager', 'jwt-operator', 'jwt-vet'])(
    'con rol operativo %s -> 200',
    async (token) => {
      const app = buildDashboardApp(createDashboardRepository());
      expect((await callApp(app, token)).statusCode).toBe(200);
    },
  );
});

describe('dashboard: indicadores agregados', () => {
  it('devuelve el resumen con indicadores reales', async () => {
    const repository = createDashboardRepository();
    const app = buildDashboardApp(repository);
    const response = await callApp(app, 'jwt-operator');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      animals: { total: 4, active: 4 },
      pens: {
        total: 2,
        occupied: 1,
        capacity: {
          registered: true,
          total: 20,
          housedAnimals: 3,
          partial: false,
        },
      },
      movements: { month: 6 },
      healthEvents: { month: 2 },
      litters: { total: 5, month: 1 },
    });
    expect(response.json().movements.byMonth).toHaveLength(6);
  });

  it('marca la capacidad como parcial si falta capacidad en algun corral', async () => {
    const repository = createDashboardRepository({
      listActivePens: vi.fn(async () => [
        { id: 'p1', capacity: 10, status: 'active' as const },
        { id: 'p2', capacity: null, status: 'active' as const },
      ]),
    });
    const app = buildDashboardApp(repository);
    const response = await callApp(app, 'jwt-operator');

    expect(response.json()).toMatchObject({
      pens: {
        capacity: { registered: true, total: 10, partial: true, usageRate: null },
      },
    });
  });

  it('consulta el repositorio con el JWT del usuario (identidad RLS)', async () => {
    const repository = createDashboardRepository();
    const app = buildDashboardApp(repository);
    await callApp(app, 'jwt-vet');

    expect(repository.countAnimalsByStatus).toHaveBeenCalledWith('jwt-vet');
    expect(repository.scanHousedAnimalPens).toHaveBeenCalledWith('jwt-vet');
    expect(repository.listActivePens).toHaveBeenCalledWith('jwt-vet');
    expect(repository.countMovements).toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
      'jwt-vet',
    );
  });

  it('no realiza escrituras: el repositorio agregado es de solo lectura', async () => {
    const repository = createDashboardRepository();
    const app = buildDashboardApp(repository);
    await callApp(app, 'jwt-admin');

    const methods = Object.keys(repository);
    expect(methods).not.toContain('create');
    expect(methods).not.toContain('update');
    expect(methods).not.toContain('insert');
    expect(methods).not.toContain('delete');
  });
});

describe('dashboard: fallos de API (fail-closed)', () => {
  it('sin dashboardRepository responde 503', async () => {
    const app = buildDashboardApp();
    expect((await callApp(app, 'jwt-admin')).statusCode).toBe(503);
  });

  it('si el repositorio falla -> 503 (no se inventa un resumen)', async () => {
    const repository = createDashboardRepository({
      countAnimalsByStatus: vi.fn(async () => {
        throw new DataAccessError();
      }),
    });
    const app = buildDashboardApp(repository);
    const response = await callApp(app, 'jwt-admin');

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'service_unavailable' });
  });
});
