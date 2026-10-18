import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../lib/http';
import { EMPTY_SUMMARY, FULL_SUMMARY } from '../test/dashboard-fixtures';
import {
  getDashboardSummary,
  isDashboardSummary,
} from './dashboard.service';

function makeClient(get: () => Promise<unknown>): ApiClient {
  return {
    get: vi.fn(get),
    post: vi.fn(async () => {
      throw new Error('no debe usarse POST');
    }),
  } as unknown as ApiClient;
}

describe('dashboard.service: validacion del contrato', () => {
  it('acepta un resumen completo valido', () => {
    expect(isDashboardSummary(FULL_SUMMARY)).toBe(true);
  });

  it('acepta la base vacia (ceros confirmados y nulls)', () => {
    expect(isDashboardSummary(EMPTY_SUMMARY)).toBe(true);
  });

  it('rechaza respuestas incompletas o con tipos incorrectos', () => {
    expect(isDashboardSummary(null)).toBe(false);
    expect(isDashboardSummary({})).toBe(false);
    expect(
      isDashboardSummary({
        ...FULL_SUMMARY,
        animals: { total: '20', active: 12, byStatus: [] },
      }),
    ).toBe(false);
    expect(
      isDashboardSummary({
        ...FULL_SUMMARY,
        animals: {
          ...FULL_SUMMARY.animals,
          byStatus: [{ status: 'desconocido', count: 1 }],
        },
      }),
    ).toBe(false);
    // Una tasa fuera de 0..1 es un contrato invalido.
    expect(
      isDashboardSummary({
        ...FULL_SUMMARY,
        pens: { ...FULL_SUMMARY.pens, occupancyRate: 1.5 },
      }),
    ).toBe(false);
    // Falta el indicador de capacidad parcial: contrato invalido.
    expect(
      isDashboardSummary({
        ...FULL_SUMMARY,
        pens: {
          ...FULL_SUMMARY.pens,
          capacity: {
            registered: true,
            total: 20,
            housedAnimals: 18,
            usageRate: 0.9,
          },
        },
      }),
    ).toBe(false);
  });
});

describe('dashboard.service: consulta', () => {
  it('GET /dashboard/summary devuelve el resumen validado', async () => {
    const client = makeClient(async () => FULL_SUMMARY);
    const summary = await getDashboardSummary(client);

    expect(client.get).toHaveBeenCalledWith('/dashboard/summary', undefined);
    expect(summary.animals.active).toBe(12);
  });

  it('propaga el ApiError cuando la API falla (fail-closed)', async () => {
    const client = makeClient(async () => {
      throw new ApiError(503, 'service_unavailable', 'no disponible');
    });

    await expect(getDashboardSummary(client)).rejects.toBeInstanceOf(ApiError);
  });

  it('rechaza una respuesta no valida del servidor', async () => {
    const client = makeClient(async () => ({ animals: {} }));

    await expect(getDashboardSummary(client)).rejects.toThrow(
      'Respuesta no valida del servidor.',
    );
  });
});
