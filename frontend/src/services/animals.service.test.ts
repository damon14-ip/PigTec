import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../lib/http';
import {
  createAnimal,
  getAnimal,
  getAnimalLocation,
  isAnimal,
  isAnimalLocation,
  listAnimals,
  updateAnimal,
  updateAnimalStatus,
  type Animal,
  type AnimalLocation,
} from './animals.service';

const ANIMAL_ID = '33333333-3333-3333-3333-333333333333';
const PEN_ID = '22222222-2222-2222-2222-222222222222';

const ANIMAL: Animal = {
  id: ANIMAL_ID,
  animal_code: 'PIG-000001',
  ear_tag_code: 'AR-100',
  sex: 'female',
  breed: 'Landrace',
  birth_date: '2026-01-05',
  origin: 'born_on_farm',
  mother_id: null,
  father_id: null,
  litter_id: null,
  current_pen_id: PEN_ID,
  status: 'active',
  entry_date: '2026-01-10',
  exit_date: null,
  notes: null,
  created_by: 'perfil-prueba',
  created_at: '2026-01-10T00:00:00.000Z',
  updated_at: '2026-01-10T00:00:00.000Z',
};

const LOCATION: AnimalLocation = {
  animal_id: ANIMAL_ID,
  current_pen_id: PEN_ID,
  pen: {
    id: PEN_ID,
    code: 'C-01',
    name: 'Corral 1',
    status: 'active',
    area: { id: 'area-1', name: 'Nave 1', status: 'active' },
  },
};

interface ClientStubs {
  get?: (path: string) => Promise<unknown>;
  post?: (path: string, body: unknown) => Promise<unknown>;
  patch?: (path: string, body: unknown) => Promise<unknown>;
}

function makeClient(stubs: ClientStubs): ApiClient {
  return {
    get: vi.fn(stubs.get ?? (async () => [])),
    post: vi.fn(stubs.post ?? (async () => ANIMAL)),
    patch: vi.fn(stubs.patch ?? (async () => ANIMAL)),
    delete: vi.fn(async () => ANIMAL),
  } as unknown as ApiClient;
}

describe('animals.service: validacion del contrato', () => {
  it('acepta un porcino valido (campos nulos permitidos)', () => {
    expect(isAnimal(ANIMAL)).toBe(true);
    expect(isAnimal({ ...ANIMAL, current_pen_id: null, origin: null })).toBe(
      true,
    );
  });

  it('rechaza filas incompletas o con valores de enum invalidos', () => {
    expect(isAnimal(null)).toBe(false);
    expect(isAnimal({ ...ANIMAL, animal_code: undefined })).toBe(false);
    expect(isAnimal({ ...ANIMAL, status: 'desconocido' })).toBe(false);
    expect(isAnimal({ ...ANIMAL, sex: 'otro' })).toBe(false);
    expect(isAnimal({ ...ANIMAL, origin: 'inventado' })).toBe(false);
  });

  it('acepta una ubicacion valida y rechaza una invalida', () => {
    expect(isAnimalLocation(LOCATION)).toBe(true);
    expect(
      isAnimalLocation({ animal_id: ANIMAL_ID, current_pen_id: null, pen: null }),
    ).toBe(true);
    expect(isAnimalLocation({ ...LOCATION, pen: { id: PEN_ID } })).toBe(false);
  });
});

describe('animals.service: consultas y escrituras', () => {
  it('lista porcinos sin filtros (GET /animals)', async () => {
    const client = makeClient({ get: async () => [ANIMAL] });
    const result = await listAnimals(client);

    expect(client.get).toHaveBeenCalledWith('/animals', undefined);
    expect(result).toEqual([ANIMAL]);
  });

  it('lista porcinos con los filtros soportados por la API', async () => {
    const client = makeClient({ get: async () => [ANIMAL] });
    await listAnimals(client, {
      status: 'active',
      sex: 'female',
      origin: 'born_on_farm',
      current_pen_id: PEN_ID,
      q: 'PIG-000001',
    });

    expect(client.get).toHaveBeenCalledWith(
      `/animals?status=active&sex=female&origin=born_on_farm` +
        `&current_pen_id=${PEN_ID}&q=PIG-000001`,
      undefined,
    );
  });

  it('obtiene un porcino por id (GET /animals/:id)', async () => {
    const client = makeClient({ get: async () => ANIMAL });
    const result = await getAnimal(client, ANIMAL_ID);

    expect(client.get).toHaveBeenCalledWith(`/animals/${ANIMAL_ID}`, undefined);
    expect(result).toEqual(ANIMAL);
  });

  it('obtiene la ubicacion (GET /animals/:id/location)', async () => {
    const client = makeClient({ get: async () => LOCATION });
    const result = await getAnimalLocation(client, ANIMAL_ID);

    expect(client.get).toHaveBeenCalledWith(
      `/animals/${ANIMAL_ID}/location`,
      undefined,
    );
    expect(result).toEqual(LOCATION);
  });

  it('crea un porcino (POST /animals) sin enviar animal_code', async () => {
    const client = makeClient({ post: async () => ANIMAL });
    const result = await createAnimal(client, {
      ear_tag_code: 'AR-100',
      sex: 'female',
      current_pen_id: PEN_ID,
    });

    expect(client.post).toHaveBeenCalledWith('/animals', {
      ear_tag_code: 'AR-100',
      sex: 'female',
      current_pen_id: PEN_ID,
    });
    expect(result).toEqual(ANIMAL);
  });

  it('edita campos permitidos (PATCH /animals/:id) sin current_pen_id', async () => {
    const client = makeClient({
      patch: async () => ({ ...ANIMAL, notes: 'Revisado' }),
    });
    const result = await updateAnimal(client, ANIMAL_ID, { notes: 'Revisado' });

    expect(client.patch).toHaveBeenCalledWith(`/animals/${ANIMAL_ID}`, {
      notes: 'Revisado',
    });
    expect(result.notes).toBe('Revisado');
  });

  it('cambia el estado administrativo (PATCH /animals/:id/status)', async () => {
    const client = makeClient({
      patch: async () => ({ ...ANIMAL, status: 'missing' }),
    });
    const result = await updateAnimalStatus(client, ANIMAL_ID, 'missing');

    expect(client.patch).toHaveBeenCalledWith(`/animals/${ANIMAL_ID}/status`, {
      status: 'missing',
    });
    expect(result.status).toBe('missing');
  });

  it('propaga el ApiError del backend (fail-closed)', async () => {
    const client = makeClient({
      post: async () => {
        throw new ApiError(422, 'invalid_reference', 'referencia invalida');
      },
    });
    await expect(
      createAnimal(client, { current_pen_id: PEN_ID }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
