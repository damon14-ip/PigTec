import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import {
  type ProfileRepository,
  type UserProfile,
} from '../src/modules/auth/profile-repository.js';
import type {
  AuthenticatedUser,
  TokenVerifier,
} from '../src/modules/auth/token-verifier.js';
import type {
  AssistantCompletion,
  AssistantMessage,
  AssistantProvider,
} from '../src/modules/assistant/assistant.provider.js';
import {
  createInMemoryAssistantQuota,
  type AssistantQuota,
} from '../src/modules/assistant/assistant.quota.js';
import {
  recognizeDataQuery,
} from '../src/modules/assistant/assistant.data-answers.js';
import { MAX_MOVEMENTS } from '../src/modules/assistant/assistant.tools.js';
import { DataAccessError } from '../src/modules/common/data-errors.js';
import type {
  Animal,
  AnimalLocation,
  AnimalRepository,
} from '../src/modules/animals/animals.repository.js';
import type {
  ListMovementsFilter,
  Movement,
  MovementRepository,
} from '../src/modules/movements/movements.repository.js';
import type { Pen, PenRepository } from '../src/modules/pens/pens.repository.js';

/**
 * Pruebas de las CONSULTAS DE DATOS de solo lectura del asistente.
 *
 * Se inyectan repositorios simulados: NUNCA se llama a Supabase ni a Groq. Se
 * comprueba el reconocimiento determinista, el contrato HTTP (`source: "data"`),
 * la autorizacion, los parametros invalidos, los fallos controlados, la ausencia
 * de escrituras y que estas consultas NO consumen cuota del proveedor.
 */

/* -------------------------------------------------------------------------- */
/* Dobles                                                                    */
/* -------------------------------------------------------------------------- */

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
const OTHER_PEN_ID = '44444444-4444-4444-4444-444444444444';
const AREA_ID = '11111111-1111-1111-1111-111111111111';
const CODE = 'PIG-000123';

const ANIMAL: Animal = {
  id: ANIMAL_ID,
  animal_code: CODE,
  ear_tag_code: null,
  sex: 'female',
  breed: 'Duroc',
  birth_date: '2025-12-01',
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
    area: { id: AREA_ID, name: 'Maternidad', status: 'active' },
  },
};

const PEN: Pen = {
  id: PEN_ID,
  area_id: AREA_ID,
  code: 'C-01',
  name: null,
  capacity: null,
  notes: null,
  status: 'active',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const OTHER_PEN: Pen = { ...PEN, id: OTHER_PEN_ID, code: 'C-02' };

const MOVEMENTS: Movement[] = [
  {
    id: '55555555-5555-5555-5555-555555555551',
    animal_id: ANIMAL_ID,
    from_pen_id: null,
    to_pen_id: PEN_ID,
    moved_at: '2026-01-01T10:00:00.000Z',
    reason: 'management',
    notes: null,
    recorded_by: 'u-operator',
    created_at: '2026-01-01T10:00:00.000Z',
  },
  {
    id: '55555555-5555-5555-5555-555555555552',
    animal_id: ANIMAL_ID,
    from_pen_id: PEN_ID,
    to_pen_id: OTHER_PEN_ID,
    moved_at: '2026-01-05T10:00:00.000Z',
    reason: 'weaning',
    notes: null,
    recorded_by: 'u-operator',
    created_at: '2026-01-05T10:00:00.000Z',
  },
];

const COMPLETION: AssistantCompletion = {
  reply: 'Respuesta del proveedor.',
  usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
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

/** Escritura prohibida: si el asistente la invocara, la prueba fallaria. */
function forbiddenWrite(): () => Promise<never> {
  return vi.fn(async () => {
    throw new Error('escritura no permitida desde el asistente');
  });
}

interface ReadDoubles {
  animalRepository: AnimalRepository;
  movementRepository: MovementRepository;
  penRepository: PenRepository;
  countByStatus: ReturnType<typeof vi.fn>;
  findByCode: ReturnType<typeof vi.fn>;
  findLocation: ReturnType<typeof vi.fn>;
  listMovements: ReturnType<typeof vi.fn>;
  writes: ReturnType<typeof vi.fn>[];
}

function createReadDoubles(
  options: {
    counts?: Partial<Record<string, number>>;
    animal?: Animal | null;
    movements?: Movement[];
  } = {},
): ReadDoubles {
  const counts = options.counts ?? { active: 3, sold: 1 };
  const animal = options.animal === undefined ? ANIMAL : options.animal;
  const movements = options.movements ?? MOVEMENTS;

  const countByStatus = vi.fn(async (status: string) => counts[status] ?? 0);
  const findByCode = vi.fn(async () => animal);
  const findLocation = vi.fn(async () => LOCATION);
  const listMovements = vi.fn(async (_filter: ListMovementsFilter) => movements);

  const create = forbiddenWrite();
  const update = forbiddenWrite();
  const setStatus = forbiddenWrite();
  const createMovement = forbiddenWrite();

  const animalRepository: AnimalRepository = {
    list: vi.fn(async () => (animal ? [animal] : [])),
    findById: vi.fn(async () => animal),
    findByCode,
    countByStatus,
    create,
    update,
    setStatus,
    findLocation,
  };

  const movementRepository: MovementRepository = {
    list: listMovements,
    findById: vi.fn(async () => null),
    create: createMovement,
    findAnimal: vi.fn(async () => null),
    findPen: vi.fn(async () => null),
  };

  const penRepository: PenRepository = {
    list: vi.fn(async () => [PEN, OTHER_PEN]),
    findById: vi.fn(async (id: string) => {
      if (id === PEN_ID) return PEN;
      if (id === OTHER_PEN_ID) return OTHER_PEN;
      return null;
    }),
    create: forbiddenWrite(),
    update: forbiddenWrite(),
    setStatus: forbiddenWrite(),
  };

  return {
    animalRepository,
    movementRepository,
    penRepository,
    countByStatus,
    findByCode,
    findLocation,
    listMovements,
    writes: [
      animalRepository.create,
      animalRepository.update,
      animalRepository.setStatus,
      movementRepository.create,
      penRepository.create,
      penRepository.update,
      penRepository.setStatus,
    ] as ReturnType<typeof vi.fn>[],
  };
}

function spyProvider(
  impl: (messages: readonly AssistantMessage[]) => Promise<AssistantCompletion>,
): { provider: AssistantProvider; complete: ReturnType<typeof vi.fn> } {
  const complete = vi.fn(impl);
  return { provider: { complete } as AssistantProvider, complete };
}

function buildChatApp(
  doubles: ReadDoubles,
  options: { provider?: AssistantProvider; quota?: AssistantQuota } = {},
) {
  const provider = options.provider ?? spyProvider(async () => COMPLETION).provider;
  const quota = options.quota ?? createInMemoryAssistantQuota({ limit: 20 });

  const app = buildApp({
    logger: false,
    tokenVerifier: createVerifier(),
    profileRepository: createProfileRepository(),
    animalRepository: doubles.animalRepository,
    movementRepository: doubles.movementRepository,
    penRepository: doubles.penRepository,
    assistantProvider: provider,
    assistantQuota: quota,
  });

  return { app, provider, quota };
}

function callChat(
  app: ReturnType<typeof buildApp>,
  token: string | undefined,
  message: string,
) {
  return app.inject({
    method: 'POST',
    url: '/assistant/chat',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload: { message },
  });
}

/* -------------------------------------------------------------------------- */
/* Reconocimiento determinista                                               */
/* -------------------------------------------------------------------------- */

describe('consulta de datos: reconocimiento determinista', () => {
  it.each([
    ['¿Cuál es el resumen de porcinos por estado?', { kind: 'summary' }],
    ['¿Cuántos porcinos hay?', { kind: 'summary' }],
    ['total de animales', { kind: 'summary' }],
    ['¿Dónde está el porcino PIG-000123?', { kind: 'lookup', code: 'PIG-000123' }],
    ['Ubicación del animal PIG-000123', { kind: 'lookup', code: 'PIG-000123' }],
    ['PIG 000123 ubicacion', { kind: 'lookup', code: 'PIG-000123' }],
    ['Muéstrame los movimientos de PIG-000123', { kind: 'movements', code: 'PIG-000123' }],
    [
      'movimientos recientes del porcino PIG-000123',
      { kind: 'movements', code: 'PIG-000123' },
    ],
  ])('%s', (message, expected) => {
    expect(recognizeDataQuery(message)).toEqual(expected);
  });

  it('intencion de datos sin codigo -> invalid (missing_code)', () => {
    expect(recognizeDataQuery('¿Dónde está el porcino?')).toEqual({
      kind: 'invalid',
      reason: 'missing_code',
    });
  });

  it('codigo con formato incorrecto -> invalid (malformed_code)', () => {
    expect(recognizeDataQuery('¿Dónde está el porcino PIG-12?')).toEqual({
      kind: 'invalid',
      reason: 'malformed_code',
    });
  });

  it('pregunta ambigua (dos herramientas) -> null (va al proveedor)', () => {
    expect(
      recognizeDataQuery('movimientos recientes y ubicación del porcino PIG-000123'),
    ).toBeNull();
  });

  it.each([
    ['procedimiento', '¿Cómo registro un movimiento para un animal?'],
    ['conversacion', 'Hola'],
    ['concepto', '¿Qué es un corral?'],
    ['fuera de alcance', '¿Cuál es el precio del maíz?'],
  ])('%s -> null (no es consulta de datos)', (_label, message) => {
    expect(recognizeDataQuery(message)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Integracion con POST /assistant/chat                                       */
/* -------------------------------------------------------------------------- */

describe('POST /assistant/chat: resumen de porcinos', () => {
  it('responde con source data, usage null y sin consumir cuota', async () => {
    const doubles = createReadDoubles({ counts: { active: 3, sold: 1 } });
    const { provider, complete } = spyProvider(async () => COMPLETION);
    const quota = createInMemoryAssistantQuota({ limit: 20 });
    const { app } = buildChatApp(doubles, { provider, quota });

    const response = await callChat(
      app,
      'jwt-operator',
      '¿Cuál es el resumen de porcinos por estado?',
    );

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.source).toBe('data');
    expect(body.usage).toBeNull();
    expect(body.quotaRemaining).toBe(20);
    expect(body.reply).toContain('total: 4');
    expect(body.reply).toContain('activos: 3');
    expect(body.reply).toContain('vendidos: 1');

    expect(complete).not.toHaveBeenCalled();
    expect(quota.remaining()).toBe(20);
  });

  it('sin registros responde que no se encontraron (sin inventar)', async () => {
    const doubles = createReadDoubles({ counts: {} });
    const { app } = buildChatApp(doubles);

    const response = await callChat(app, 'jwt-vet', '¿Cuántos porcinos hay?');
    expect(response.statusCode).toBe(200);
    expect(response.json().reply).toContain('No se encontraron porcinos');
  });
});

describe('POST /assistant/chat: ubicacion por codigo', () => {
  it('devuelve la ubicacion actual del porcino (area y corral)', async () => {
    const doubles = createReadDoubles();
    const { provider, complete } = spyProvider(async () => COMPLETION);
    const quota = createInMemoryAssistantQuota({ limit: 20 });
    const { app } = buildChatApp(doubles, { provider, quota });

    const response = await callChat(
      app,
      'jwt-operator',
      '¿Dónde está el porcino PIG-000123?',
    );

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.source).toBe('data');
    expect(body.usage).toBeNull();
    expect(body.quotaRemaining).toBe(20);
    expect(body.reply).toContain('PIG-000123');
    expect(body.reply).toContain('Maternidad');
    expect(body.reply).toContain('C-01');

    expect(doubles.findByCode).toHaveBeenCalledWith(CODE, 'jwt-operator');
    expect(doubles.findLocation).toHaveBeenCalledWith(ANIMAL_ID, 'jwt-operator');
    expect(complete).not.toHaveBeenCalled();
  });

  it('codigo inexistente -> mensaje claro y sin consultar ubicacion', async () => {
    const doubles = createReadDoubles({ animal: null });
    const { app } = buildChatApp(doubles);

    const response = await callChat(
      app,
      'jwt-operator',
      '¿Dónde está el porcino PIG-999999?',
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().reply).toContain('No se encontró');
    expect(doubles.findLocation).not.toHaveBeenCalled();
  });
});

describe('POST /assistant/chat: movimientos recientes', () => {
  it('lista los movimientos recientes con motivo y fecha', async () => {
    const doubles = createReadDoubles();
    const { provider, complete } = spyProvider(async () => COMPLETION);
    const quota = createInMemoryAssistantQuota({ limit: 20 });
    const { app } = buildChatApp(doubles, { provider, quota });

    const response = await callChat(
      app,
      'jwt-vet',
      'movimientos recientes del porcino PIG-000123',
    );

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.source).toBe('data');
    expect(body.reply).toContain('destete');
    expect(body.reply).toContain('2026-01-05');
    expect(body.quotaRemaining).toBe(20);

    // La consulta se limita: nunca se piden listados masivos.
    expect(doubles.listMovements).toHaveBeenCalledTimes(1);
    const filter = doubles.listMovements.mock.calls[0][0] as ListMovementsFilter;
    expect(filter.animal_id).toBe(ANIMAL_ID);
    expect(filter.limit).toBe(MAX_MOVEMENTS);
    expect(complete).not.toHaveBeenCalled();
  });

  it('porcino sin movimientos -> mensaje claro', async () => {
    const doubles = createReadDoubles({ movements: [] });
    const { app } = buildChatApp(doubles);

    const response = await callChat(
      app,
      'jwt-operator',
      'movimientos de PIG-000123',
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().reply).toContain('no tiene movimientos');
  });
});

describe('POST /assistant/chat: seguridad y validacion', () => {
  it('sin token -> 401 y no consulta datos', async () => {
    const doubles = createReadDoubles();
    const { app } = buildChatApp(doubles);

    const response = await callChat(app, undefined, '¿Cuántos porcinos hay?');
    expect(response.statusCode).toBe(401);
    expect(doubles.countByStatus).not.toHaveBeenCalled();
  });

  it('viewer e inactivo -> 403 y no consultan datos', async () => {
    const doubles = createReadDoubles();
    const { app } = buildChatApp(doubles);

    for (const token of ['jwt-viewer', 'jwt-inactive']) {
      const response = await callChat(app, token, '¿Cuántos porcinos hay?');
      expect(response.statusCode).toBe(403);
    }

    expect(doubles.countByStatus).not.toHaveBeenCalled();
  });

  it('codigo con formato invalido -> 400 y no consulta', async () => {
    const doubles = createReadDoubles();
    const { provider, complete } = spyProvider(async () => COMPLETION);
    const quota = createInMemoryAssistantQuota({ limit: 5 });
    const { app } = buildChatApp(doubles, { provider, quota });

    const response = await callChat(
      app,
      'jwt-operator',
      '¿Dónde está el porcino PIG-12?',
    );

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_params' });
    expect(doubles.findByCode).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(quota.remaining()).toBe(5);
  });

  it('las consultas de datos funcionan aunque la cuota este agotada', async () => {
    const doubles = createReadDoubles();
    const { provider, complete } = spyProvider(async () => COMPLETION);
    const quota = createInMemoryAssistantQuota({ limit: 1 });
    const { app } = buildChatApp(doubles, { provider, quota });

    // Agota la cuota con una pregunta que va al proveedor.
    expect(
      (await callChat(app, 'jwt-operator', '¿Cómo registro un area?')).statusCode,
    ).toBe(200);
    expect(quota.remaining()).toBe(0);

    // La consulta de datos no necesita cuota.
    const dataResponse = await callChat(app, 'jwt-operator', '¿Cuántos porcinos hay?');
    expect(dataResponse.statusCode).toBe(200);
    expect(dataResponse.json()).toMatchObject({
      source: 'data',
      usage: null,
      quotaRemaining: 0,
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('no realiza escrituras en ninguna consulta', async () => {
    const doubles = createReadDoubles();
    const { app } = buildChatApp(doubles);

    await callChat(app, 'jwt-admin', '¿Cuántos porcinos hay?');
    await callChat(app, 'jwt-admin', '¿Dónde está el porcino PIG-000123?');
    await callChat(app, 'jwt-admin', 'movimientos de PIG-000123');

    for (const write of doubles.writes) {
      expect(write).not.toHaveBeenCalled();
    }
  });
});

describe('POST /assistant/chat: fallos controlados de datos', () => {
  it('un fallo de Supabase -> 503 sin detalles internos y sin inventar', async () => {
    const doubles = createReadDoubles();
    doubles.countByStatus.mockRejectedValue(
      new DataAccessError(),
    );
    const { provider, complete } = spyProvider(async () => COMPLETION);
    const { app } = buildChatApp(doubles, { provider });

    const response = await callChat(app, 'jwt-operator', '¿Cuántos porcinos hay?');

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'service_unavailable' });
    expect(response.body).not.toContain('DataAccessError');
    expect(complete).not.toHaveBeenCalled();
  });

  it('un error inesperado de la base -> 503 sin filtrar el mensaje', async () => {
    const doubles = createReadDoubles();
    doubles.findByCode.mockRejectedValue(
      new Error('connection string secret=abc'),
    );
    const { app } = buildChatApp(doubles);

    const response = await callChat(
      app,
      'jwt-operator',
      '¿Dónde está el porcino PIG-000123?',
    );

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'service_unavailable' });
    expect(response.body).not.toContain('secret');
  });
});
