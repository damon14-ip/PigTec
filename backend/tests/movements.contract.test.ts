import { describe, expect, it } from 'vitest';
import type { PostgrestClientFactory } from '../src/modules/common/postgrest.js';
import { createSupabaseMovementRepository } from '../src/modules/movements/movements.repository.js';

/**
 * Contrato de escritura del backend hacia `public.animal_movements`.
 *
 * La migracion 005 exige, por RLS y por triggers, un conjunto EXACTO de campos:
 * `recorded_by = auth.uid()`, `from_pen_id` coherente con la ubicacion actual,
 * `reason` valido y `to_pen_id` segun el motivo. Estos tests comprueban, sin red
 * ni base de datos, que el repositorio envia EXACTAMENTE esos campos y valores
 * (ni de mas ni de menos) al INSERT de PostgREST.
 */

const ANIMAL_ID = '33333333-3333-3333-3333-333333333333';
const FROM_PEN_ID = '22222222-2222-2222-2222-222222222222';
const TO_PEN_ID = '44444444-4444-4444-4444-444444444444';
const MOVEMENT_ID = '55555555-5555-5555-5555-555555555555';

const ROW = {
  id: MOVEMENT_ID,
  animal_id: ANIMAL_ID,
  from_pen_id: FROM_PEN_ID,
  to_pen_id: TO_PEN_ID,
  moved_at: '2026-01-02T10:00:00.000Z',
  reason: 'management',
  notes: null,
  recorded_by: 'u-operator',
  created_at: '2026-01-02T10:00:00.000Z',
};

interface Capture {
  table: string | null;
  values: Record<string, unknown> | null;
}

/** Factory de PostgREST que captura la tabla y el objeto `insert`. */
function createCaptureFactory(capture: Capture): PostgrestClientFactory {
  const query: Record<string, unknown> = {};
  query.insert = (values: Record<string, unknown>) => {
    capture.values = values;
    return query;
  };
  query.select = () => query;
  query.single = async () => ({ data: ROW, error: null });

  const factory = (_accessToken: string) => ({
    from: (table: string) => {
      capture.table = table;
      return query;
    },
  });

  return factory as unknown as PostgrestClientFactory;
}

function newCapture(): Capture {
  return { table: null, values: null };
}

describe('movements: contrato de escritura hacia la base', () => {
  it('inserta en animal_movements con los campos exactos del movimiento interno', async () => {
    const capture = newCapture();
    const repository = createSupabaseMovementRepository(
      createCaptureFactory(capture),
    );

    await repository.create(
      {
        animal_id: ANIMAL_ID,
        from_pen_id: FROM_PEN_ID,
        to_pen_id: TO_PEN_ID,
        reason: 'management',
        moved_at: '2026-01-02T10:00:00.000Z',
        notes: 'cambio de corral',
      },
      'u-operator',
      'jwt-operator',
    );

    expect(capture.table).toBe('animal_movements');
    expect(capture.values).toEqual({
      animal_id: ANIMAL_ID,
      from_pen_id: FROM_PEN_ID,
      to_pen_id: TO_PEN_ID,
      reason: 'management',
      moved_at: '2026-01-02T10:00:00.000Z',
      notes: 'cambio de corral',
      recorded_by: 'u-operator',
    });
  });

  it('omite moved_at y notes cuando no se indican (los deriva la base)', async () => {
    const capture = newCapture();
    const repository = createSupabaseMovementRepository(
      createCaptureFactory(capture),
    );

    await repository.create(
      {
        animal_id: ANIMAL_ID,
        from_pen_id: FROM_PEN_ID,
        to_pen_id: TO_PEN_ID,
        reason: 'management',
      },
      'u-operator',
      'jwt-operator',
    );

    const values = capture.values ?? {};
    // Ni claves de mas (id/created_at son de la base) ni de menos.
    expect(Object.keys(values).sort()).toEqual([
      'animal_id',
      'from_pen_id',
      'reason',
      'recorded_by',
      'to_pen_id',
    ]);
    expect('moved_at' in values).toBe(false);
    expect('notes' in values).toBe(false);
  });

  it('una salida (sale) envia origen y destino nulos', async () => {
    const capture = newCapture();
    const repository = createSupabaseMovementRepository(
      createCaptureFactory(capture),
    );

    await repository.create(
      {
        animal_id: ANIMAL_ID,
        from_pen_id: FROM_PEN_ID,
        to_pen_id: null,
        reason: 'sale',
      },
      'u-manager',
      'jwt-manager',
    );

    expect(capture.values).toMatchObject({
      from_pen_id: FROM_PEN_ID,
      to_pen_id: null,
      reason: 'sale',
      recorded_by: 'u-manager',
    });
  });

  it('el autor del historial es siempre el usuario autenticado', async () => {
    const capture = newCapture();
    const repository = createSupabaseMovementRepository(
      createCaptureFactory(capture),
    );

    await repository.create(
      {
        animal_id: ANIMAL_ID,
        from_pen_id: FROM_PEN_ID,
        to_pen_id: TO_PEN_ID,
        reason: 'health_isolation',
      },
      'u-vet',
      'jwt-vet',
    );

    expect(capture.values?.recorded_by).toBe('u-vet');
  });
});
