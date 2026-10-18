import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../lib/http';
import { EMPTY_REPORTS, FULL_REPORTS } from '../test/reports-fixtures';
import {
  getReportsSummary,
  isReportsSummary,
  reportsQueryString,
} from './reports.service';

function makeClient(get: () => Promise<unknown>): ApiClient {
  return {
    get: vi.fn(get),
    post: vi.fn(async () => {
      throw new Error('no debe usarse POST');
    }),
  } as unknown as ApiClient;
}

describe('reports.service: validacion del contrato', () => {
  it('acepta un resumen completo valido', () => {
    expect(isReportsSummary(FULL_REPORTS)).toBe(true);
  });

  it('acepta la base vacia (ceros confirmados y nulls)', () => {
    expect(isReportsSummary(EMPTY_REPORTS)).toBe(true);
  });

  it('rechaza respuestas incompletas o con tipos incorrectos', () => {
    expect(isReportsSummary(null)).toBe(false);
    expect(isReportsSummary({})).toBe(false);
    expect(
      isReportsSummary({
        ...FULL_REPORTS,
        animals: { ...FULL_REPORTS.animals, total: '120' },
      }),
    ).toBe(false);
    // Un valor de enum inexistente invalida la distribucion.
    expect(
      isReportsSummary({
        ...FULL_REPORTS,
        animals: {
          ...FULL_REPORTS.animals,
          byStatus: [{ value: 'desconocido', count: 1 }],
        },
      }),
    ).toBe(false);
    // Una tasa fuera de 0..1 es un contrato invalido.
    expect(
      isReportsSummary({
        ...FULL_REPORTS,
        pens: { ...FULL_REPORTS.pens, occupancyRate: 1.5 },
      }),
    ).toBe(false);
    // Falta la bandera de truncamiento (honestidad de datos).
    expect(
      isReportsSummary({
        ...FULL_REPORTS,
        pens: { ...FULL_REPORTS.pens, truncated: undefined },
      }),
    ).toBe(false);
    // Un conteo negativo no es valido.
    expect(
      isReportsSummary({
        ...FULL_REPORTS,
        litters: { ...FULL_REPORTS.litters, total: -1 },
      }),
    ).toBe(false);
  });
});

describe('reports.service: construccion de la consulta', () => {
  it('no envia parametros cuando no hay filtros', () => {
    expect(reportsQueryString()).toBe('');
    expect(reportsQueryString({})).toBe('');
  });

  it('envia solo los filtros presentes con los nombres del backend', () => {
    const query = reportsQueryString({
      from: '2026-05-01',
      to: '2026-10-18',
      movement_reason: 'sale',
      health_event_type: 'treatment',
      sex: 'female',
      origin: 'purchased',
    });
    const params = new URLSearchParams(query);

    expect(params.get('from')).toBe('2026-05-01');
    expect(params.get('to')).toBe('2026-10-18');
    expect(params.get('movement_reason')).toBe('sale');
    expect(params.get('health_event_type')).toBe('treatment');
    expect(params.get('sex')).toBe('female');
    expect(params.get('origin')).toBe('purchased');
  });
});

describe('reports.service: consulta', () => {
  it('GET /reports/summary devuelve el resumen validado', async () => {
    const client = makeClient(async () => FULL_REPORTS);
    const summary = await getReportsSummary(client);

    expect(client.get).toHaveBeenCalledWith('/reports/summary', undefined);
    expect(summary.animals.total).toBe(120);
  });

  it('adjunta los filtros a la URL', async () => {
    const client = makeClient(async () => FULL_REPORTS);
    await getReportsSummary(client, { from: '2026-05-01', sex: 'female' });

    expect(client.get).toHaveBeenCalledWith(
      '/reports/summary?from=2026-05-01&sex=female',
      undefined,
    );
  });

  it('propaga el ApiError cuando la API falla (fail-closed)', async () => {
    const client = makeClient(async () => {
      throw new ApiError(503, 'service_unavailable', 'no disponible');
    });

    await expect(getReportsSummary(client)).rejects.toBeInstanceOf(ApiError);
  });

  it('rechaza una respuesta no valida del servidor', async () => {
    const client = makeClient(async () => ({ animals: {} }));

    await expect(getReportsSummary(client)).rejects.toThrow(
      'Respuesta no valida del servidor.',
    );
  });
});
