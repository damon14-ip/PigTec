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
import type {
  Animal,
  AnimalLocation,
  AnimalRepository,
} from '../src/modules/animals/animals.repository.js';

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

const ANIMAL_ID = '33333333-3333-3333-3333-333333333333';
const PEN_ID = '22222222-2222-2222-2222-222222222222';
const AREA_ID = '11111111-1111-1111-1111-111111111111';

const ANIMAL: Animal = {
  id: ANIMAL_ID,
  animal_code: 'PIG-000001',
  ear_tag_code: null,
  sex: 'female',
  breed: null,
  birth_date: null,
  origin: 'born_on_farm',
  mother_id: null,
  father_id: null,
  litter_id: null,
  current_pen_id: PEN_ID,
  status: 'active',
  entry_date: '2026-01-01',
  exit_date: null,
  notes: null,
  created_by: 'u-admin',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const LOCATION: AnimalLocation = {
  animal_id: ANIMAL_ID,
  current_pen_id: PEN_ID,
  pen: {
    id: PEN_ID,
    code: 'C-01',
    name: null,
    status: 'active',
    area: { id: AREA_ID, name: 'Nave 1', status: 'active' },
  },
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

function createAnimalRepository(
  overrides: Partial<AnimalRepository> = {},
): AnimalRepository {
  return {
    list: vi.fn(async () => [ANIMAL]),
    findById: vi.fn(async () => ANIMAL),
    findByCode: vi.fn(async () => ANIMAL),
    countByStatus: vi.fn(async () => 1),
    create: vi.fn(async (_input, createdBy) => ({
      ...ANIMAL,
      created_by: createdBy,
    })),
    update: vi.fn(async () => ANIMAL),
    setStatus: vi.fn(async (_id, status) => ({ ...ANIMAL, status })),
    findLocation: vi.fn(async () => LOCATION),
    ...overrides,
  };
}

function buildAnimalsApp(repository?: AnimalRepository) {
  return buildApp({
    logger: false,
    tokenVerifier: createVerifier(),
    profileRepository: createProfileRepository(),
    ...(repository ? { animalRepository: repository } : {}),
  });
}

function callApp(
  app: ReturnType<typeof buildAnimalsApp>,
  method: 'GET' | 'POST' | 'PATCH',
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

describe('animals: autenticacion y permisos', () => {
  it('GET /animals sin token -> 401', async () => {
    const app = buildAnimalsApp(createAnimalRepository());
    expect((await callApp(app, 'GET', '/animals')).statusCode).toBe(401);
  });

  it('GET /animals con viewer -> 403', async () => {
    const app = buildAnimalsApp(createAnimalRepository());
    expect((await callApp(app, 'GET', '/animals', 'jwt-viewer')).statusCode).toBe(403);
  });

  it('GET /animals con inactivo -> 403', async () => {
    const app = buildAnimalsApp(createAnimalRepository());
    expect((await callApp(app, 'GET', '/animals', 'jwt-inactive')).statusCode).toBe(403);
  });

  it('GET /animals con operator -> 200', async () => {
    const app = buildAnimalsApp(createAnimalRepository());
    const response = await callApp(app, 'GET', '/animals', 'jwt-operator');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([ANIMAL]);
  });

  it('GET /animals con veterinarian -> 200', async () => {
    const app = buildAnimalsApp(createAnimalRepository());
    expect((await callApp(app, 'GET', '/animals', 'jwt-vet')).statusCode).toBe(200);
  });

  it('POST /animals con operator -> 403 (solo admin/manager registran)', async () => {
    const app = buildAnimalsApp(createAnimalRepository());
    const response = await callApp(app, 'POST', '/animals', 'jwt-operator', {
      animal_code: 'PIG-000002',
    });
    expect(response.statusCode).toBe(403);
  });

  it('POST /animals con veterinarian -> 403', async () => {
    const app = buildAnimalsApp(createAnimalRepository());
    const response = await callApp(app, 'POST', '/animals', 'jwt-vet', {
      animal_code: 'PIG-000003',
    });
    expect(response.statusCode).toBe(403);
  });

  it('PATCH /animals/:id con operator -> 403', async () => {
    const app = buildAnimalsApp(createAnimalRepository());
    const response = await callApp(app, 'PATCH', `/animals/${ANIMAL_ID}`, 'jwt-operator', {
      notes: 'x',
    });
    expect(response.statusCode).toBe(403);
  });

  it('PATCH /animals/:id/status con viewer -> 403', async () => {
    const app = buildAnimalsApp(createAnimalRepository());
    const response = await callApp(
      app,
      'PATCH',
      `/animals/${ANIMAL_ID}/status`,
      'jwt-viewer',
      { status: 'inactive' },
    );
    expect(response.statusCode).toBe(403);
  });
});

describe('animals: validacion de entrada', () => {
  it('POST /animals con animal_code -> 400 (lo genera la base, no el cliente)', async () => {
    const app = buildAnimalsApp(createAnimalRepository());
    const response = await callApp(app, 'POST', '/animals', 'jwt-admin', {
      animal_code: 'PIG-000001',
      sex: 'male',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_body' });
  });

  it('POST /animals con sex invalido -> 400', async () => {
    const app = buildAnimalsApp(createAnimalRepository());
    const response = await callApp(app, 'POST', '/animals', 'jwt-admin', {
      sex: 'macho',
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST /animals con origin invalido -> 400', async () => {
    const app = buildAnimalsApp(createAnimalRepository());
    const response = await callApp(app, 'POST', '/animals', 'jwt-admin', {
      origin: 'imported',
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST /animals con birth_date invalida -> 400', async () => {
    const app = buildAnimalsApp(createAnimalRepository());
    const response = await callApp(app, 'POST', '/animals', 'jwt-admin', {
      birth_date: '2026-02-30',
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST /animals con campo no permitido (status) -> 400', async () => {
    const app = buildAnimalsApp(createAnimalRepository());
    const response = await callApp(app, 'POST', '/animals', 'jwt-admin', {
      status: 'dead',
    });
    expect(response.statusCode).toBe(400);
  });

  it('GET /animals/:id con id no UUID -> 400', async () => {
    const app = buildAnimalsApp(createAnimalRepository());
    expect((await callApp(app, 'GET', '/animals/no-uuid', 'jwt-admin')).statusCode).toBe(400);
  });

  it('PATCH /animals/:id sin campos -> 400', async () => {
    const app = buildAnimalsApp(createAnimalRepository());
    const response = await callApp(app, 'PATCH', `/animals/${ANIMAL_ID}`, 'jwt-admin', {});
    expect(response.statusCode).toBe(400);
  });

  it('PATCH /animals/:id con animal_code -> 400 (inmutable)', async () => {
    const app = buildAnimalsApp(createAnimalRepository());
    const response = await callApp(app, 'PATCH', `/animals/${ANIMAL_ID}`, 'jwt-admin', {
      animal_code: 'PIG-999999',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_body' });
  });

  it('PATCH /animals/:id/status con estado derivado (sold) -> 400', async () => {
    const app = buildAnimalsApp(createAnimalRepository());
    const response = await callApp(
      app,
      'PATCH',
      `/animals/${ANIMAL_ID}/status`,
      'jwt-admin',
      { status: 'sold' },
    );
    expect(response.statusCode).toBe(400);
  });
});

describe('animals: registro, relaciones y operaciones', () => {
  it('GET /animals filtra por estado y busqueda', async () => {
    const repository = createAnimalRepository();
    const app = buildAnimalsApp(repository);
    const response = await callApp(
      app,
      'GET',
      '/animals?status=active&q=PIG',
      'jwt-operator',
    );
    expect(response.statusCode).toBe(200);
    expect(repository.list).toHaveBeenCalledWith(
      { status: 'active', q: 'PIG' },
      'jwt-operator',
    );
  });

  it('POST /animals sin animal_code -> 201, lo genera la base y created_by del JWT', async () => {
    const app = buildAnimalsApp(createAnimalRepository());
    const response = await callApp(app, 'POST', '/animals', 'jwt-admin', {
      sex: 'male',
      origin: 'purchased',
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      animal_code: 'PIG-000001',
      created_by: 'u-admin',
    });
  });

  it('POST /animals genera codigos unicos (PIG-000001, PIG-000002...)', async () => {
    let counter = 0;
    const repository = createAnimalRepository({
      create: vi.fn(async (_input, createdBy) => ({
        ...ANIMAL,
        animal_code: `PIG-${String(++counter).padStart(6, '0')}`,
        created_by: createdBy,
      })),
    });
    const app = buildAnimalsApp(repository);

    const first = await callApp(app, 'POST', '/animals', 'jwt-admin', { sex: 'male' });
    const second = await callApp(app, 'POST', '/animals', 'jwt-admin', { sex: 'female' });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().animal_code).toBe('PIG-000001');
    expect(second.json().animal_code).toBe('PIG-000002');
  });

  it('POST /animals con conflicto de codigo generado -> 409', async () => {
    const repository = createAnimalRepository({
      create: vi.fn(async () => {
        throw new ConflictError();
      }),
    });
    const app = buildAnimalsApp(repository);
    const response = await callApp(app, 'POST', '/animals', 'jwt-admin', { sex: 'male' });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'conflict' });
  });

  it('POST /animals con corral inexistente (FK) -> 422', async () => {
    const repository = createAnimalRepository({
      create: vi.fn(async () => {
        throw new ForeignKeyError();
      }),
    });
    const app = buildAnimalsApp(repository);
    const response = await callApp(app, 'POST', '/animals', 'jwt-manager', {
      current_pen_id: PEN_ID,
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: 'invalid_reference' });
  });

  it('GET /animals/:id inexistente -> 404', async () => {
    const repository = createAnimalRepository({
      findById: vi.fn(async () => null),
    });
    const app = buildAnimalsApp(repository);
    expect((await callApp(app, 'GET', `/animals/${ANIMAL_ID}`, 'jwt-admin')).statusCode).toBe(
      404,
    );
  });

  it('PATCH /animals/:id con manager -> 200', async () => {
    const app = buildAnimalsApp(createAnimalRepository());
    const response = await callApp(app, 'PATCH', `/animals/${ANIMAL_ID}`, 'jwt-manager', {
      breed: 'Duroc',
    });
    expect(response.statusCode).toBe(200);
  });

  it('PATCH /animals/:id con mother_id = id -> 400 (CHECK del esquema)', async () => {
    const app = buildAnimalsApp(createAnimalRepository());
    const response = await callApp(app, 'PATCH', `/animals/${ANIMAL_ID}`, 'jwt-admin', {
      mother_id: ANIMAL_ID,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });
  });

  it('PATCH /animals/:id/status con admin inactiva (baja logica)', async () => {
    const repository = createAnimalRepository();
    const app = buildAnimalsApp(repository);
    const response = await callApp(
      app,
      'PATCH',
      `/animals/${ANIMAL_ID}/status`,
      'jwt-admin',
      { status: 'inactive' },
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'inactive' });
    expect(repository.setStatus).toHaveBeenCalledWith(
      ANIMAL_ID,
      'inactive',
      'jwt-admin',
    );
  });

  it('GET /animals/:id/location -> 200 con corral y area', async () => {
    const app = buildAnimalsApp(createAnimalRepository());
    const response = await callApp(app, 'GET', `/animals/${ANIMAL_ID}/location`, 'jwt-vet');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(LOCATION);
  });

  it('GET /animals/:id/location sin corral -> pen null', async () => {
    const repository = createAnimalRepository({
      findLocation: vi.fn(async () => ({
        animal_id: ANIMAL_ID,
        current_pen_id: null,
        pen: null,
      })),
    });
    const app = buildAnimalsApp(repository);
    const response = await callApp(app, 'GET', `/animals/${ANIMAL_ID}/location`, 'jwt-admin');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ current_pen_id: null, pen: null });
  });

  it('GET /animals/:id/location inexistente -> 404', async () => {
    const repository = createAnimalRepository({
      findLocation: vi.fn(async () => null),
    });
    const app = buildAnimalsApp(repository);
    expect(
      (await callApp(app, 'GET', `/animals/${ANIMAL_ID}/location`, 'jwt-admin')).statusCode,
    ).toBe(404);
  });

  it('fail-closed: sin animalRepository responde 503', async () => {
    const app = buildAnimalsApp();
    expect((await callApp(app, 'GET', '/animals', 'jwt-admin')).statusCode).toBe(503);
  });
});
