import { describe, expect, it } from 'vitest';
import {
  MAX_EXPORT_CATALOG,
  MAX_EXPORT_ROWS,
  createRejectingReportsExportRepository,
  createSupabaseReportsExportRepository,
} from '../src/modules/reports/export/export.repository.js';
import type {
  PostgrestClientFactory,
  PostgrestQuery,
} from '../src/modules/common/postgrest.js';

/**
 * Pruebas del repositorio de lectura detallado de exportaciones.
 *
 * Se usa un doble del cliente PostgREST que RECORDA cada llamada a `range`: asi
 * se comprueba que la exploracion pagina de verdad (no se queda en la primera
 * pagina) y que respeta el tope (`MAX_EXPORT_ROWS`/`MAX_EXPORT_CATALOG`) marcando
 * el truncamiento en lugar de cortar en silencio.
 */

interface Calls {
  tokens: string[];
  tables: string[];
  ranges: { from: number; to: number }[];
  orders: string[];
}

function makeQuery(
  rows: Record<string, unknown>[],
  table: string,
  calls: Calls,
  error: { code?: string; message?: string } | null = null,
) {
  let from = 0;
  let to = rows.length;

  const query = {
    select: () => query,
    insert: () => query,
    update: () => query,
    eq: () => query,
    gte: () => query,
    lte: () => query,
    or: () => query,
    order: (column: string) => {
      calls.orders.push(`${table}.${column}`);
      return query;
    },
    limit: (count: number) => {
      to = from + count - 1;
      return query;
    },
    range: (rangeFrom: number, rangeTo: number) => {
      from = rangeFrom;
      to = rangeTo;
      calls.ranges.push({ from: rangeFrom, to: rangeTo });
      return query;
    },
    maybeSingle: async () => ({ data: null, error }),
    single: async () => ({ data: null, error }),
    then: (onFulfilled: (value: unknown) => unknown) =>
      Promise.resolve(
        error
          ? { data: null, error }
          : { data: rows.slice(from, to + 1), error: null },
      ).then(onFulfilled),
  };

  return query as unknown as PostgrestQuery<Record<string, unknown>>;
}

function makeFactory(
  tables: Record<string, Record<string, unknown>[]>,
  calls: Calls,
  error: { code?: string; message?: string } | null = null,
): PostgrestClientFactory {
  return (accessToken: string) => {
    calls.tokens.push(accessToken);
    return {
      from: <T = Record<string, unknown>>(table: string) => {
        calls.tables.push(table);
        return makeQuery(
          tables[table] ?? [],
          table,
          calls,
          error,
        ) as unknown as PostgrestQuery<T>;
      },
    };
  };
}

function makeCalls(): Calls {
  return { tokens: [], tables: [], ranges: [], orders: [] };
}

function animalRow(index: number): Record<string, unknown> {
  return {
    id: `a-${index}`,
    animal_code: `PIG-${String(index).padStart(6, '0')}`,
    ear_tag_code: null,
    sex: 'male',
    breed: null,
    birth_date: null,
    origin: null,
    litter_id: null,
    current_pen_id: null,
    status: 'active',
    entry_date: '2026-01-01',
    exit_date: null,
  };
}

function areaRow(index: number): Record<string, unknown> {
  return {
    id: `ar-${index}`,
    name: `Area ${index}`,
    description: null,
    status: 'active',
  };
}

describe('export.repository: paginacion de la exploracion', () => {
  it('lee mas alla de la primera pagina hasta agotar el conjunto', async () => {
    const rows = Array.from({ length: 501 }, (_, index) =>
      animalRow(index + 1),
    );
    const calls = makeCalls();
    const repository = createSupabaseReportsExportRepository(
      makeFactory({ animals: rows }, calls),
    );

    const scan = await repository.listAnimals({}, 'jwt-operador');

    expect(scan.rows).toHaveLength(501);
    expect(scan.truncated).toBe(false);
    // Dos peticiones: la primera llena la pagina (500) y la segunda la cierra.
    expect(calls.ranges).toEqual([
      { from: 0, to: 499 },
      { from: 500, to: 999 },
    ]);
    // Cada exploracion usa el JWT del usuario (RLS).
    expect(calls.tokens).toEqual(['jwt-operador']);
  });

  it('marca truncamiento al alcanzar MAX_EXPORT_ROWS (sin cortar en silencio)', async () => {
    const rows = Array.from({ length: MAX_EXPORT_ROWS + 1 }, (_, index) =>
      animalRow(index + 1),
    );
    const repository = createSupabaseReportsExportRepository(
      makeFactory({ animals: rows }, makeCalls()),
    );

    const scan = await repository.listAnimals({}, 'jwt-admin');

    expect(scan.truncated).toBe(true);
    expect(scan.rows).toHaveLength(MAX_EXPORT_ROWS);
  });

  it('acota los catalogos con MAX_EXPORT_CATALOG', async () => {
    const rows = Array.from({ length: MAX_EXPORT_CATALOG + 1 }, (_, index) =>
      areaRow(index + 1),
    );
    const repository = createSupabaseReportsExportRepository(
      makeFactory({ areas: rows }, makeCalls()),
    );

    const scan = await repository.listAreas('jwt-admin');

    expect(scan.truncated).toBe(true);
    expect(scan.rows).toHaveLength(MAX_EXPORT_CATALOG);
  });
});

describe('export.repository: validacion y errores', () => {
  it('rechaza una fila con forma inesperada (no se inventan datos)', async () => {
    const repository = createSupabaseReportsExportRepository(
      makeFactory({ animals: [{ id: 'a1' }] }, makeCalls()),
    );

    await expect(repository.listAnimals({}, 'jwt-admin')).rejects.toMatchObject({
      name: 'DataAccessError',
    });
  });

  it('convierte el error de PostgREST en DataAccessError (fail-closed)', async () => {
    const repository = createSupabaseReportsExportRepository(
      makeFactory({}, makeCalls(), { code: '42501', message: 'rls' }),
    );

    await expect(repository.listAnimals({}, 'jwt-admin')).rejects.toMatchObject({
      name: 'DataAccessError',
    });
  });

  it('no expone operaciones de escritura', () => {
    const repository = createSupabaseReportsExportRepository(
      makeFactory({}, makeCalls()),
    );

    expect(Object.keys(repository)).not.toContain('create');
    expect(Object.keys(repository)).not.toContain('update');
    expect(Object.keys(repository)).not.toContain('insert');
    expect(Object.keys(repository)).not.toContain('delete');
  });
});

describe('export.repository: repositorio por defecto', () => {
  it('falla en todas las lecturas si no se inyecta uno real (503)', async () => {
    const repository = createRejectingReportsExportRepository();

    await expect(repository.listAnimals({}, 'jwt')).rejects.toMatchObject({
      name: 'DataAccessError',
    });
    await expect(repository.listMovements(
      { from: '', to: '' },
      null,
      'jwt',
    )).rejects.toMatchObject({ name: 'DataAccessError' });
  });
});
