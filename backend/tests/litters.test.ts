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
import { ForeignKeyError } from '../src/modules/common/data-errors.js';
import type {
  CreateLitterInput,
  Litter,
  LitterAnimalSnapshot,
  LitterOffspring,
  LitterRepository,
} from '../src/modules/litters/litters.repository.js';

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

const LITTER_ID = '66666666-6666-6666-6666-666666666666';
const MOTHER_ID = '33333333-3333-3333-3333-333333333333';
const FATHER_ID = '44444444-4444-4444-4444-444444444444';
const OFFSPRING_ID = '55555555-5555-5555-5555-555555555555';
const UNKNOWN_ID = '99999999-9999-9999-9999-999999999999';

const LITTER: Litter = {
  id: LITTER_ID,
  litter_code: 'CAM-0001',
  mother_id: MOTHER_ID,
  father_id: null,
  birth_date: '2026-03-01',
  total_born: 10,
  born_alive: 9,
  stillborn: 1,
  notes: null,
  created_at: '2026-03-01T08:00:00.000Z',
  updated_at: '2026-03-01T08:00:00.000Z',
};

const OFFSPRING: LitterOffspring = {
  id: OFFSPRING_ID,
  animal_code: 'PIG-000010',
  ear_tag_code: null,
  sex: 'female',
  birth_date: '2026-03-01',
  status: 'active',
  mother_id: MOTHER_ID,
  father_id: null,
};

const FEMALE: LitterAnimalSnapshot = { id: MOTHER_ID, sex: 'female' };
const MALE: LitterAnimalSnapshot = { id: FATHER_ID, sex: 'male' };

function findAnimalMock(id: string): LitterAnimalSnapshot | null {
  if (id === MOTHER_ID) {
    return FEMALE;
  }
  if (id === FATHER_ID) {
    return MALE;
  }
  return null;
}

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

function createLitterRepository(
  overrides: Partial<LitterRepository> = {},
): LitterRepository {
  return {
    list: vi.fn(async () => [LITTER]),
    findById: vi.fn(async () => LITTER),
    create: vi.fn(async (input: CreateLitterInput) => ({
      ...LITTER,
      ...input,
    })),
    update: vi.fn(async () => LITTER),
    findAnimal: vi.fn(async (id: string) => findAnimalMock(id)),
    listOffspring: vi.fn(async () => [OFFSPRING]),
    ...overrides,
  };
}

function buildLittersApp(repository?: LitterRepository) {
  return buildApp({
    logger: false,
    tokenVerifier: createVerifier(),
    profileRepository: createProfileRepository(),
    ...(repository ? { litterRepository: repository } : {}),
  });
}

function callApp(
  app: ReturnType<typeof buildLittersApp>,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
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

describe('litters: autenticacion y permisos', () => {
  it('GET /litters sin token -> 401', async () => {
    const app = buildLittersApp(createLitterRepository());
    expect((await callApp(app, 'GET', '/litters')).statusCode).toBe(401);
  });

  it('GET /litters con viewer -> 403', async () => {
    const app = buildLittersApp(createLitterRepository());
    expect((await callApp(app, 'GET', '/litters', 'jwt-viewer')).statusCode).toBe(403);
  });

  it('GET /litters con inactivo -> 403', async () => {
    const app = buildLittersApp(createLitterRepository());
    expect((await callApp(app, 'GET', '/litters', 'jwt-inactive')).statusCode).toBe(403);
  });

  it('GET /litters con operator -> 200', async () => {
    const app = buildLittersApp(createLitterRepository());
    const response = await callApp(app, 'GET', '/litters', 'jwt-operator');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([LITTER]);
  });

  it('GET /litters con veterinarian -> 200 (consulta)', async () => {
    const app = buildLittersApp(createLitterRepository());
    expect((await callApp(app, 'GET', '/litters', 'jwt-vet')).statusCode).toBe(200);
  });

  it('POST /litters con veterinarian -> 403 (no registra camadas)', async () => {
    const app = buildLittersApp(createLitterRepository());
    const response = await callApp(app, 'POST', '/litters', 'jwt-vet', {
      mother_id: MOTHER_ID,
    });
    expect(response.statusCode).toBe(403);
  });

  it('POST /litters con viewer -> 403', async () => {
    const app = buildLittersApp(createLitterRepository());
    const response = await callApp(app, 'POST', '/litters', 'jwt-viewer', {
      mother_id: MOTHER_ID,
    });
    expect(response.statusCode).toBe(403);
  });

  it('PATCH /litters/:id con veterinarian -> 403', async () => {
    const app = buildLittersApp(createLitterRepository());
    const response = await callApp(app, 'PATCH', `/litters/${LITTER_ID}`, 'jwt-vet', {
      notes: 'x',
    });
    expect(response.statusCode).toBe(403);
  });

  it('fail-closed: sin litterRepository responde 503', async () => {
    const app = buildLittersApp();
    expect((await callApp(app, 'GET', '/litters', 'jwt-admin')).statusCode).toBe(503);
  });
});

describe('litters: validacion de entrada', () => {
  it('POST /litters sin mother_id -> 400', async () => {
    const app = buildLittersApp(createLitterRepository());
    const response = await callApp(app, 'POST', '/litters', 'jwt-admin', {
      birth_date: '2026-03-01',
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST /litters con mother_id no UUID -> 400', async () => {
    const app = buildLittersApp(createLitterRepository());
    const response = await callApp(app, 'POST', '/litters', 'jwt-admin', {
      mother_id: 'cerda-1',
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST /litters con birth_date invalida -> 400', async () => {
    const app = buildLittersApp(createLitterRepository());
    const response = await callApp(app, 'POST', '/litters', 'jwt-admin', {
      mother_id: MOTHER_ID,
      birth_date: '2026-02-30',
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST /litters con cantidad negativa -> 400', async () => {
    const app = buildLittersApp(createLitterRepository());
    const response = await callApp(app, 'POST', '/litters', 'jwt-admin', {
      mother_id: MOTHER_ID,
      total_born: -1,
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST /litters con cantidad no entera -> 400', async () => {
    const app = buildLittersApp(createLitterRepository());
    const response = await callApp(app, 'POST', '/litters', 'jwt-admin', {
      mother_id: MOTHER_ID,
      total_born: 2.5,
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST /litters con campo no permitido (id) -> 400', async () => {
    const app = buildLittersApp(createLitterRepository());
    const response = await callApp(app, 'POST', '/litters', 'jwt-admin', {
      mother_id: MOTHER_ID,
      id: LITTER_ID,
    });
    expect(response.statusCode).toBe(400);
  });

  it('GET /litters/:id con id no UUID -> 400', async () => {
    const app = buildLittersApp(createLitterRepository());
    expect(
      (await callApp(app, 'GET', '/litters/no-uuid', 'jwt-admin')).statusCode,
    ).toBe(400);
  });

  it('GET /litters?limit=9999 -> 400', async () => {
    const app = buildLittersApp(createLitterRepository());
    expect(
      (await callApp(app, 'GET', '/litters?limit=9999', 'jwt-admin')).statusCode,
    ).toBe(400);
  });

  it('PATCH /litters/:id sin campos -> 400', async () => {
    const app = buildLittersApp(createLitterRepository());
    const response = await callApp(app, 'PATCH', `/litters/${LITTER_ID}`, 'jwt-admin', {});
    expect(response.statusCode).toBe(400);
  });
});

describe('litters: registro y reglas de negocio', () => {
  it('POST /litters con mother hembra -> 201', async () => {
    const repository = createLitterRepository();
    const app = buildLittersApp(repository);
    const response = await callApp(app, 'POST', '/litters', 'jwt-operator', {
      mother_id: MOTHER_ID,
      total_born: 10,
      born_alive: 9,
      stillborn: 1,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ mother_id: MOTHER_ID });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ mother_id: MOTHER_ID, total_born: 10 }),
      'jwt-operator',
    );
  });

  it('POST /litters sin mother_id no consulta el animal -> 400 (Zod)', async () => {
    const repository = createLitterRepository();
    const app = buildLittersApp(repository);
    const response = await callApp(app, 'POST', '/litters', 'jwt-admin', {});
    expect(response.statusCode).toBe(400);
    expect(repository.findAnimal).not.toHaveBeenCalled();
  });

  it('POST /litters con madre inexistente -> 422', async () => {
    const repository = createLitterRepository({
      findAnimal: vi.fn(async () => null),
    });
    const app = buildLittersApp(repository);
    const response = await callApp(app, 'POST', '/litters', 'jwt-admin', {
      mother_id: UNKNOWN_ID,
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: 'invalid_reference' });
  });

  it('POST /litters con madre macho -> 400', async () => {
    const repository = createLitterRepository({
      findAnimal: vi.fn(async () => MALE),
    });
    const app = buildLittersApp(repository);
    const response = await callApp(app, 'POST', '/litters', 'jwt-admin', {
      mother_id: FATHER_ID,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });
  });

  it('POST /litters con padre hembra -> 400', async () => {
    const repository = createLitterRepository({
      findAnimal: vi.fn(async () => FEMALE),
    });
    const app = buildLittersApp(repository);
    const response = await callApp(app, 'POST', '/litters', 'jwt-admin', {
      mother_id: MOTHER_ID,
      father_id: MOTHER_ID,
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST /litters con padre macho -> 201', async () => {
    const app = buildLittersApp(createLitterRepository());
    const response = await callApp(app, 'POST', '/litters', 'jwt-manager', {
      mother_id: MOTHER_ID,
      father_id: FATHER_ID,
      total_born: 8,
    });
    expect(response.statusCode).toBe(201);
  });

  it('POST /litters con padre inexistente -> 422', async () => {
    const repository = createLitterRepository({
      findAnimal: vi.fn(async (id: string) =>
        id === MOTHER_ID ? FEMALE : null,
      ),
    });
    const app = buildLittersApp(repository);
    const response = await callApp(app, 'POST', '/litters', 'jwt-admin', {
      mother_id: MOTHER_ID,
      father_id: FATHER_ID,
    });
    expect(response.statusCode).toBe(422);
  });

  it('POST /litters con born_alive > total_born -> 400', async () => {
    const app = buildLittersApp(createLitterRepository());
    const response = await callApp(app, 'POST', '/litters', 'jwt-admin', {
      mother_id: MOTHER_ID,
      total_born: 5,
      born_alive: 6,
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST /litters con stillborn > total_born -> 400', async () => {
    const app = buildLittersApp(createLitterRepository());
    const response = await callApp(app, 'POST', '/litters', 'jwt-admin', {
      mother_id: MOTHER_ID,
      total_born: 5,
      stillborn: 6,
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST referencia invalida reportada por la base -> 422', async () => {
    const repository = createLitterRepository({
      create: vi.fn(async () => {
        throw new ForeignKeyError();
      }),
    });
    const app = buildLittersApp(repository);
    const response = await callApp(app, 'POST', '/litters', 'jwt-admin', {
      mother_id: MOTHER_ID,
    });
    expect(response.statusCode).toBe(422);
  });
});

describe('litters: consulta, actualizacion y crias', () => {
  it('GET /litters propaga los filtros al repositorio', async () => {
    const repository = createLitterRepository();
    const app = buildLittersApp(repository);
    const response = await callApp(
      app,
      'GET',
      `/litters?mother_id=${MOTHER_ID}&birth_from=2026-01-01&limit=10&offset=5`,
      'jwt-operator',
    );
    expect(response.statusCode).toBe(200);
    expect(repository.list).toHaveBeenCalledWith(
      expect.objectContaining({
        mother_id: MOTHER_ID,
        birth_from: '2026-01-01',
        limit: 10,
        offset: 5,
      }),
      'jwt-operator',
    );
  });

  it('GET /litters/:id inexistente -> 404', async () => {
    const repository = createLitterRepository({
      findById: vi.fn(async () => null),
    });
    const app = buildLittersApp(repository);
    expect(
      (await callApp(app, 'GET', `/litters/${LITTER_ID}`, 'jwt-admin')).statusCode,
    ).toBe(404);
  });

  it('PATCH /litters/:id con manager -> 200', async () => {
    const app = buildLittersApp(createLitterRepository());
    const response = await callApp(app, 'PATCH', `/litters/${LITTER_ID}`, 'jwt-manager', {
      born_alive: 8,
      stillborn: 2,
    });
    expect(response.statusCode).toBe(200);
  });

  it('PATCH /litters/:id con stillborn > total_born vigente -> 400', async () => {
    const app = buildLittersApp(createLitterRepository());
    const response = await callApp(app, 'PATCH', `/litters/${LITTER_ID}`, 'jwt-admin', {
      stillborn: 11,
    });
    expect(response.statusCode).toBe(400);
  });

  it('PATCH /litters/:id inexistente -> 404', async () => {
    const repository = createLitterRepository({
      findById: vi.fn(async () => null),
    });
    const app = buildLittersApp(repository);
    const response = await callApp(app, 'PATCH', `/litters/${LITTER_ID}`, 'jwt-admin', {
      notes: 'x',
    });
    expect(response.statusCode).toBe(404);
  });

  it('GET /litters/:id/offspring -> 200 con crias', async () => {
    const repository = createLitterRepository();
    const app = buildLittersApp(repository);
    const response = await callApp(
      app,
      'GET',
      `/litters/${LITTER_ID}/offspring`,
      'jwt-operator',
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([OFFSPRING]);
    expect(repository.listOffspring).toHaveBeenCalledWith(LITTER_ID, 'jwt-operator');
  });

  it('GET /litters/:id/offspring de camada inexistente -> 404', async () => {
    const repository = createLitterRepository({
      findById: vi.fn(async () => null),
    });
    const app = buildLittersApp(repository);
    expect(
      (await callApp(app, 'GET', `/litters/${LITTER_ID}/offspring`, 'jwt-admin'))
        .statusCode,
    ).toBe(404);
  });

  it('la camada no se elimina: no hay DELETE', async () => {
    const app = buildLittersApp(createLitterRepository());
    expect(
      (await callApp(app, 'DELETE', `/litters/${LITTER_ID}`, 'jwt-admin')).statusCode,
    ).toBe(404);
  });
});
