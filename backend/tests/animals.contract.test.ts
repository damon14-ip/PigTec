import { describe, expect, it } from 'vitest';
import type { PostgrestClientFactory } from '../src/modules/common/postgrest.js';
import { createSupabaseAnimalRepository } from '../src/modules/animals/animals.repository.js';

/**
 * Contrato de escritura del backend hacia `public.animals`.
 *
 * La migracion 008 hace que `animal_code` lo genere la base (secuencia
 * `public.animals_animal_code_seq`, formato `PIG-000001`) y lo declare inmutable;
 * la guardia de la migracion 005 (`trg_animals_derived_guard`) prohibe fijar
 * `status`/`exit_date` derivados. Estos tests comprueban, sin red ni base de
 * datos, que el repositorio envia EXACTAMENTE los campos permitidos (ni de mas
 * ni de menos) en el INSERT y en el UPDATE de PostgREST.
 */

const ANIMAL_ID = '33333333-3333-3333-3333-333333333333';
const PEN_ID = '22222222-2222-2222-2222-222222222222';

const ROW = {
  id: ANIMAL_ID,
  animal_code: 'PIG-000123',
  ear_tag_code: null,
  sex: 'male',
  breed: null,
  birth_date: null,
  origin: null,
  mother_id: null,
  father_id: null,
  litter_id: null,
  current_pen_id: null,
  status: 'active',
  entry_date: '2026-01-01',
  exit_date: null,
  notes: null,
  created_by: 'u-admin',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

interface Capture {
  table: string | null;
  insertValues: Record<string, unknown> | null;
  updateValues: Record<string, unknown> | null;
}

/** Factory de PostgREST que captura la tabla y el objeto del INSERT/UPDATE. */
function createCaptureFactory(capture: Capture): PostgrestClientFactory {
  const query: Record<string, unknown> = {};
  query.insert = (values: Record<string, unknown>) => {
    capture.insertValues = values;
    return query;
  };
  query.update = (values: Record<string, unknown>) => {
    capture.updateValues = values;
    return query;
  };
  query.select = () => query;
  query.eq = () => query;
  query.single = async () => ({ data: ROW, error: null });
  query.maybeSingle = async () => ({ data: ROW, error: null });

  const factory = (_accessToken: string) => ({
    from: (table: string) => {
      capture.table = table;
      return query;
    },
  });

  return factory as unknown as PostgrestClientFactory;
}

function newCapture(): Capture {
  return { table: null, insertValues: null, updateValues: null };
}

describe('animals: contrato de escritura hacia la base', () => {
  it('el alta NO envia animal_code (lo genera la base) y omite lo derivado', async () => {
    const capture = newCapture();
    const repository = createSupabaseAnimalRepository(createCaptureFactory(capture));

    await repository.create({ sex: 'male' }, 'u-admin', 'jwt-admin');

    expect(capture.table).toBe('animals');
    const values = capture.insertValues ?? {};
    // Ni de mas ni de menos: solo los campos que el cliente aporta + created_by.
    expect(Object.keys(values).sort()).toEqual(['created_by', 'sex']);
    expect('animal_code' in values).toBe(false);
    expect('id' in values).toBe(false);
    expect('created_at' in values).toBe(false);
    expect('updated_at' in values).toBe(false);
  });

  it('el alta no envia status ni exit_date (los protege la guardia de 005)', async () => {
    const capture = newCapture();
    const repository = createSupabaseAnimalRepository(createCaptureFactory(capture));

    await repository.create(
      { sex: 'female', current_pen_id: PEN_ID, notes: 'alta normal' },
      'u-manager',
      'jwt-manager',
    );

    const values = capture.insertValues ?? {};
    // El corral inicial SI se admite en el alta (guardia 6.b).
    expect(values.current_pen_id).toBe(PEN_ID);
    expect('status' in values).toBe(false);
    expect('exit_date' in values).toBe(false);
  });

  it('el autor del alta es el usuario autenticado (created_by del JWT)', async () => {
    const capture = newCapture();
    const repository = createSupabaseAnimalRepository(createCaptureFactory(capture));

    await repository.create({}, 'u-manager', 'jwt-manager');

    expect(capture.insertValues?.created_by).toBe('u-manager');
  });

  it('la actualizacion nunca envia animal_code ni campos derivados', async () => {
    const capture = newCapture();
    const repository = createSupabaseAnimalRepository(createCaptureFactory(capture));

    await repository.update(ANIMAL_ID, { breed: 'Duroc', sex: 'male' }, 'jwt-admin');

    const values = capture.updateValues ?? {};
    expect(Object.keys(values).sort()).toEqual(['breed', 'sex']);
    expect('animal_code' in values).toBe(false);
    expect('created_by' in values).toBe(false);
    expect('status' in values).toBe(false);
    expect('current_pen_id' in values).toBe(false);
    expect('exit_date' in values).toBe(false);
  });
});
