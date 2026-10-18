import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../lib/http';
import {
  CLINICAL_EVENT_TYPES,
  HEALTH_EVENT_TYPES,
  HEALTH_EVENT_TYPE_LABELS,
  MORTALITY_EVENT_TYPE,
  OBSERVATION_EVENT_TYPES,
  admitsHealthEvents,
  allowedHealthEventRoles,
  canRegisterHealthEvent,
  createHealthEvent,
  getHealthEvent,
  healthEventTypeOptionsFor,
  isHealthEvent,
  isHealthEventType,
  listAnimalHealthEvents,
  listHealthEvents,
  type HealthEvent,
} from './health-events.service';

const ANIMAL_ID = '22222222-2222-2222-2222-222222222222';
const EVENT_ID = '33333333-3333-3333-3333-333333333333';

const EVENT: HealthEvent = {
  id: EVENT_ID,
  animal_id: ANIMAL_ID,
  event_type: 'observation',
  occurred_at: '2026-03-01T10:00:00.000Z',
  title: 'Sin apetito',
  description: 'El porcino comió menos de lo habitual',
  documented_by: 'Dr. Pérez',
  details: {},
  attachment_url: null,
  recorded_by: 'perfil-prueba',
  created_at: '2026-03-01T10:00:00.000Z',
  updated_at: '2026-03-01T10:00:00.000Z',
};

interface ClientStubs {
  get?: (path: string) => Promise<unknown>;
  post?: (path: string, body: unknown) => Promise<unknown>;
}

function makeClient(stubs: ClientStubs = {}) {
  const get = vi.fn(stubs.get ?? (async () => [EVENT]));
  const post = vi.fn(stubs.post ?? (async () => EVENT));
  const client = {
    get,
    post,
    patch: vi.fn(async () => EVENT),
    delete: vi.fn(async () => EVENT),
  } as unknown as ApiClient;
  return { client, get, post };
}

function queryOf(path: string): URLSearchParams {
  const index = path.indexOf('?');
  return new URLSearchParams(index === -1 ? '' : path.slice(index + 1));
}

describe('health-events.service: validacion del contrato', () => {
  it('reconoce unicamente los tipos reales del enum', () => {
    expect(HEALTH_EVENT_TYPES).toHaveLength(9);
    expect(isHealthEventType('mortality')).toBe(true);
    expect(isHealthEventType('muerte')).toBe(false);
    expect(Object.keys(HEALTH_EVENT_TYPE_LABELS)).toHaveLength(9);
  });

  it('acepta un evento valido (nulos permitidos) y `details` objeto', () => {
    expect(isHealthEvent(EVENT)).toBe(true);
    expect(
      isHealthEvent({ ...EVENT, description: null, documented_by: null, attachment_url: null }),
    ).toBe(true);
    expect(isHealthEvent({ ...EVENT, details: { temperatura: 39.2 } })).toBe(true);
  });

  it('rechaza eventos con tipo invalido, `details` no objeto o campos faltantes', () => {
    expect(isHealthEvent(null)).toBe(false);
    expect(isHealthEvent({ ...EVENT, event_type: 'inventado' })).toBe(false);
    expect(isHealthEvent({ ...EVENT, details: [] })).toBe(false);
    expect(isHealthEvent({ ...EVENT, title: undefined })).toBe(false);
    expect(isHealthEvent({ ...EVENT, occurred_at: 5 })).toBe(false);
  });
});

describe('health-events.service: matriz de permisos por tipo (5.1)', () => {
  it('clasifica los tipos en observacion, clinicos y mortalidad', () => {
    expect(OBSERVATION_EVENT_TYPES).toEqual([
      'observation',
      'symptom_report',
      'other',
    ]);
    expect(CLINICAL_EVENT_TYPES).toContain('documented_diagnosis');
    expect(MORTALITY_EVENT_TYPE).toBe('mortality');
  });

  it('las observaciones/sintomas las registra cualquier rol operativo', () => {
    for (const type of OBSERVATION_EVENT_TYPES) {
      expect(allowedHealthEventRoles(type)).toEqual([
        'admin',
        'manager',
        'operator',
        'veterinarian',
      ]);
    }
  });

  it('los eventos clinicos los registra solo el veterinario', () => {
    for (const type of CLINICAL_EVENT_TYPES) {
      expect(allowedHealthEventRoles(type)).toEqual(['veterinarian']);
      expect(canRegisterHealthEvent('operator', type)).toBe(false);
      expect(canRegisterHealthEvent('admin', type)).toBe(false);
      expect(canRegisterHealthEvent('manager', type)).toBe(false);
      expect(canRegisterHealthEvent('veterinarian', type)).toBe(true);
    }
  });

  it('la mortalidad la registran admin, manager y veterinario', () => {
    expect(allowedHealthEventRoles('mortality')).toEqual([
      'admin',
      'manager',
      'veterinarian',
    ]);
    expect(canRegisterHealthEvent('operator', 'mortality')).toBe(false);
    expect(canRegisterHealthEvent('admin', 'mortality')).toBe(true);
  });

  it('ofrece a cada rol sus tipos registrables', () => {
    expect(healthEventTypeOptionsFor('operator')).toEqual([
      'observation',
      'symptom_report',
      'other',
    ]);
    expect(healthEventTypeOptionsFor('veterinarian')).toEqual([...HEALTH_EVENT_TYPES]);
    expect(healthEventTypeOptionsFor('manager')).toEqual([
      'observation',
      'symptom_report',
      'mortality',
      'other',
    ]);
  });

  it('admite eventos solo en estados active/missing', () => {
    expect(admitsHealthEvents('active')).toBe(true);
    expect(admitsHealthEvents('missing')).toBe(true);
    expect(admitsHealthEvents('dead')).toBe(false);
    expect(admitsHealthEvents('sold')).toBe(false);
    expect(admitsHealthEvents('transferred_out')).toBe(false);
    expect(admitsHealthEvents('inactive')).toBe(false);
  });
});

describe('health-events.service: consultas y escrituras', () => {
  it('lista eventos sin filtros (GET /health-events)', async () => {
    const { client, get } = makeClient();
    const result = await listHealthEvents(client);

    expect(get).toHaveBeenCalledWith('/health-events', undefined);
    expect(result).toEqual([EVENT]);
  });

  it('envia los filtros reales del backend', async () => {
    const { client, get } = makeClient();
    await listHealthEvents(client, {
      animal_id: ANIMAL_ID,
      event_type: 'treatment',
      occurred_from: '2026-01-01T00:00:00.000Z',
      occurred_to: '2026-01-31T23:59:59.999Z',
      limit: 20,
      offset: 40,
    });

    const path = get.mock.calls[0][0] as string;
    expect(path.startsWith('/health-events?')).toBe(true);
    const query = queryOf(path);
    expect(query.get('animal_id')).toBe(ANIMAL_ID);
    expect(query.get('event_type')).toBe('treatment');
    expect(query.get('occurred_from')).toBe('2026-01-01T00:00:00.000Z');
    expect(query.get('occurred_to')).toBe('2026-01-31T23:59:59.999Z');
    expect(query.get('limit')).toBe('20');
    expect(query.get('offset')).toBe('40');
    expect(query.get('recorded_by')).toBeNull();
  });

  it('obtiene un evento por id (GET /health-events/:id)', async () => {
    const { client, get } = makeClient({ get: async () => EVENT });
    const result = await getHealthEvent(client, EVENT_ID);

    expect(get).toHaveBeenCalledWith(`/health-events/${EVENT_ID}`, undefined);
    expect(result).toEqual(EVENT);
  });

  it('consulta el historial de un porcino con solo los filtros permitidos', async () => {
    const { client, get } = makeClient();
    await listAnimalHealthEvents(client, ANIMAL_ID, {
      event_type: 'vaccination',
      limit: 100,
    });

    const path = get.mock.calls[0][0] as string;
    expect(path.startsWith(`/animals/${ANIMAL_ID}/health-events?`)).toBe(true);
    const query = queryOf(path);
    expect(query.get('event_type')).toBe('vaccination');
    expect(query.get('limit')).toBe('100');
    expect(query.get('animal_id')).toBeNull();
  });

  it('registra un evento sin enviar recorded_by', async () => {
    const { client, post } = makeClient();
    await createHealthEvent(client, {
      animal_id: ANIMAL_ID,
      event_type: 'observation',
      title: 'Sin apetito',
      occurred_at: '2026-03-01T10:00:00.000Z',
      description: 'Comió menos',
    });

    expect(post).toHaveBeenCalledWith('/health-events', {
      animal_id: ANIMAL_ID,
      event_type: 'observation',
      title: 'Sin apetito',
      occurred_at: '2026-03-01T10:00:00.000Z',
      description: 'Comió menos',
    });
    const body = post.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('recorded_by');
  });

  it('propaga el ApiError del backend (fail-closed)', async () => {
    const { client } = makeClient({
      post: async () => {
        throw new ApiError(403, 'forbidden', 'operacion no autorizada');
      },
    });
    await expect(
      createHealthEvent(client, {
        animal_id: ANIMAL_ID,
        event_type: 'treatment',
        title: 'Tratamiento',
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('rechaza una respuesta con forma inesperada', async () => {
    const { client } = makeClient({ get: async () => [{ id: 'x' }] });
    await expect(listHealthEvents(client)).rejects.toThrow(
      'Respuesta no valida del servidor.',
    );
  });
});
