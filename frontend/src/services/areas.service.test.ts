import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../lib/http';
import {
  createArea,
  deactivateArea,
  isArea,
  listAreas,
  updateArea,
  type Area,
} from './areas.service';

const AREA: Area = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Nave 1',
  description: 'Galpón norte',
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
    post: vi.fn(stubs.post ?? (async () => AREA)),
    patch: vi.fn(stubs.patch ?? (async () => AREA)),
    delete: vi.fn(stubs.delete ?? (async () => AREA)),
  } as unknown as ApiClient;
}

describe('areas.service: validacion del contrato', () => {
  it('acepta un area valida', () => {
    expect(isArea(AREA)).toBe(true);
  });

  it('rechaza filas incompletas o con estado invalido', () => {
    expect(isArea(null)).toBe(false);
    expect(isArea({ ...AREA, status: 'archivada' })).toBe(false);
    expect(isArea({ ...AREA, name: 3 })).toBe(false);
    expect(isArea({ ...AREA, description: 7 })).toBe(false);
  });
});

describe('areas.service: consultas y escrituras', () => {
  it('lista areas sin filtro (GET /areas)', async () => {
    const client = makeClient({ get: async () => [AREA] });
    const result = await listAreas(client);

    expect(client.get).toHaveBeenCalledWith('/areas', undefined);
    expect(result).toEqual([AREA]);
  });

  it('lista areas con filtro de estado (GET /areas?status=active)', async () => {
    const client = makeClient({ get: async () => [AREA] });
    await listAreas(client, { status: 'active' });

    expect(client.get).toHaveBeenCalledWith('/areas?status=active', undefined);
  });

  it('rechaza una lista con filas no validas', async () => {
    const client = makeClient({ get: async () => [{ name: 'sin id' }] });
    await expect(listAreas(client)).rejects.toThrow(
      'Respuesta no valida del servidor.',
    );
  });

  it('crea un area (POST /areas) y valida la respuesta', async () => {
    const client = makeClient({ post: async () => AREA });
    const result = await createArea(client, { name: 'Nave 1', description: null });

    expect(client.post).toHaveBeenCalledWith('/areas', {
      name: 'Nave 1',
      description: null,
    });
    expect(result).toEqual(AREA);
  });

  it('edita un area (PATCH /areas/:id)', async () => {
    const client = makeClient({ patch: async () => ({ ...AREA, name: 'Nave 2' }) });
    const result = await updateArea(client, AREA.id, { name: 'Nave 2' });

    expect(client.patch).toHaveBeenCalledWith(`/areas/${AREA.id}`, {
      name: 'Nave 2',
    });
    expect(result.name).toBe('Nave 2');
  });

  it('da de baja logica (DELETE /areas/:id)', async () => {
    const client = makeClient({
      delete: async () => ({ ...AREA, status: 'inactive' }),
    });
    const result = await deactivateArea(client, AREA.id);

    expect(client.delete).toHaveBeenCalledWith(`/areas/${AREA.id}`);
    expect(result.status).toBe('inactive');
  });

  it('propaga el ApiError del backend (fail-closed)', async () => {
    const client = makeClient({
      post: async () => {
        throw new ApiError(409, 'conflict', 'duplicado');
      },
    });
    await expect(createArea(client, { name: 'Nave 1' })).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});
