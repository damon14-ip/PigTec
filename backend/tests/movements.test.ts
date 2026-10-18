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
  CreateMovementInput,
  Movement,
  MovementAnimalSnapshot,
  MovementPenSnapshot,
  MovementRepository,
} from '../src/modules/movements/movements.repository.js';

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
const FROM_PEN_ID = '22222222-2222-2222-2222-222222222222';
const TO_PEN_ID = '44444444-4444-4444-4444-444444444444';
const AREA_ID = '11111111-1111-1111-1111-111111111111';
const MOVEMENT_ID = '55555555-5555-5555-5555-555555555555';
const UNKNOWN_ID = '99999999-9999-9999-9999-999999999999';

const ANIMAL: MovementAnimalSnapshot = {
  id: ANIMAL_ID,
  status: 'active',
  current_pen_id: FROM_PEN_ID,
};

const PEN: MovementPenSnapshot = {
  id: TO_PEN_ID,
  status: 'active',
  area_id: AREA_ID,
  area_status: 'active',
};

const MOVEMENT: Movement = {
  id: MOVEMENT_ID,
  animal_id: ANIMAL_ID,
  from_pen_id: FROM_PEN_ID,
  to_pen_id: TO_PEN_ID,
  moved_at: '2026-01-02T10:00:00.000Z',
  reason: 'management',
  notes: null,
  recorded_by: 'u-admin',
  created_at: '2026-01-02T10:00:00.000Z',
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

function createMovementRepository(
  overrides: Partial<MovementRepository> = {},
): MovementRepository {
  return {
    list: vi.fn(async () => [MOVEMENT]),
    findById: vi.fn(async () => MOVEMENT),
    create: vi.fn(async (input: CreateMovementInput, recordedBy: string) => ({
      ...MOVEMENT,
      ...input,
      recorded_by: recordedBy,
    })),
    findAnimal: vi.fn(async () => ANIMAL),
    findPen: vi.fn(async () => PEN),
    ...overrides,
  };
}

function buildMovementsApp(repository?: MovementRepository) {
  return buildApp({
    logger: false,
    tokenVerifier: createVerifier(),
    profileRepository: createProfileRepository(),
    ...(repository ? { movementRepository: repository } : {}),
  });
}

function callApp(
  app: ReturnType<typeof buildMovementsApp>,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
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

describe('movements: autenticacion y permisos', () => {
  it('GET /movements sin token -> 401', async () => {
    const app = buildMovementsApp(createMovementRepository());
    expect((await callApp(app, 'GET', '/movements')).statusCode).toBe(401);
  });

  it('GET /movements con viewer -> 403', async () => {
    const app = buildMovementsApp(createMovementRepository());
    expect((await callApp(app, 'GET', '/movements', 'jwt-viewer')).statusCode).toBe(403);
  });

  it('GET /movements con usuario inactivo -> 403', async () => {
    const app = buildMovementsApp(createMovementRepository());
    expect(
      (await callApp(app, 'GET', '/movements', 'jwt-inactive')).statusCode,
    ).toBe(403);
  });

  it('GET /movements con operator -> 200', async () => {
    const app = buildMovementsApp(createMovementRepository());
    const response = await callApp(app, 'GET', '/movements', 'jwt-operator');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([MOVEMENT]);
  });

  it('GET /movements con veterinarian -> 200', async () => {
    const app = buildMovementsApp(createMovementRepository());
    expect((await callApp(app, 'GET', '/movements', 'jwt-vet')).statusCode).toBe(200);
  });

  it('POST /movements con viewer -> 403', async () => {
    const app = buildMovementsApp(createMovementRepository());
    const response = await callApp(app, 'POST', '/movements', 'jwt-viewer', {
      animal_id: ANIMAL_ID,
      reason: 'management',
      to_pen_id: TO_PEN_ID,
    });
    expect(response.statusCode).toBe(403);
  });

  it('GET /animals/:id/movements con operator -> 200', async () => {
    const app = buildMovementsApp(createMovementRepository());
    const response = await callApp(
      app,
      'GET',
      `/animals/${ANIMAL_ID}/movements`,
      'jwt-operator',
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([MOVEMENT]);
  });

  it('fail-closed: sin movementRepository responde 503', async () => {
    const app = buildMovementsApp();
    expect((await callApp(app, 'GET', '/movements', 'jwt-admin')).statusCode).toBe(503);
  });
});

describe('movements: validacion de entrada', () => {
  it('POST /movements sin animal_id -> 400', async () => {
    const app = buildMovementsApp(createMovementRepository());
    const response = await callApp(app, 'POST', '/movements', 'jwt-admin', {
      reason: 'management',
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST /movements con reason invalido -> 400', async () => {
    const app = buildMovementsApp(createMovementRepository());
    const response = await callApp(app, 'POST', '/movements', 'jwt-admin', {
      animal_id: ANIMAL_ID,
      reason: 'reproduccion',
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST /movements con to_pen_id no UUID -> 400', async () => {
    const app = buildMovementsApp(createMovementRepository());
    const response = await callApp(app, 'POST', '/movements', 'jwt-admin', {
      animal_id: ANIMAL_ID,
      reason: 'management',
      to_pen_id: 'corral-1',
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST /movements con moved_at sin zona horaria -> 400', async () => {
    const app = buildMovementsApp(createMovementRepository());
    const response = await callApp(app, 'POST', '/movements', 'jwt-admin', {
      animal_id: ANIMAL_ID,
      reason: 'management',
      to_pen_id: TO_PEN_ID,
      moved_at: '2026-01-02T10:00:00',
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST /movements con campo no permitido (recorded_by) -> 400', async () => {
    const app = buildMovementsApp(createMovementRepository());
    const response = await callApp(app, 'POST', '/movements', 'jwt-admin', {
      animal_id: ANIMAL_ID,
      reason: 'management',
      to_pen_id: TO_PEN_ID,
      recorded_by: 'u-admin',
    });
    expect(response.statusCode).toBe(400);
  });

  it('GET /movements/:id con id no UUID -> 400', async () => {
    const app = buildMovementsApp(createMovementRepository());
    expect(
      (await callApp(app, 'GET', '/movements/no-uuid', 'jwt-admin')).statusCode,
    ).toBe(400);
  });

  it('GET /movements?limit=0 -> 400', async () => {
    const app = buildMovementsApp(createMovementRepository());
    expect((await callApp(app, 'GET', '/movements?limit=0', 'jwt-admin')).statusCode).toBe(
      400,
    );
  });

  it('GET /movements?limit=9999 -> 400', async () => {
    const app = buildMovementsApp(createMovementRepository());
    expect(
      (await callApp(app, 'GET', '/movements?limit=9999', 'jwt-admin')).statusCode,
    ).toBe(400);
  });
});

describe('movements: registro y reglas de negocio', () => {
  it('POST movimiento interno valido -> 201 y autor del JWT', async () => {
    const repository = createMovementRepository();
    const app = buildMovementsApp(repository);
    const response = await callApp(app, 'POST', '/movements', 'jwt-operator', {
      animal_id: ANIMAL_ID,
      reason: 'management',
      to_pen_id: TO_PEN_ID,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ animal_id: ANIMAL_ID, recorded_by: 'u-operator' });
    // El origen se completa con la ubicacion actual y no se toca animals.
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        animal_id: ANIMAL_ID,
        from_pen_id: FROM_PEN_ID,
        to_pen_id: TO_PEN_ID,
        reason: 'management',
      }),
      'u-operator',
      'jwt-operator',
    );
  });

  it('POST movimiento con from_pen_id distinto del actual -> 400', async () => {
    const app = buildMovementsApp(createMovementRepository());
    const response = await callApp(app, 'POST', '/movements', 'jwt-admin', {
      animal_id: ANIMAL_ID,
      reason: 'management',
      from_pen_id: TO_PEN_ID,
      to_pen_id: TO_PEN_ID,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });
  });

  it('POST movimiento al mismo corral actual -> 400', async () => {
    const app = buildMovementsApp(createMovementRepository());
    const response = await callApp(app, 'POST', '/movements', 'jwt-admin', {
      animal_id: ANIMAL_ID,
      reason: 'management',
      to_pen_id: FROM_PEN_ID,
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST animal inexistente -> 404', async () => {
    const repository = createMovementRepository({
      findAnimal: vi.fn(async () => null),
    });
    const app = buildMovementsApp(repository);
    const response = await callApp(app, 'POST', '/movements', 'jwt-admin', {
      animal_id: UNKNOWN_ID,
      reason: 'management',
      to_pen_id: TO_PEN_ID,
    });
    expect(response.statusCode).toBe(404);
  });

  it('POST animal vendido -> 400 (estado incompatible)', async () => {
    const repository = createMovementRepository({
      findAnimal: vi.fn(async () => ({ ...ANIMAL, status: 'sold' as const })),
    });
    const app = buildMovementsApp(repository);
    const response = await callApp(app, 'POST', '/movements', 'jwt-admin', {
      animal_id: ANIMAL_ID,
      reason: 'management',
      to_pen_id: TO_PEN_ID,
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST animal muerto -> 400 (estado incompatible)', async () => {
    const repository = createMovementRepository({
      findAnimal: vi.fn(async () => ({ ...ANIMAL, status: 'dead' as const })),
    });
    const app = buildMovementsApp(repository);
    const response = await callApp(app, 'POST', '/movements', 'jwt-manager', {
      animal_id: ANIMAL_ID,
      reason: 'health_isolation',
      to_pen_id: TO_PEN_ID,
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST movimiento interno sin corral destino -> 400', async () => {
    const app = buildMovementsApp(createMovementRepository());
    const response = await callApp(app, 'POST', '/movements', 'jwt-operator', {
      animal_id: ANIMAL_ID,
      reason: 'management',
      to_pen_id: null,
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST venta con corral destino -> 400', async () => {
    const app = buildMovementsApp(createMovementRepository());
    const response = await callApp(app, 'POST', '/movements', 'jwt-admin', {
      animal_id: ANIMAL_ID,
      reason: 'sale',
      to_pen_id: TO_PEN_ID,
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST venta por admin -> 201', async () => {
    const app = buildMovementsApp(createMovementRepository());
    const response = await callApp(app, 'POST', '/movements', 'jwt-admin', {
      animal_id: ANIMAL_ID,
      reason: 'sale',
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ reason: 'sale', to_pen_id: null });
  });

  it('POST venta por operator -> 403 (no autoriza salidas externas)', async () => {
    const app = buildMovementsApp(createMovementRepository());
    const response = await callApp(app, 'POST', '/movements', 'jwt-operator', {
      animal_id: ANIMAL_ID,
      reason: 'sale',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'forbidden' });
  });

  it('POST transferencia externa por operator -> 403', async () => {
    const app = buildMovementsApp(createMovementRepository());
    const response = await callApp(app, 'POST', '/movements', 'jwt-operator', {
      animal_id: ANIMAL_ID,
      reason: 'transfer',
    });
    expect(response.statusCode).toBe(403);
  });

  it('POST transferencia externa por manager -> 201', async () => {
    const app = buildMovementsApp(createMovementRepository());
    const response = await callApp(app, 'POST', '/movements', 'jwt-manager', {
      animal_id: ANIMAL_ID,
      reason: 'transfer',
    });
    expect(response.statusCode).toBe(201);
  });

  it('POST transferencia interna por operator -> 201', async () => {
    const app = buildMovementsApp(createMovementRepository());
    const response = await callApp(app, 'POST', '/movements', 'jwt-operator', {
      animal_id: ANIMAL_ID,
      reason: 'transfer',
      to_pen_id: TO_PEN_ID,
    });
    expect(response.statusCode).toBe(201);
  });

  it('POST aislamiento sanitario por veterinarian -> 201', async () => {
    const app = buildMovementsApp(createMovementRepository());
    const response = await callApp(app, 'POST', '/movements', 'jwt-vet', {
      animal_id: ANIMAL_ID,
      reason: 'health_isolation',
      to_pen_id: TO_PEN_ID,
    });
    expect(response.statusCode).toBe(201);
  });

  it('POST movimiento interno por veterinarian -> 403', async () => {
    const app = buildMovementsApp(createMovementRepository());
    const response = await callApp(app, 'POST', '/movements', 'jwt-vet', {
      animal_id: ANIMAL_ID,
      reason: 'management',
      to_pen_id: TO_PEN_ID,
    });
    expect(response.statusCode).toBe(403);
  });

  it('POST corral destino inactivo -> 400', async () => {
    const repository = createMovementRepository({
      findPen: vi.fn(async () => ({ ...PEN, status: 'inactive' as const })),
    });
    const app = buildMovementsApp(repository);
    const response = await callApp(app, 'POST', '/movements', 'jwt-admin', {
      animal_id: ANIMAL_ID,
      reason: 'management',
      to_pen_id: TO_PEN_ID,
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST area del corral destino inactiva -> 400', async () => {
    const repository = createMovementRepository({
      findPen: vi.fn(async () => ({ ...PEN, area_status: 'inactive' as const })),
    });
    const app = buildMovementsApp(repository);
    const response = await callApp(app, 'POST', '/movements', 'jwt-admin', {
      animal_id: ANIMAL_ID,
      reason: 'management',
      to_pen_id: TO_PEN_ID,
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST corral destino inexistente -> 422', async () => {
    const repository = createMovementRepository({
      findPen: vi.fn(async () => null),
    });
    const app = buildMovementsApp(repository);
    const response = await callApp(app, 'POST', '/movements', 'jwt-admin', {
      animal_id: ANIMAL_ID,
      reason: 'management',
      to_pen_id: TO_PEN_ID,
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: 'invalid_reference' });
  });

  it('POST referencia invalida reportada por la base -> 422', async () => {
    const repository = createMovementRepository({
      create: vi.fn(async () => {
        throw new ForeignKeyError();
      }),
    });
    const app = buildMovementsApp(repository);
    const response = await callApp(app, 'POST', '/movements', 'jwt-admin', {
      animal_id: ANIMAL_ID,
      reason: 'management',
      to_pen_id: TO_PEN_ID,
    });
    expect(response.statusCode).toBe(422);
  });
});

describe('movements: historial y proteccion', () => {
  it('GET /movements propaga los filtros al repositorio', async () => {
    const repository = createMovementRepository();
    const app = buildMovementsApp(repository);
    const response = await callApp(
      app,
      'GET',
      `/movements?animal_id=${ANIMAL_ID}&reason=weaning&limit=10&offset=5`,
      'jwt-operator',
    );
    expect(response.statusCode).toBe(200);
    expect(repository.list).toHaveBeenCalledWith(
      expect.objectContaining({
        animal_id: ANIMAL_ID,
        reason: 'weaning',
        limit: 10,
        offset: 5,
      }),
      'jwt-operator',
    );
  });

  it('GET /movements/:id inexistente -> 404', async () => {
    const repository = createMovementRepository({
      findById: vi.fn(async () => null),
    });
    const app = buildMovementsApp(repository);
    expect(
      (await callApp(app, 'GET', `/movements/${MOVEMENT_ID}`, 'jwt-admin')).statusCode,
    ).toBe(404);
  });

  it('GET /animals/:id/movements filtra por el porcino', async () => {
    const repository = createMovementRepository();
    const app = buildMovementsApp(repository);
    const response = await callApp(
      app,
      'GET',
      `/animals/${ANIMAL_ID}/movements`,
      'jwt-vet',
    );
    expect(response.statusCode).toBe(200);
    expect(repository.list).toHaveBeenCalledWith(
      expect.objectContaining({ animal_id: ANIMAL_ID }),
      'jwt-vet',
    );
  });

  it('GET /animals/:id/movements de porcino inexistente -> 404', async () => {
    const repository = createMovementRepository({
      findAnimal: vi.fn(async () => null),
    });
    const app = buildMovementsApp(repository);
    expect(
      (await callApp(app, 'GET', `/animals/${ANIMAL_ID}/movements`, 'jwt-admin'))
        .statusCode,
    ).toBe(404);
  });

  it('el historial es inmutable: no hay DELETE ni PATCH de movimientos', async () => {
    const app = buildMovementsApp(createMovementRepository());
    expect(
      (await callApp(app, 'DELETE', `/movements/${MOVEMENT_ID}`, 'jwt-admin')).statusCode,
    ).toBe(404);
    expect(
      (await callApp(app, 'PATCH', `/movements/${MOVEMENT_ID}`, 'jwt-admin', {
        reason: 'other',
      })).statusCode,
    ).toBe(404);
    expect(
      (await callApp(app, 'PUT', `/movements/${MOVEMENT_ID}`, 'jwt-admin', {
        reason: 'other',
      })).statusCode,
    ).toBe(404);
  });
});
