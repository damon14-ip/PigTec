import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Area, AreaRepository } from '../src/modules/areas/areas.repository.js';
import type {
  ProfileRepository,
  UserProfile,
} from '../src/modules/auth/profile-repository.js';
import type {
  AuthenticatedUser,
  TokenVerifier,
} from '../src/modules/auth/token-verifier.js';
import { ConflictError } from '../src/modules/common/data-errors.js';

/** Token falso -> identidad verificada. */
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

const AREA: Area = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Nave 1',
  description: null,
  status: 'active',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
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

function createAreaRepository(
  overrides: Partial<AreaRepository> = {},
): AreaRepository {
  return {
    list: vi.fn(async () => [AREA]),
    findById: vi.fn(async () => AREA),
    create: vi.fn(async (input) => ({ ...AREA, name: input.name })),
    update: vi.fn(async () => AREA),
    setStatus: vi.fn(async () => ({ ...AREA, status: 'inactive' as const })),
    ...overrides,
  };
}

function buildAreasApp(repository?: AreaRepository) {
  return buildApp({
    logger: false,
    tokenVerifier: createVerifier(),
    profileRepository: createProfileRepository(),
    ...(repository ? { areaRepository: repository } : {}),
  });
}

function callApp(
  app: ReturnType<typeof buildAreasApp>,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  token?: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload ? { payload } : {}),
  });
}

describe('areas: autenticacion y permisos', () => {
  it('GET /areas sin token -> 401', async () => {
    const app = buildAreasApp(createAreaRepository());
    expect((await callApp(app, 'GET', '/areas')).statusCode).toBe(401);
  });

  it('GET /areas con viewer -> 403', async () => {
    const app = buildAreasApp(createAreaRepository());
    expect((await callApp(app, 'GET', '/areas', 'jwt-viewer')).statusCode).toBe(403);
  });

  it('GET /areas con inactivo -> 403', async () => {
    const app = buildAreasApp(createAreaRepository());
    expect((await callApp(app, 'GET', '/areas', 'jwt-inactive')).statusCode).toBe(403);
  });

  it('GET /areas con operator -> 200 y lista', async () => {
    const app = buildAreasApp(createAreaRepository());
    const response = await callApp(app, 'GET', '/areas', 'jwt-operator');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([AREA]);
  });

  it('GET /areas con veterinarian -> 200', async () => {
    const app = buildAreasApp(createAreaRepository());
    expect((await callApp(app, 'GET', '/areas', 'jwt-vet')).statusCode).toBe(200);
  });

  it('POST /areas con operator -> 403 (solo admin/manager escriben)', async () => {
    const app = buildAreasApp(createAreaRepository());
    const response = await callApp(app, 'POST', '/areas', 'jwt-operator', {
      name: 'Nave 2',
    });
    expect(response.statusCode).toBe(403);
  });

  it('DELETE /areas/:id con viewer -> 403', async () => {
    const app = buildAreasApp(createAreaRepository());
    const response = await callApp(
      app,
      'DELETE',
      `/areas/${AREA.id}`,
      'jwt-viewer',
    );
    expect(response.statusCode).toBe(403);
  });
});

describe('areas: validacion de entrada', () => {
  it('GET /areas con status invalido -> 400', async () => {
    const app = buildAreasApp(createAreaRepository());
    expect(
      (await callApp(app, 'GET', '/areas?status=malo', 'jwt-admin')).statusCode,
    ).toBe(400);
  });

  it('GET /areas/:id con id no UUID -> 400', async () => {
    const app = buildAreasApp(createAreaRepository());
    expect((await callApp(app, 'GET', '/areas/no-uuid', 'jwt-admin')).statusCode).toBe(
      400,
    );
  });

  it('POST /areas con nombre vacio -> 400', async () => {
    const app = buildAreasApp(createAreaRepository());
    const response = await callApp(app, 'POST', '/areas', 'jwt-admin', {
      name: '   ',
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST /areas con campo no permitido (status) -> 400', async () => {
    const app = buildAreasApp(createAreaRepository());
    const response = await callApp(app, 'POST', '/areas', 'jwt-admin', {
      name: 'Nave 3',
      status: 'inactive',
    });
    expect(response.statusCode).toBe(400);
  });

  it('PATCH /areas/:id sin campos -> 400', async () => {
    const app = buildAreasApp(createAreaRepository());
    const response = await callApp(app, 'PATCH', `/areas/${AREA.id}`, 'jwt-admin', {});
    expect(response.statusCode).toBe(400);
  });
});

describe('areas: operaciones y errores de datos', () => {
  it('POST /areas con admin -> 201', async () => {
    const app = buildAreasApp(createAreaRepository());
    const response = await callApp(app, 'POST', '/areas', 'jwt-admin', {
      name: 'Nave 4',
      description: 'Galpon norte',
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ name: 'Nave 4' });
  });

  it('POST /areas duplicada -> 409', async () => {
    const repository = createAreaRepository({
      create: vi.fn(async () => {
        throw new ConflictError();
      }),
    });
    const app = buildAreasApp(repository);
    const response = await callApp(app, 'POST', '/areas', 'jwt-admin', {
      name: 'Nave 1',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'conflict' });
  });

  it('GET /areas/:id inexistente -> 404', async () => {
    const repository = createAreaRepository({
      findById: vi.fn(async () => null),
    });
    const app = buildAreasApp(repository);
    const response = await callApp(app, 'GET', `/areas/${AREA.id}`, 'jwt-admin');
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });

  it('PATCH /areas/:id con manager -> 200', async () => {
    const app = buildAreasApp(createAreaRepository());
    const response = await callApp(app, 'PATCH', `/areas/${AREA.id}`, 'jwt-manager', {
      name: 'Nave renombrada',
    });
    expect(response.statusCode).toBe(200);
  });

  it('DELETE /areas/:id desactiva (baja logica) y no borra', async () => {
    const repository = createAreaRepository();
    const app = buildAreasApp(repository);
    const response = await callApp(app, 'DELETE', `/areas/${AREA.id}`, 'jwt-admin');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'inactive' });
    expect(repository.setStatus).toHaveBeenCalledWith(
      AREA.id,
      'inactive',
      'jwt-admin',
    );
  });

  it('fail-closed: sin areaRepository responde 503', async () => {
    const app = buildAreasApp();
    expect((await callApp(app, 'GET', '/areas', 'jwt-admin')).statusCode).toBe(503);
  });
});
