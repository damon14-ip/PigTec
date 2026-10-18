import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../lib/http';
import {
  MOVEMENT_REASONS,
  admitsMovements,
  allowedMovementRoles,
  allowsNullDestination,
  canRegisterExternalExit,
  createMovement,
  getMovement,
  isMovement,
  isMovementReason,
  listAnimalMovements,
  listMovements,
  movementReasonOptionsFor,
  type Movement,
} from './movements.service';

const ANIMAL_ID = '33333333-3333-3333-3333-333333333333';
const FROM_PEN_ID = '22222222-2222-2222-2222-222222222222';
const TO_PEN_ID = '44444444-4444-4444-4444-444444444444';

const MOVEMENT: Movement = {
  id: '55555555-5555-5555-5555-555555555555',
  animal_id: ANIMAL_ID,
  from_pen_id: FROM_PEN_ID,
  to_pen_id: TO_PEN_ID,
  moved_at: '2026-03-01T10:00:00.000Z',
  reason: 'management',
  notes: 'Cambio de corral',
  recorded_by: 'perfil-prueba',
  created_at: '2026-03-01T10:00:00.000Z',
};

interface ClientStubs {
  get?: (path: string) => Promise<unknown>;
  post?: (path: string, body: unknown) => Promise<unknown>;
}

function makeClient(stubs: ClientStubs) {
  const get = vi.fn(stubs.get ?? (async () => [MOVEMENT]));
  const post = vi.fn(stubs.post ?? (async () => MOVEMENT));
  const client = {
    get,
    post,
    patch: vi.fn(async () => MOVEMENT),
    delete: vi.fn(async () => MOVEMENT),
  } as unknown as ApiClient;
  return { client, get, post };
}

/** Lee el `query string` de una ruta simulada. */
function queryOf(path: string): URLSearchParams {
  const index = path.indexOf('?');
  return new URLSearchParams(index === -1 ? '' : path.slice(index + 1));
}

describe('movements.service: validacion del contrato', () => {
  it('acepta un movimiento valido (nulos permitidos)', () => {
    expect(isMovement(MOVEMENT)).toBe(true);
    expect(
      isMovement({ ...MOVEMENT, from_pen_id: null, to_pen_id: null, notes: null }),
    ).toBe(true);
  });

  it('rechaza filas incompletas o con motivo invalido', () => {
    expect(isMovement(null)).toBe(false);
    expect(isMovement({ ...MOVEMENT, id: undefined })).toBe(false);
    expect(isMovement({ ...MOVEMENT, reason: 'inventado' })).toBe(false);
    expect(isMovement({ ...MOVEMENT, moved_at: 5 })).toBe(false);
  });

  it('reconoce unicamente los motivos reales del enum', () => {
    expect(MOVEMENT_REASONS).toHaveLength(9);
    expect(isMovementReason('sale')).toBe(true);
    expect(isMovementReason('muerte')).toBe(false);
  });
});

describe('movements.service: reglas del backend replicadas', () => {
  it('admite movimientos solo en estados active/missing', () => {
    expect(admitsMovements('active')).toBe(true);
    expect(admitsMovements('missing')).toBe(true);
    expect(admitsMovements('sold')).toBe(false);
    expect(admitsMovements('dead')).toBe(false);
    expect(admitsMovements('transferred_out')).toBe(false);
    expect(admitsMovements('inactive')).toBe(false);
  });

  it('limita los roles por motivo (matriz 5.1)', () => {
    expect(allowedMovementRoles('management', true)).toEqual([
      'admin',
      'manager',
      'operator',
    ]);
    expect(allowedMovementRoles('health_isolation', true)).toContain(
      'veterinarian',
    );
    expect(allowedMovementRoles('sale', false)).toEqual(['admin', 'manager']);
    expect(allowedMovementRoles('transfer', true)).toEqual([
      'admin',
      'manager',
      'operator',
    ]);
    expect(allowedMovementRoles('transfer', false)).toEqual([
      'admin',
      'manager',
    ]);
  });

  it('solo las salidas externas admiten destino nulo', () => {
    expect(allowsNullDestination('sale')).toBe(true);
    expect(allowsNullDestination('transfer')).toBe(true);
    expect(allowsNullDestination('management')).toBe(false);
    expect(allowsNullDestination('health_isolation')).toBe(false);
  });

  it('ofrece a cada rol sus motivos registrables', () => {
    expect(movementReasonOptionsFor('veterinarian')).toEqual([
      'health_isolation',
    ]);
    expect(movementReasonOptionsFor('operator')).not.toContain('sale');
    expect(movementReasonOptionsFor('operator')).toContain('transfer');
    expect(movementReasonOptionsFor('manager')).toEqual([...MOVEMENT_REASONS]);
    expect(canRegisterExternalExit('operator')).toBe(false);
    expect(canRegisterExternalExit('manager')).toBe(true);
  });
});

describe('movements.service: consultas y escrituras', () => {
  it('lista movimientos sin filtros (GET /movements)', async () => {
    const { client, get } = makeClient({});
    const result = await listMovements(client);

    expect(get).toHaveBeenCalledWith('/movements', undefined);
    expect(result).toEqual([MOVEMENT]);
  });

  it('envia los filtros reales del backend', async () => {
    const { client, get } = makeClient({});
    await listMovements(client, {
      animal_id: ANIMAL_ID,
      pen_id: TO_PEN_ID,
      reason: 'health_isolation',
      moved_from: '2026-01-01T00:00:00.000Z',
      moved_to: '2026-01-31T23:59:59.999Z',
      limit: 20,
      offset: 40,
    });

    const path = get.mock.calls[0][0] as string;
    expect(path.startsWith('/movements?')).toBe(true);
    const query = queryOf(path);
    expect(query.get('animal_id')).toBe(ANIMAL_ID);
    expect(query.get('pen_id')).toBe(TO_PEN_ID);
    expect(query.get('reason')).toBe('health_isolation');
    expect(query.get('moved_from')).toBe('2026-01-01T00:00:00.000Z');
    expect(query.get('moved_to')).toBe('2026-01-31T23:59:59.999Z');
    expect(query.get('limit')).toBe('20');
    expect(query.get('offset')).toBe('40');
    // No se envían filtros vacíos ni campos no soportados.
    expect(query.get('from_pen_id')).toBeNull();
    expect(query.get('to_pen_id')).toBeNull();
    expect(query.get('recorded_by')).toBeNull();
  });

  it('obtiene un movimiento por id (GET /movements/:id)', async () => {
    const { client, get } = makeClient({ get: async () => MOVEMENT });
    const result = await getMovement(client, MOVEMENT.id);

    expect(get).toHaveBeenCalledWith(`/movements/${MOVEMENT.id}`, undefined);
    expect(result).toEqual(MOVEMENT);
  });

  it('consulta el historial de un porcino con solo los filtros permitidos', async () => {
    const { client, get } = makeClient({});
    await listAnimalMovements(client, ANIMAL_ID, { reason: 'sale', limit: 100 });

    const path = get.mock.calls[0][0] as string;
    expect(path.startsWith(`/animals/${ANIMAL_ID}/movements?`)).toBe(true);
    const query = queryOf(path);
    expect(query.get('reason')).toBe('sale');
    expect(query.get('limit')).toBe('100');
    expect(query.get('animal_id')).toBeNull();
    expect(query.get('pen_id')).toBeNull();
  });

  it('registra un movimiento sin from_pen_id ni recorded_by', async () => {
    const { client, post } = makeClient({});
    await createMovement(client, {
      animal_id: ANIMAL_ID,
      reason: 'management',
      to_pen_id: TO_PEN_ID,
      moved_at: '2026-03-01T10:00:00.000Z',
      notes: 'Cambio de corral',
    });

    expect(post).toHaveBeenCalledWith('/movements', {
      animal_id: ANIMAL_ID,
      reason: 'management',
      to_pen_id: TO_PEN_ID,
      moved_at: '2026-03-01T10:00:00.000Z',
      notes: 'Cambio de corral',
    });
    const body = post.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('from_pen_id');
    expect(body).not.toHaveProperty('recorded_by');
  });

  it('una salida envia el destino nulo explícito', async () => {
    const { client, post } = makeClient({
      post: async () => ({ ...MOVEMENT, to_pen_id: null, reason: 'sale' }),
    });
    const result = await createMovement(client, {
      animal_id: ANIMAL_ID,
      reason: 'sale',
      to_pen_id: null,
    });

    expect(post).toHaveBeenCalledWith('/movements', {
      animal_id: ANIMAL_ID,
      reason: 'sale',
      to_pen_id: null,
    });
    expect(result.reason).toBe('sale');
  });

  it('propaga el ApiError del backend (fail-closed)', async () => {
    const { client } = makeClient({
      post: async () => {
        throw new ApiError(400, 'invalid_request', 'datos invalidos');
      },
    });
    await expect(
      createMovement(client, {
        animal_id: ANIMAL_ID,
        reason: 'management',
        to_pen_id: TO_PEN_ID,
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('rechaza una respuesta con forma inesperada', async () => {
    const { client } = makeClient({ get: async () => [{ id: 'x' }] });
    await expect(listMovements(client)).rejects.toThrow(
      'Respuesta no valida del servidor.',
    );
  });
});
