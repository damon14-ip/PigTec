import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../lib/http';
import {
  createPen,
  deactivatePen,
  isPen,
  listPens,
  updatePen,
  type Pen,
} from './pens.service';

const AREA_ID = '11111111-1111-1111-1111-111111111111';

const PEN: Pen = {
  id: '22222222-2222-2222-2222-222222222222',
  area_id: AREA_ID,
  code: 'C-01',
  name: 'Corral 1',
  capacity: 20,
  notes: null,
  status: 'active',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

interface ClientStubs {
  get?: (path: string) => Promise<unknown>;
  post?: (path: string, body: unknown) => Promise<unknown>;
  patch?: (path: string, body: unknown) => Promise<unknown>;
  delete?: (path: string) => Promise<unknown>;
}

function makeClient(stubs: ClientStubs): ApiClient {
  return {
    get: vi.fn(stubs.get ?? (async () => [])),
    post: vi.fn(stubs.post ?? (async () => PEN)),
    patch: vi.fn(stubs.patch ?? (async () => PEN)),
    delete: vi.fn(stubs.delete ?? (async () => PEN)),
  } as unknown as ApiClient;
}

describe('pens.service: validacion del contrato', () => {
  it('acepta un corral valido (capacidad registrada o nula)', () => {
    expect(isPen(PEN)).toBe(true);
    expect(isPen({ ...PEN, capacity: null })).toBe(true);
  });

  it('rechaza filas incompletas o con tipos invalidos', () => {
    expect(isPen(null)).toBe(false);
    expect(isPen({ ...PEN, capacity: 1.5 })).toBe(false);
    expect(isPen({ ...PEN, status: 'archivado' })).toBe(false);
    expect(isPen({ ...PEN, area_id: undefined })).toBe(false);
  });
});

describe('pens.service: consultas y escrituras', () => {
  it('lista corrales (GET /pens)', async () => {
    const client = makeClient({ get: async () => [PEN] });
    const result = await listPens(client);

    expect(client.get).toHaveBeenCalledWith('/pens', undefined);
    expect(result).toEqual([PEN]);
  });

  it('lista corrales filtrando por area y estado', async () => {
    const client = makeClient({ get: async () => [PEN] });
    await listPens(client, { area_id: AREA_ID, status: 'active' });

    expect(client.get).toHaveBeenCalledWith(
      `/pens?area_id=${AREA_ID}&status=active`,
      undefined,
    );
  });

  it('crea un corral (POST /pens) con su area', async () => {
    const client = makeClient({ post: async () => PEN });
    const result = await createPen(client, {
      area_id: AREA_ID,
      code: 'C-01',
      name: null,
      capacity: 20,
      notes: null,
    });

    expect(client.post).toHaveBeenCalledWith('/pens', {
      area_id: AREA_ID,
      code: 'C-01',
      name: null,
      capacity: 20,
      notes: null,
    });
    expect(result).toEqual(PEN);
  });

  it('edita un corral (PATCH /pens/:id) sin reasignar area', async () => {
    const client = makeClient({
      patch: async () => ({ ...PEN, capacity: 25 }),
    });
    const result = await updatePen(client, PEN.id, { capacity: 25 });

    expect(client.patch).toHaveBeenCalledWith(`/pens/${PEN.id}`, {
      capacity: 25,
    });
    expect(result.capacity).toBe(25);
  });

  it('da de baja logica (DELETE /pens/:id)', async () => {
    const client = makeClient({
      delete: async () => ({ ...PEN, status: 'inactive' }),
    });
    const result = await deactivatePen(client, PEN.id);

    expect(client.delete).toHaveBeenCalledWith(`/pens/${PEN.id}`);
    expect(result.status).toBe('inactive');
  });

  it('propaga el ApiError del backend (fail-closed)', async () => {
    const client = makeClient({
      post: async () => {
        throw new ApiError(409, 'conflict', 'duplicado');
      },
    });
    await expect(
      createPen(client, { area_id: AREA_ID, code: 'C-01' }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
