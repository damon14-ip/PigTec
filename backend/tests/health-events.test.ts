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
  CreateHealthEventInput,
  HealthEvent,
  HealthEventAnimalSnapshot,
  HealthEventRepository,
} from '../src/modules/health/health-events.repository.js';

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

const EVENT_ID = '77777777-7777-7777-7777-777777777777';
const ANIMAL_ID = '33333333-3333-3333-3333-333333333333';
const UNKNOWN_ID = '99999999-9999-9999-9999-999999999999';

const ANIMAL: HealthEventAnimalSnapshot = { id: ANIMAL_ID, status: 'active' };

const EVENT: HealthEvent = {
  id: EVENT_ID,
  animal_id: ANIMAL_ID,
  event_type: 'observation',
  occurred_at: '2026-02-01T09:00:00.000Z',
  title: 'Porcino decaido',
  description: null,
  documented_by: null,
  details: {},
  attachment_url: null,
  recorded_by: 'u-operator',
  created_at: '2026-02-01T09:00:00.000Z',
  updated_at: '2026-02-01T09:00:00.000Z',
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

function createHealthEventRepository(
  overrides: Partial<HealthEventRepository> = {},
): HealthEventRepository {
  return {
    list: vi.fn(async () => [EVENT]),
    findById: vi.fn(async () => EVENT),
    create: vi.fn(async (input: CreateHealthEventInput, recordedBy: string) => ({
      ...EVENT,
      ...input,
      recorded_by: recordedBy,
    })),
    findAnimal: vi.fn(async () => ANIMAL),
    ...overrides,
  };
}

function buildHealthApp(repository?: HealthEventRepository) {
  return buildApp({
    logger: false,
    tokenVerifier: createVerifier(),
    profileRepository: createProfileRepository(),
    ...(repository ? { healthEventRepository: repository } : {}),
  });
}

function callApp(
  app: ReturnType<typeof buildHealthApp>,
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

describe('health-events: autenticacion y permisos', () => {
  it('GET /health-events sin token -> 401', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    expect((await callApp(app, 'GET', '/health-events')).statusCode).toBe(401);
  });

  it('GET /health-events con viewer -> 403', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    expect(
      (await callApp(app, 'GET', '/health-events', 'jwt-viewer')).statusCode,
    ).toBe(403);
  });

  it('GET /health-events con usuario inactivo -> 403', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    expect(
      (await callApp(app, 'GET', '/health-events', 'jwt-inactive')).statusCode,
    ).toBe(403);
  });

  it('GET /health-events con operator -> 200', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    const response = await callApp(app, 'GET', '/health-events', 'jwt-operator');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([EVENT]);
  });

  it('GET /health-events con veterinarian -> 200', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    expect(
      (await callApp(app, 'GET', '/health-events', 'jwt-vet')).statusCode,
    ).toBe(200);
  });

  it('POST /health-events con viewer -> 403', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    const response = await callApp(app, 'POST', '/health-events', 'jwt-viewer', {
      animal_id: ANIMAL_ID,
      event_type: 'observation',
      title: 'Observacion',
    });
    expect(response.statusCode).toBe(403);
  });

  it('GET /animals/:id/health-events con operator -> 200', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    const response = await callApp(
      app,
      'GET',
      `/animals/${ANIMAL_ID}/health-events`,
      'jwt-operator',
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([EVENT]);
  });

  it('fail-closed: sin healthEventRepository responde 503', async () => {
    const app = buildHealthApp();
    expect(
      (await callApp(app, 'GET', '/health-events', 'jwt-admin')).statusCode,
    ).toBe(503);
  });
});

describe('health-events: validacion de entrada', () => {
  it('POST sin animal_id -> 400', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    const response = await callApp(app, 'POST', '/health-events', 'jwt-vet', {
      event_type: 'observation',
      title: 'Observacion',
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST sin event_type -> 400', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    const response = await callApp(app, 'POST', '/health-events', 'jwt-vet', {
      animal_id: ANIMAL_ID,
      title: 'Observacion',
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST con event_type no permitido -> 400', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    const response = await callApp(app, 'POST', '/health-events', 'jwt-vet', {
      animal_id: ANIMAL_ID,
      event_type: 'cirugia',
      title: 'Operacion',
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST sin title -> 400', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    const response = await callApp(app, 'POST', '/health-events', 'jwt-vet', {
      animal_id: ANIMAL_ID,
      event_type: 'observation',
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST con title vacio -> 400', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    const response = await callApp(app, 'POST', '/health-events', 'jwt-vet', {
      animal_id: ANIMAL_ID,
      event_type: 'observation',
      title: '   ',
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST con occurred_at sin zona horaria -> 400', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    const response = await callApp(app, 'POST', '/health-events', 'jwt-vet', {
      animal_id: ANIMAL_ID,
      event_type: 'observation',
      title: 'Observacion',
      occurred_at: '2026-02-01T09:00:00',
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST con details no objeto (arreglo) -> 400', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    const response = await callApp(app, 'POST', '/health-events', 'jwt-vet', {
      animal_id: ANIMAL_ID,
      event_type: 'observation',
      title: 'Observacion',
      details: [1, 2, 3],
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST con campo no permitido (recorded_by) -> 400', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    const response = await callApp(app, 'POST', '/health-events', 'jwt-vet', {
      animal_id: ANIMAL_ID,
      event_type: 'observation',
      title: 'Observacion',
      recorded_by: 'u-admin',
    });
    expect(response.statusCode).toBe(400);
  });

  it('GET /health-events/:id con id no UUID -> 400', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    expect(
      (await callApp(app, 'GET', '/health-events/no-uuid', 'jwt-admin'))
        .statusCode,
    ).toBe(400);
  });

  it('GET /health-events?limit=0 -> 400', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    expect(
      (await callApp(app, 'GET', '/health-events?limit=0', 'jwt-admin'))
        .statusCode,
    ).toBe(400);
  });

  it('GET /health-events?limit=9999 -> 400', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    expect(
      (await callApp(app, 'GET', '/health-events?limit=9999', 'jwt-admin'))
        .statusCode,
    ).toBe(400);
  });

  it('GET /health-events?event_type invalido -> 400', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    expect(
      (await callApp(app, 'GET', '/health-events?event_type=cirugia', 'jwt-admin'))
        .statusCode,
    ).toBe(400);
  });
});

describe('health-events: registro y reglas de negocio', () => {
  it('POST observacion por operator -> 201 y autor del JWT', async () => {
    const repository = createHealthEventRepository();
    const app = buildHealthApp(repository);
    const response = await callApp(app, 'POST', '/health-events', 'jwt-operator', {
      animal_id: ANIMAL_ID,
      event_type: 'observation',
      title: 'Porcino decaido',
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      animal_id: ANIMAL_ID,
      event_type: 'observation',
      recorded_by: 'u-operator',
    });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        animal_id: ANIMAL_ID,
        event_type: 'observation',
        title: 'Porcino decaido',
      }),
      'u-operator',
      'jwt-operator',
    );
  });

  it('POST sintoma por veterinarian -> 201', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    const response = await callApp(app, 'POST', '/health-events', 'jwt-vet', {
      animal_id: ANIMAL_ID,
      event_type: 'symptom_report',
      title: 'Cojea',
    });
    expect(response.statusCode).toBe(201);
  });

  it('POST diagnostico por veterinarian -> 201', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    const response = await callApp(app, 'POST', '/health-events', 'jwt-vet', {
      animal_id: ANIMAL_ID,
      event_type: 'documented_diagnosis',
      title: 'Neumonia',
    });
    expect(response.statusCode).toBe(201);
  });

  it('POST diagnostico por operator -> 403 (evento clinico)', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    const response = await callApp(app, 'POST', '/health-events', 'jwt-operator', {
      animal_id: ANIMAL_ID,
      event_type: 'documented_diagnosis',
      title: 'Neumonia',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'forbidden' });
  });

  it('POST diagnostico por admin -> 403 (politica clinica pendiente)', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    const response = await callApp(app, 'POST', '/health-events', 'jwt-admin', {
      animal_id: ANIMAL_ID,
      event_type: 'diagnosis',
      title: 'Neumonia',
    });
    // 'diagnosis' no es un tipo valido: 400. Se repite con el tipo real.
    expect(response.statusCode).toBe(400);

    const valid = await callApp(app, 'POST', '/health-events', 'jwt-admin', {
      animal_id: ANIMAL_ID,
      event_type: 'documented_diagnosis',
      title: 'Neumonia',
    });
    expect(valid.statusCode).toBe(403);
  });

  it('POST vacunacion por veterinarian -> 201', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    const response = await callApp(app, 'POST', '/health-events', 'jwt-vet', {
      animal_id: ANIMAL_ID,
      event_type: 'vaccination',
      title: 'Vacuna',
    });
    expect(response.statusCode).toBe(201);
  });

  it('POST mortalidad por manager -> 201', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    const response = await callApp(app, 'POST', '/health-events', 'jwt-manager', {
      animal_id: ANIMAL_ID,
      event_type: 'mortality',
      title: 'Muerte por enfermedad',
    });
    expect(response.statusCode).toBe(201);
  });

  it('POST mortalidad por veterinarian -> 201', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    const response = await callApp(app, 'POST', '/health-events', 'jwt-vet', {
      animal_id: ANIMAL_ID,
      event_type: 'mortality',
      title: 'Muerte por enfermedad',
    });
    expect(response.statusCode).toBe(201);
  });

  it('POST mortalidad por operator -> 403', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    const response = await callApp(app, 'POST', '/health-events', 'jwt-operator', {
      animal_id: ANIMAL_ID,
      event_type: 'mortality',
      title: 'Muerte por enfermedad',
    });
    expect(response.statusCode).toBe(403);
  });

  it('POST animal inexistente -> 404', async () => {
    const repository = createHealthEventRepository({
      findAnimal: vi.fn(async () => null),
    });
    const app = buildHealthApp(repository);
    const response = await callApp(app, 'POST', '/health-events', 'jwt-vet', {
      animal_id: UNKNOWN_ID,
      event_type: 'observation',
      title: 'Observacion',
    });
    expect(response.statusCode).toBe(404);
  });

  it('POST sobre animal muerto -> 400 (estado incompatible)', async () => {
    const repository = createHealthEventRepository({
      findAnimal: vi.fn(async () => ({ ...ANIMAL, status: 'dead' as const })),
    });
    const app = buildHealthApp(repository);
    const response = await callApp(app, 'POST', '/health-events', 'jwt-vet', {
      animal_id: ANIMAL_ID,
      event_type: 'observation',
      title: 'Observacion',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });
  });

  it('POST sobre animal vendido -> 400', async () => {
    const repository = createHealthEventRepository({
      findAnimal: vi.fn(async () => ({ ...ANIMAL, status: 'sold' as const })),
    });
    const app = buildHealthApp(repository);
    const response = await callApp(app, 'POST', '/health-events', 'jwt-vet', {
      animal_id: ANIMAL_ID,
      event_type: 'observation',
      title: 'Observacion',
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST sobre animal dado de baja (inactive) -> 400', async () => {
    const repository = createHealthEventRepository({
      findAnimal: vi.fn(async () => ({ ...ANIMAL, status: 'inactive' as const })),
    });
    const app = buildHealthApp(repository);
    const response = await callApp(app, 'POST', '/health-events', 'jwt-vet', {
      animal_id: ANIMAL_ID,
      event_type: 'observation',
      title: 'Observacion',
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST sobre animal missing -> 201 (estado admitido)', async () => {
    const repository = createHealthEventRepository({
      findAnimal: vi.fn(async () => ({ ...ANIMAL, status: 'missing' as const })),
    });
    const app = buildHealthApp(repository);
    const response = await callApp(app, 'POST', '/health-events', 'jwt-operator', {
      animal_id: ANIMAL_ID,
      event_type: 'observation',
      title: 'Hallazgo',
    });
    expect(response.statusCode).toBe(201);
  });

  it('POST referencia invalida reportada por la base -> 422', async () => {
    const repository = createHealthEventRepository({
      create: vi.fn(async () => {
        throw new ForeignKeyError();
      }),
    });
    const app = buildHealthApp(repository);
    const response = await callApp(app, 'POST', '/health-events', 'jwt-vet', {
      animal_id: ANIMAL_ID,
      event_type: 'observation',
      title: 'Observacion',
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: 'invalid_reference' });
  });
});

describe('health-events: historial y proteccion (mortalidad)', () => {
  it('la mortalidad NO escribe campos derivados: solo registra el evento', async () => {
    const repository = createHealthEventRepository();
    const app = buildHealthApp(repository);
    const response = await callApp(app, 'POST', '/health-events', 'jwt-vet', {
      animal_id: ANIMAL_ID,
      event_type: 'mortality',
      title: 'Muerte',
    });
    expect(response.statusCode).toBe(201);

    const createMock = repository.create as unknown as {
      mock: { calls: [CreateHealthEventInput, string, string][] };
    };
    const [input, recordedBy] = createMock.mock.calls[0];
    expect(recordedBy).toBe('u-vet');
    // El backend no fija status/current_pen_id/exit_date: los deriva el trigger.
    expect(input).not.toHaveProperty('status');
    expect(input).not.toHaveProperty('current_pen_id');
    expect(input).not.toHaveProperty('exit_date');
  });

  it('GET /health-events propaga los filtros al repositorio', async () => {
    const repository = createHealthEventRepository();
    const app = buildHealthApp(repository);
    const response = await callApp(
      app,
      'GET',
      `/health-events?animal_id=${ANIMAL_ID}&event_type=vaccination&limit=10&offset=5`,
      'jwt-vet',
    );
    expect(response.statusCode).toBe(200);
    expect(repository.list).toHaveBeenCalledWith(
      expect.objectContaining({
        animal_id: ANIMAL_ID,
        event_type: 'vaccination',
        limit: 10,
        offset: 5,
      }),
      'jwt-vet',
    );
  });

  it('GET /health-events/:id inexistente -> 404', async () => {
    const repository = createHealthEventRepository({
      findById: vi.fn(async () => null),
    });
    const app = buildHealthApp(repository);
    expect(
      (await callApp(app, 'GET', `/health-events/${EVENT_ID}`, 'jwt-admin'))
        .statusCode,
    ).toBe(404);
  });

  it('GET /animals/:id/health-events filtra por el porcino', async () => {
    const repository = createHealthEventRepository();
    const app = buildHealthApp(repository);
    const response = await callApp(
      app,
      'GET',
      `/animals/${ANIMAL_ID}/health-events`,
      'jwt-vet',
    );
    expect(response.statusCode).toBe(200);
    expect(repository.list).toHaveBeenCalledWith(
      expect.objectContaining({ animal_id: ANIMAL_ID }),
      'jwt-vet',
    );
  });

  it('GET /animals/:id/health-events de porcino inexistente -> 404', async () => {
    const repository = createHealthEventRepository({
      findAnimal: vi.fn(async () => null),
    });
    const app = buildHealthApp(repository);
    expect(
      (
        await callApp(
          app,
          'GET',
          `/animals/${ANIMAL_ID}/health-events`,
          'jwt-admin',
        )
      ).statusCode,
    ).toBe(404);
  });

  it('el historial es inmutable: no hay DELETE, PATCH ni PUT de eventos', async () => {
    const app = buildHealthApp(createHealthEventRepository());
    expect(
      (await callApp(app, 'DELETE', `/health-events/${EVENT_ID}`, 'jwt-admin'))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await callApp(app, 'PATCH', `/health-events/${EVENT_ID}`, 'jwt-admin', {
          title: 'corregido',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await callApp(app, 'PUT', `/health-events/${EVENT_ID}`, 'jwt-admin', {
          title: 'corregido',
        })
      ).statusCode,
    ).toBe(404);
  });
});
