import { describe, expect, it } from 'vitest';
import { DataAccessError } from '../src/modules/common/data-errors.js';
import type { PostgrestClientFactory } from '../src/modules/common/postgrest.js';
import { createSupabaseAnimalRepository } from '../src/modules/animals/animals.repository.js';

/**
 * Contrato de LECTURA del repositorio de porcinos usado por el asistente.
 *
 * Comprueba, sin red ni base de datos, que las dos consultas agregadas para las
 * herramientas del asistente son EXACTAMENTE las esperadas:
 * - `findByCode`: igualdad por `animal_code` (nunca por patron: no enumera).
 * - `countByStatus`: conteo exacto y sin filas (`head: true`) filtrado por
 *   `status`, para resumir sin descargar el inventario completo.
 */

const ROW = {
  id: '33333333-3333-3333-3333-333333333333',
  animal_code: 'PIG-000123',
  ear_tag_code: null,
  sex: 'female',
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
  created_by: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

interface Capture {
  table: string | null;
  columns: string | null;
  options: unknown;
  eqs: Array<[string, unknown]>;
}

interface ReadCaptureResult {
  row?: unknown;
  count?: number | null;
  error?: unknown;
}

function createReadCaptureFactory(config: ReadCaptureResult): {
  factory: PostgrestClientFactory;
  capture: Capture;
} {
  const capture: Capture = {
    table: null,
    columns: null,
    options: null,
    eqs: [],
  };

  const result = {
    data: config.row ?? null,
    error: config.error ?? null,
    count: config.count ?? null,
  };

  const query: Record<string, unknown> = {};
  query.select = (columns?: string, options?: unknown) => {
    capture.columns = columns ?? null;
    capture.options = options ?? null;
    return query;
  };
  query.eq = (column: string, value: unknown) => {
    capture.eqs.push([column, value]);
    return query;
  };
  query.maybeSingle = async () => result;
  // Thenable: `countByStatus` espera la consulta directamente (sin `single`).
  query.then = (onFulfilled: (value: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled);

  const factory = (_accessToken: string) => ({
    from: (table: string) => {
      capture.table = table;
      return query;
    },
  });

  return { factory: factory as unknown as PostgrestClientFactory, capture };
}

describe('animals (lectura): contrato de las consultas del asistente', () => {
  it('findByCode filtra por igualdad de animal_code', async () => {
    const { factory, capture } = createReadCaptureFactory({ row: ROW });
    const repository = createSupabaseAnimalRepository(factory);

    const animal = await repository.findByCode('PIG-000123', 'jwt-operator');

    expect(capture.table).toBe('animals');
    expect(capture.columns).toContain('animal_code');
    expect(capture.eqs).toEqual([['animal_code', 'PIG-000123']]);
    expect(animal?.animal_code).toBe('PIG-000123');
  });

  it('findByCode devuelve null cuando no existe el codigo', async () => {
    const { factory } = createReadCaptureFactory({ row: null });
    const repository = createSupabaseAnimalRepository(factory);

    await expect(repository.findByCode('PIG-999999', 'jwt-operator')).resolves.toBeNull();
  });

  it('countByStatus pide conteo exacto sin filas (head) y filtra por status', async () => {
    const { factory, capture } = createReadCaptureFactory({ row: null, count: 7 });
    const repository = createSupabaseAnimalRepository(factory);

    await expect(repository.countByStatus('active', 'jwt-operator')).resolves.toBe(7);

    expect(capture.table).toBe('animals');
    expect(capture.options).toEqual({ count: 'exact', head: true });
    expect(capture.eqs).toEqual([['status', 'active']]);
  });

  it('countByStatus trata un conteo no numerico como fallo de datos (503)', async () => {
    const { factory } = createReadCaptureFactory({ row: null, count: null });
    const repository = createSupabaseAnimalRepository(factory);

    await expect(repository.countByStatus('active', 'jwt-operator')).rejects.toBeInstanceOf(
      DataAccessError,
    );
  });

  it('traduce un error de PostgREST a error de datos', async () => {
    const { factory } = createReadCaptureFactory({
      row: null,
      error: { code: '42501', message: 'permission denied' },
    });
    const repository = createSupabaseAnimalRepository(factory);

    await expect(repository.countByStatus('active', 'jwt-operator')).rejects.toBeInstanceOf(
      DataAccessError,
    );
  });
});
