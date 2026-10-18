import { describe, expect, it } from 'vitest';
import type { PostgrestClientFactory } from '../src/modules/common/postgrest.js';
import { createSupabaseHealthEventRepository } from '../src/modules/health/health-events.repository.js';

/**
 * Contrato de escritura del backend hacia `public.health_events`.
 *
 * La migracion 007 exige, por RLS, un conjunto EXACTO de campos: el autor
 * (`recorded_by = auth.uid()`), `event_type` dentro del enum y coherente con el
 * rol, y `details` como objeto JSON. Estos tests comprueban, sin red ni base de
 * datos, que el repositorio envia EXACTAMENTE esos campos y valores (ni de mas
 * ni de menos) al INSERT de PostgREST.
 */

const ANIMAL_ID = '33333333-3333-3333-3333-333333333333';
const EVENT_ID = '77777777-7777-7777-7777-777777777777';

const ROW = {
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

describe('health-events: contrato de escritura hacia la base', () => {
  it('inserta en health_events con los campos exactos del evento', async () => {
    const capture = newCapture();
    const repository = createSupabaseHealthEventRepository(
      createCaptureFactory(capture),
    );

    await repository.create(
      {
        animal_id: ANIMAL_ID,
        event_type: 'treatment',
        title: 'Tratamiento antibiotico',
        occurred_at: '2026-02-01T09:00:00.000Z',
        description: 'Cuatro dias',
        documented_by: 'MV externo',
        details: { dosis: '1ml', via: 'IM' },
        attachment_url: 'https://ejemplo.test/receta.pdf',
      },
      'u-vet',
      'jwt-vet',
    );

    expect(capture.table).toBe('health_events');
    expect(capture.values).toEqual({
      animal_id: ANIMAL_ID,
      event_type: 'treatment',
      title: 'Tratamiento antibiotico',
      occurred_at: '2026-02-01T09:00:00.000Z',
      description: 'Cuatro dias',
      documented_by: 'MV externo',
      details: { dosis: '1ml', via: 'IM' },
      attachment_url: 'https://ejemplo.test/receta.pdf',
      recorded_by: 'u-vet',
    });
  });

  it('omite los campos opcionales no indicados (los deriva la base)', async () => {
    const capture = newCapture();
    const repository = createSupabaseHealthEventRepository(
      createCaptureFactory(capture),
    );

    await repository.create(
      {
        animal_id: ANIMAL_ID,
        event_type: 'observation',
        title: 'Observacion general',
      },
      'u-operator',
      'jwt-operator',
    );

    const values = capture.values ?? {};
    // Ni claves de mas (id/created_at/updated_at son de la base) ni de menos.
    expect(Object.keys(values).sort()).toEqual([
      'animal_id',
      'event_type',
      'recorded_by',
      'title',
    ]);
    expect('occurred_at' in values).toBe(false);
    expect('description' in values).toBe(false);
    expect('documented_by' in values).toBe(false);
    expect('details' in values).toBe(false);
    expect('attachment_url' in values).toBe(false);
  });

  it('una mortalidad envia event_type mortality y ningun campo de animals', async () => {
    const capture = newCapture();
    const repository = createSupabaseHealthEventRepository(
      createCaptureFactory(capture),
    );

    await repository.create(
      {
        animal_id: ANIMAL_ID,
        event_type: 'mortality',
        title: 'Muerte por enfermedad',
      },
      'u-vet',
      'jwt-vet',
    );

    const values = capture.values ?? {};
    expect(values).toMatchObject({
      animal_id: ANIMAL_ID,
      event_type: 'mortality',
      recorded_by: 'u-vet',
    });
    // El estado del porcino lo deriva el trigger de la base, no el backend.
    expect('status' in values).toBe(false);
    expect('current_pen_id' in values).toBe(false);
    expect('exit_date' in values).toBe(false);
  });

  it('envia details como objeto JSON (contrato del CHECK de la base)', async () => {
    const capture = newCapture();
    const repository = createSupabaseHealthEventRepository(
      createCaptureFactory(capture),
    );

    await repository.create(
      {
        animal_id: ANIMAL_ID,
        event_type: 'symptom_report',
        title: 'Sintomas',
        details: { temperatura_c: 40.5, apetito: false },
      },
      'u-operator',
      'jwt-operator',
    );

    expect(capture.values?.details).toEqual({
      temperatura_c: 40.5,
      apetito: false,
    });
    expect(Array.isArray(capture.values?.details)).toBe(false);
  });

  it('el autor del historial es siempre el usuario autenticado', async () => {
    const capture = newCapture();
    const repository = createSupabaseHealthEventRepository(
      createCaptureFactory(capture),
    );

    await repository.create(
      {
        animal_id: ANIMAL_ID,
        event_type: 'vaccination',
        title: 'Vacunacion',
      },
      'u-vet',
      'jwt-vet',
    );

    expect(capture.values?.recorded_by).toBe('u-vet');
  });
});
