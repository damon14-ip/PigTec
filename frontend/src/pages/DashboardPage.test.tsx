import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { makeAuthValue, renderWithAuth } from '../test/helpers';
import { EMPTY_SUMMARY, FULL_SUMMARY } from '../test/dashboard-fixtures';
import { ApiError, type ApiClient } from '../lib/http';
import type { DashboardSummary } from '../services/dashboard.service';
import { DashboardPage } from './DashboardPage';

function makeClient(get: (path: string) => Promise<unknown>): ApiClient {
  return {
    get: vi.fn(get),
    post: vi.fn(async () => {
      throw new Error('no debe usarse POST');
    }),
  } as unknown as ApiClient;
}

function renderDashboard(client: ApiClient) {
  return renderWithAuth(<DashboardPage />, {
    auth: makeAuthValue({ apiClient: client }),
  });
}

describe('DashboardPage: indicadores con datos', () => {
  it('muestra los valores reales del resumen', async () => {
    const client = makeClient(async () => FULL_SUMMARY);
    renderDashboard(client);

    await screen.findByText('Distribución de porcinos por estado');

    expect(within(screen.getByLabelText('Porcinos activos')).getByText('12')).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Ocupación de corrales')).getByText('3 de 5 (60%)'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Movimientos del mes')).getByText('9'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Eventos sanitarios del mes')).getByText('7'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Camadas registradas')).getByText('25'),
    ).toBeInTheDocument();

    // Graficos con sus titulos y leyendas.
    expect(
      screen.getByRole('heading', { name: 'Ocupación de corrales' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Movimientos por mes' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Activos: 12')).toBeInTheDocument();
    expect(
      screen.getByText('Utilización de capacidad: 18 alojados de 20 (90%).'),
    ).toBeInTheDocument();
  });
});

describe('DashboardPage: base de datos vacia', () => {
  it('muestra 0 confirmados y los estados vacios de los graficos', async () => {
    const client = makeClient(async () => EMPTY_SUMMARY);
    renderDashboard(client);

    await screen.findByText('Base de datos sin registros');

    expect(
      within(screen.getByLabelText('Porcinos activos')).getByText('0'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Ocupación de corrales')).getByText(
        'Sin corrales registrados',
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Movimientos del mes')).getByText('0'),
    ).toBeInTheDocument();

    expect(screen.getByText('Aún no hay porcinos registrados.')).toBeInTheDocument();
    expect(
      screen.getByText('No hay movimientos registrados en el periodo reciente.'),
    ).toBeInTheDocument();
  });
});

describe('DashboardPage: metricas no calculables', () => {
  it('no inventa cifras: muestra "Sin datos suficientes"', async () => {
    const partial: DashboardSummary = {
      ...FULL_SUMMARY,
      pens: {
        total: 4,
        occupied: null,
        occupancyRate: null,
        capacity: {
          registered: false,
          total: null,
          housedAnimals: null,
          usageRate: null,
          partial: false,
        },
      },
    };
    const client = makeClient(async () => partial);
    renderDashboard(client);

    await screen.findByText('Distribución de porcinos por estado');

    const card = screen.getByLabelText('Ocupación de corrales');
    expect(within(card).getByText('Sin datos suficientes')).toBeInTheDocument();
    expect(
      screen.getByText('Sin datos suficientes para calcular la ocupación.'),
    ).toBeInTheDocument();
  });
});

describe('DashboardPage: capacidad parcial', () => {
  it('no presenta un porcentaje cuando faltan capacidades', async () => {
    const partial: DashboardSummary = {
      ...FULL_SUMMARY,
      pens: {
        total: 5,
        occupied: 3,
        occupancyRate: 0.6,
        capacity: {
          registered: true,
          total: 20,
          housedAnimals: 18,
          usageRate: null,
          partial: true,
        },
      },
    };
    const client = makeClient(async () => partial);
    renderDashboard(client);

    await screen.findByText('Distribución de porcinos por estado');

    // No se muestra el porcentaje exacto (seria enganoso con capacidad parcial).
    expect(screen.queryByText(/90%/)).not.toBeInTheDocument();
    // El grafico explica que la capacidad es parcial y no se calcula.
    expect(
      screen.getByText(
        'Capacidad parcial: algunos corrales no tienen capacidad registrada. No se calcula el porcentaje de utilización.',
      ),
    ).toBeInTheDocument();
    // La tarjeta tambien lo advierte en lugar de dar una cifra exacta.
    expect(
      within(screen.getByLabelText('Ocupación de corrales')).getByText(
        /faltan datos en otros corrales, así que no se calcula el porcentaje\./,
      ),
    ).toBeInTheDocument();
  });
});

describe('DashboardPage: fallos de API', () => {
  it('muestra el error y permite reintentar', async () => {
    let calls = 0;
    const client = makeClient(async () => {
      calls += 1;
      if (calls === 1) {
        throw new ApiError(503, 'service_unavailable', 'no disponible');
      }
      return FULL_SUMMARY;
    });
    renderDashboard(client);

    await screen.findByText('No se pudieron cargar los indicadores');
    expect(
      screen.getByText('El servicio no esta disponible. Intenta mas tarde.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    expect(await screen.findByText('Distribución de porcinos por estado')).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Porcinos activos')).getByText('12'),
    ).toBeInTheDocument();
  });

  it('no renderiza indicadores antes de que responda la API', () => {
    const client = makeClient(() => new Promise(() => {}));
    renderDashboard(client);

    expect(screen.getByText('Calculando indicadores…')).toBeInTheDocument();
    expect(screen.queryByLabelText('Porcinos activos')).not.toBeInTheDocument();
  });
});

describe('DashboardPage: actualizacion', () => {
  it('vuelve a consultar al pulsar Actualizar', async () => {
    const client = makeClient(async () => FULL_SUMMARY);
    renderDashboard(client);

    await screen.findByText('Distribución de porcinos por estado');
    expect(client.get).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /actualizar/i }));

    await vi.waitFor(() => expect(client.get).toHaveBeenCalledTimes(2));
  });
});
