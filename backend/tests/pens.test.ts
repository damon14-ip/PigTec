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
import { ConflictError, ForeignKeyError } from '../src/modules/common/data-errors.js';
import type { Pen, PenRepository } from '../src/modules/pens/pens.repository.js';

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

const AREA_ID = '11111111-1111-1111-1111-111111111111';

const PEN: Pen = {
  id: '22222222-2222-2222-2222-222222222222',
  area_id: AREA_ID,
  code: 'C-01',
  name: null,
  capacity: 20,
  notes: null,
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

function createPenRepository(overrides: Partial<PenRepository> = {}): PenRepository {
  return {
    list: vi.fn(async () => [PEN]),
    findById: vi.fn(async () => PEN),
    create: vi.fn(async (input) => ({ ...PEN, area_id: input.area_id, code: input.code })),
    update: vi.fn(async () => PEN),
    setStatus: vi.fn(async () => ({ ...PEN, status: 'inactive' as const })),
    ...overrides,
  };
}

function buildPensApp(repository?: PenRepository) {
  return buildApp({
    logger: false,
    tokenVerifier: createVerifier(),
    profileRepository: createProfileRepository(),
    ...(repository ? { penRepository: repository } : {}),
  });
}

function callApp(
  app: ReturnType<typeof buildPensApp>,
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

describe('pens: autenticacion y permisos', () => {
  it('GET /pens sin token -> 401', async () => {
    const app = buildPensApp(createPenRepository());
    expect((await callApp(app, 'GET', '/pens')).statusCode).toBe(401);
  });

  it('GET /pens con viewer -> 403', async () => {
    const app = buildPensApp(createPenRepository());
    expect((await callApp(app, 'GET', '/pens', 'jwt-viewer')).statusCode).toBe(403);
  });

  it('GET /pens con veterinarian -> 200', async () => {
    const app = buildPensApp(createPenRepository());
    expect((await callApp(app, 'GET', '/pens', 'jwt-vet')).statusCode).toBe(200);
  });

  it('POST /pens con operator -> 403', async () => {
    const app = buildPensApp(createPenRepository());
    const response = await callApp(app, 'POST', '/pens', 'jwt-operator', {
      area_id: AREA_ID,
      code: 'C-02',
    });
    expect(response.statusCode).toBe(403);
  });

  it('DELETE /pens/:id con viewer -> 403', async () => {
    const app = buildPensApp(createPenRepository());
    expect((await callApp(app, 'DELETE', `/pens/${PEN.id}`, 'jwt-viewer')).statusCode).toBe(
      403,
    );
  });
});

describe('pens: validacion y relaciones criticas', () => {
  it('GET /pens?area_id filtra por area', async () => {
    const repository = createPenRepository();
    const app = buildPensApp(repository);
    const response = await callApp(app, 'GET', `/pens?area_id=${AREA_ID}`, 'jwt-operator');
    expect(response.statusCode).toBe(200);
    expect(repository.list).toHaveBeenCalledWith(
      { area_id: AREA_ID },
      'jwt-operator',
    );
  });

  it('GET /pens?area_id no UUID -> 400', async () => {
    const app = buildPensApp(createPenRepository());
    expect((await callApp(app, 'GET', '/pens?area_id=malo', 'jwt-admin')).statusCode).toBe(
      400,
    );
  });

  it('POST /pens con admin -> 201', async () => {
    const app = buildPensApp(createPenRepository());
    const response = await callApp(app, 'POST', '/pens', 'jwt-admin', {
      area_id: AREA_ID,
      code: 'C-05',
      capacity: 15,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ area_id: AREA_ID, code: 'C-05' });
  });

  it('POST /pens sin area_id -> 400', async () => {
    const app = buildPensApp(createPenRepository());
    const response = await callApp(app, 'POST', '/pens', 'jwt-admin', {
      code: 'C-06',
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST /pens con capacity negativa -> 400', async () => {
    const app = buildPensApp(createPenRepository());
    const response = await callApp(app, 'POST', '/pens', 'jwt-admin', {
      area_id: AREA_ID,
      code: 'C-07',
      capacity: -1,
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST /pens con campo no permitido (status) -> 400', async () => {
    const app = buildPensApp(createPenRepository());
    const response = await callApp(app, 'POST', '/pens', 'jwt-admin', {
      area_id: AREA_ID,
      code: 'C-08',
      status: 'inactive',
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST /pens con area inexistente (FK) -> 422', async () => {
    const repository = createPenRepository({
      create: vi.fn(async () => {
        throw new ForeignKeyError();
      }),
    });
    const app = buildPensApp(repository);
    const response = await callApp(app, 'POST', '/pens', 'jwt-admin', {
      area_id: AREA_ID,
      code: 'C-09',
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: 'invalid_reference' });
  });

  it('POST /pens duplicado (area_id, code) -> 409', async () => {
    const repository = createPenRepository({
      create: vi.fn(async () => {
        throw new ConflictError();
      }),
    });
    const app = buildPensApp(repository);
    const response = await callApp(app, 'POST', '/pens', 'jwt-admin', {
      area_id: AREA_ID,
      code: 'C-01',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'conflict' });
  });

  it('GET /pens/:id inexistente -> 404', async () => {
    const repository = createPenRepository({ findById: vi.fn(async () => null) });
    const app = buildPensApp(repository);
    const response = await callApp(app, 'GET', `/pens/${PEN.id}`, 'jwt-admin');
    expect(response.statusCode).toBe(404);
  });

  it('PATCH /pens/:id con manager -> 200', async () => {
    const app = buildPensApp(createPenRepository());
    const response = await callApp(app, 'PATCH', `/pens/${PEN.id}`, 'jwt-manager', {
      capacity: 25,
    });
    expect(response.statusCode).toBe(200);
  });

  it('DELETE /pens/:id desactiva (baja logica)', async () => {
    const repository = createPenRepository();
    const app = buildPensApp(repository);
    const response = await callApp(app, 'DELETE', `/pens/${PEN.id}`, 'jwt-admin');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'inactive' });
    expect(repository.setStatus).toHaveBeenCalledWith(PEN.id, 'inactive', 'jwt-admin');
  });

  it('fail-closed: sin penRepository responde 503', async () => {
    const app = buildPensApp();
    expect((await callApp(app, 'GET', '/pens', 'jwt-admin')).statusCode).toBe(503);
  });
});
