import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../lib/http';
import {
  LITTER_WRITE_ROLES,
  canWriteLitters,
  createLitter,
  getLitter,
  isLitter,
  isLitterOffspring,
  listLitterOffspring,
  listLitters,
  updateLitter,
  type Litter,
  type LitterOffspring,
} from './litters.service';

const MOTHER_ID = '22222222-2222-2222-2222-222222222222';
const FATHER_ID = '33333333-3333-3333-3333-333333333333';
const LITTER_ID = '44444444-4444-4444-4444-444444444444';
const OFFSPRING_ID = '55555555-5555-5555-5555-555555555555';

const LITTER: Litter = {
  id: LITTER_ID,
  litter_code: 'CAM-001',
  mother_id: MOTHER_ID,
  father_id: FATHER_ID,
  birth_date: '2026-03-01',
  total_born: 10,
  born_alive: 9,
  stillborn: 1,
  notes: 'Parto normal',
  created_at: '2026-03-01T10:00:00.000Z',
  updated_at: '2026-03-01T10:00:00.000Z',
};

const OFFSPRING: LitterOffspring = {
  id: OFFSPRING_ID,
  animal_code: 'PIG-000123',
  ear_tag_code: 'AR-123',
  sex: 'female',
  birth_date: '2026-03-01',
  status: 'active',
  mother_id: MOTHER_ID,
  father_id: FATHER_ID,
};

interface ClientStubs {
  get?: (path: string) => Promise<unknown>;
  post?: (path: string, body: unknown) => Promise<unknown>;
  patch?: (path: string, body: unknown) => Promise<unknown>;
}

function makeClient(stubs: ClientStubs = {}) {
  const get = vi.fn(stubs.get ?? (async () => [LITTER]));
  const post = vi.fn(stubs.post ?? (async () => LITTER));
  const patch = vi.fn(stubs.patch ?? (async () => LITTER));
  const client = {
    get,
    post,
    patch,
    delete: vi.fn(async () => LITTER),
  } as unknown as ApiClient;
  return { client, get, post, patch };
}

/** Lee el `query string` de una ruta simulada. */
function queryOf(path: string): URLSearchParams {
  const index = path.indexOf('?');
  return new URLSearchParams(index === -1 ? '' : path.slice(index + 1));
}

describe('litters.service: validacion del contrato', () => {
  it('acepta una camada valida con campos nulos permitidos', () => {
    expect(isLitter(LITTER)).toBe(true);
    expect(
      isLitter({
        ...LITTER,
        litter_code: null,
        mother_id: null,
        father_id: null,
        birth_date: null,
        total_born: null,
        born_alive: null,
        stillborn: null,
        notes: null,
      }),
    ).toBe(true);
  });

  it('rechaza filas incompletas o con tipos invalidos', () => {
    expect(isLitter(null)).toBe(false);
    expect(isLitter({ ...LITTER, id: undefined })).toBe(false);
    expect(isLitter({ ...LITTER, total_born: 'muchos' })).toBe(false);
    expect(isLitter({ ...LITTER, created_at: 5 })).toBe(false);
  });

  it('acepta la forma de una cria y rechaza valores invalidos', () => {
    expect(isLitterOffspring(OFFSPRING)).toBe(true);
    expect(isLitterOffspring({ ...OFFSPRING, sex: 'otro' })).toBe(false);
    expect(isLitterOffspring({ ...OFFSPRING, status: 'desconocido' })).toBe(false);
    expect(isLitterOffspring({ ...OFFSPRING, ear_tag_code: 7 })).toBe(false);
  });
});

describe('litters.service: permisos replicados del backend', () => {
  it('solo admin, manager y operator escriben camadas', () => {
    expect(LITTER_WRITE_ROLES).toEqual(['admin', 'manager', 'operator']);
    expect(canWriteLitters('admin')).toBe(true);
    expect(canWriteLitters('manager')).toBe(true);
    expect(canWriteLitters('operator')).toBe(true);
    expect(canWriteLitters('veterinarian')).toBe(false);
  });
});

describe('litters.service: consultas y escrituras', () => {
  it('lista camadas sin filtros (GET /litters)', async () => {
    const { client, get } = makeClient();
    const result = await listLitters(client);

    expect(get).toHaveBeenCalledWith('/litters', undefined);
    expect(result).toEqual([LITTER]);
  });

  it('envia los filtros reales del backend (mother/birth_from/birth_to/limit/offset)', async () => {
    const { client, get } = makeClient();
    await listLitters(client, {
      mother_id: MOTHER_ID,
      father_id: FATHER_ID,
      birth_from: '2026-01-01',
      birth_to: '2026-01-31',
      limit: 20,
      offset: 40,
    });

    const path = get.mock.calls[0][0] as string;
    expect(path.startsWith('/litters?')).toBe(true);
    const query = queryOf(path);
    expect(query.get('mother_id')).toBe(MOTHER_ID);
    expect(query.get('father_id')).toBe(FATHER_ID);
    expect(query.get('birth_from')).toBe('2026-01-01');
    expect(query.get('birth_to')).toBe('2026-01-31');
    expect(query.get('limit')).toBe('20');
    expect(query.get('offset')).toBe('40');
  });

  it('obtiene una camada por id (GET /litters/:id)', async () => {
    const { client, get } = makeClient({ get: async () => LITTER });
    const result = await getLitter(client, LITTER_ID);

    expect(get).toHaveBeenCalledWith(`/litters/${LITTER_ID}`, undefined);
    expect(result).toEqual(LITTER);
  });

  it('consulta la descendencia (GET /litters/:id/offspring)', async () => {
    const { client, get } = makeClient({ get: async () => [OFFSPRING] });
    const result = await listLitterOffspring(client, LITTER_ID);

    expect(get).toHaveBeenCalledWith(
      `/litters/${LITTER_ID}/offspring`,
      undefined,
    );
    expect(result).toEqual([OFFSPRING]);
  });

  it('registra sin campos vacios innecesarios (POST /litters)', async () => {
    const { client, post } = makeClient();
    await createLitter(client, {
      mother_id: MOTHER_ID,
      litter_code: 'CAM-001',
      total_born: 10,
      born_alive: 9,
      stillborn: 1,
    });

    expect(post).toHaveBeenCalledWith('/litters', {
      mother_id: MOTHER_ID,
      litter_code: 'CAM-001',
      total_born: 10,
      born_alive: 9,
      stillborn: 1,
    });
  });

  it('edita los campos permitidos (PATCH /litters/:id)', async () => {
    const { client, patch } = makeClient();
    await updateLitter(client, LITTER_ID, {
      notes: 'Corregido',
      stillborn: 2,
    });

    expect(patch).toHaveBeenCalledWith(`/litters/${LITTER_ID}`, {
      notes: 'Corregido',
      stillborn: 2,
    });
  });

  it('propaga el ApiError del backend (fail-closed)', async () => {
    const { client } = makeClient({
      post: async () => {
        throw new ApiError(422, 'invalid_reference', 'referencia inexistente');
      },
    });
    await expect(
      createLitter(client, { mother_id: MOTHER_ID }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('rechaza una respuesta con forma inesperada', async () => {
    const { client } = makeClient({ get: async () => [{ id: 'x' }] });
    await expect(listLitters(client)).rejects.toThrow(
      'Respuesta no valida del servidor.',
    );
  });
});
