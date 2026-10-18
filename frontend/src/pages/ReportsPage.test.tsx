import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { makeAuthValue, renderWithAuth } from '../test/helpers';
import { EMPTY_REPORTS, FULL_REPORTS } from '../test/reports-fixtures';
import { ApiError, type ApiClient, type FileDownload } from '../lib/http';
import type { ReportsSummary } from '../services/reports.service';
import { ReportsPage } from './ReportsPage';

function makeClient(
  get: (path: string) => Promise<unknown>,
  getFile?: (path: string) => Promise<FileDownload>,
): ApiClient {
  return {
    get: vi.fn(get),
    getFile: getFile ? vi.fn(getFile) : undefined,
    post: vi.fn(async () => {
      throw new Error('no debe usarse POST');
    }),
  } as unknown as ApiClient;
}

/** `getFile` que resuelve un PDF/Excel minimo y registra la ruta pedida. */
function fileReturning(
  overrides: Partial<FileDownload> = {},
): (path: string) => Promise<FileDownload> {
  return async () => ({
    blob: new Blob(['x']),
    filename: 'PigTec_export.xlsx',
    contentType: 'application/octet-stream',
    ...overrides,
  });
}

const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

afterEach(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

/** Stub de descarga: evita depender de la implementacion de jsdom. */
function stubDownload(): { created: string[] } {
  const created: string[] = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:${created.length}`;
    created.push(url);
    void blob;
    return url;
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  return { created };
}

function renderReports(client: ApiClient) {
  return renderWithAuth(<ReportsPage />, {
    auth: makeAuthValue({ apiClient: client }),
  });
}

describe('ReportsPage: resumen con datos', () => {
  it('muestra los indicadores, gráficos y tablas reales', async () => {
    const client = makeClient(async () => FULL_REPORTS);
    renderReports(client);

    await screen.findByText('Distribución de porcinos por estado');

    // Indicadores.
    expect(
      within(screen.getByLabelText('Porcinos registrados')).getByText('120'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Corrales activos')).getByText('8'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Movimientos del periodo')).getByText('32'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Eventos sanitarios')).getByText('24'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Camadas del periodo')).getByText('12'),
    ).toBeInTheDocument();

    // Graficos y leyendas.
    expect(
      screen.getByRole('heading', { name: 'Distribución por sexo' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Distribución por origen' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Movimientos por motivo' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Eventos sanitarios por tipo' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Hembra: 72')).toBeInTheDocument();
    expect(screen.getByText('Sin registrar: 2')).toBeInTheDocument();

    // Tablas de detalle.
    expect(screen.getByText('CAM-2026-012')).toBeInTheDocument();
    expect(screen.getByText('C-1')).toBeInTheDocument();
    // Una capacidad no registrada se muestra como tal (nunca 0 enganoso).
    expect(screen.getByText('Sin registrar')).toBeInTheDocument();
  });
});

describe('ReportsPage: base de datos vacía', () => {
  it('muestra 0 confirmados y estados vacíos coherentes', async () => {
    const client = makeClient(async () => EMPTY_REPORTS);
    renderReports(client);

    await screen.findByText('Base de datos sin registros');

    expect(
      within(screen.getByLabelText('Porcinos registrados')).getByText('0'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Corrales activos')).getByText('0'),
    ).toBeInTheDocument();
    // El mensaje de inventario vacio se repite en cada grafico de distribucion.
    expect(
      screen.getAllByText('Aún no hay porcinos registrados.').length,
    ).toBeGreaterThanOrEqual(3);
    expect(
      screen.getByText('No hay camadas registradas en el periodo.'),
    ).toBeInTheDocument();
  });
});

describe('ReportsPage: datos parciales', () => {
  it('avisa cuando la ocupación o las sumas de camadas se truncan', async () => {
    const partial: ReportsSummary = {
      ...FULL_REPORTS,
      pens: { ...FULL_REPORTS.pens, truncated: true, byPen: [] },
      litters: {
        ...FULL_REPORTS.litters,
        truncated: true,
        complete: false,
        averageBornAlive: null,
      },
    };
    const client = makeClient(async () => partial);
    renderReports(client);

    await screen.findByText('Datos parciales');
    expect(
      screen.getByText(/La ocupación de corrales alcanzó el límite de exploración/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Las sumas de nacimientos son parciales/),
    ).toBeInTheDocument();
  });
});

describe('ReportsPage: filtros', () => {
  it('consulta de nuevo con el filtro real al cambiar un select', async () => {
    const client = makeClient(async () => FULL_REPORTS);
    renderReports(client);

    await screen.findByText('Distribución de porcinos por estado');
    expect(client.get).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Motivo de movimiento'), {
      target: { value: 'sale' },
    });

    await vi.waitFor(() =>
      expect(client.get).toHaveBeenCalledWith(
        '/reports/summary?movement_reason=sale',
        expect.anything(),
      ),
    );
  });

  it('no consulta un rango de fechas invertido y lo advierte', async () => {
    const client = makeClient(async () => FULL_REPORTS);
    renderReports(client);

    await screen.findByText('Distribución de porcinos por estado');

    // Cada cambio de fecha valido dispara una consulta; el rango invertido no.
    fireEvent.change(screen.getByLabelText('Hasta'), {
      target: { value: '2026-10-01' },
    });
    await vi.waitFor(() => expect(client.get).toHaveBeenCalledTimes(2));

    fireEvent.change(screen.getByLabelText('Desde'), {
      target: { value: '2026-10-10' },
    });

    expect(
      await screen.findByText('Rango de fechas no válido'),
    ).toBeInTheDocument();
    expect(client.get).toHaveBeenCalledTimes(2);
  });

  it('vuelve a consultar al pulsar Actualizar', async () => {
    const client = makeClient(async () => FULL_REPORTS);
    renderReports(client);

    await screen.findByText('Distribución de porcinos por estado');
    expect(client.get).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /actualizar/i }));

    await vi.waitFor(() => expect(client.get).toHaveBeenCalledTimes(2));
  });
});

describe('ReportsPage: fallos de API', () => {
  it('muestra el error y permite reintentar', async () => {
    let calls = 0;
    const client = makeClient(async () => {
      calls += 1;
      if (calls === 1) {
        throw new ApiError(503, 'service_unavailable', 'no disponible');
      }
      return FULL_REPORTS;
    });
    renderReports(client);

    await screen.findByText('No se pudieron calcular los reportes');
    expect(
      screen.getByText('El servicio no esta disponible. Intenta mas tarde.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    expect(
      await screen.findByText('Distribución de porcinos por estado'),
    ).toBeInTheDocument();
  });

  it('no renderiza indicadores antes de que responda la API', () => {
    const client = makeClient(() => new Promise(() => {}));
    renderReports(client);

    expect(screen.getByText('Calculando reportes…')).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Porcinos registrados'),
    ).not.toBeInTheDocument();
  });
});

describe('ReportsPage: exportaciones', () => {
  it('descarga el Excel con los filtros aplicados', async () => {
    const { created } = stubDownload();
    const client = makeClient(
      async () => FULL_REPORTS,
      fileReturning({ filename: 'PigTec_Reportes_KolkaPig_2026-10-18.xlsx' }),
    );
    renderReports(client);

    await screen.findByText('Distribución de porcinos por estado');

    fireEvent.change(screen.getByLabelText('Motivo de movimiento'), {
      target: { value: 'sale' },
    });
    await vi.waitFor(() =>
      expect(client.get).toHaveBeenCalledWith(
        '/reports/summary?movement_reason=sale',
        expect.anything(),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: /descargar excel/i }));

    await screen.findByText('Descarga iniciada');
    expect(client.getFile).toHaveBeenCalledWith(
      '/reports/export/excel?movement_reason=sale',
      undefined,
    );
    expect(created).toHaveLength(1);
    expect(
      screen.getByText(/PigTec_Reportes_KolkaPig_2026-10-18\.xlsx/),
    ).toBeInTheDocument();
  });

  it('descarga el PDF del tipo elegido', async () => {
    stubDownload();
    const client = makeClient(
      async () => FULL_REPORTS,
      fileReturning({ filename: 'PigTec_KPG-RG-07_Sanitario.pdf' }),
    );
    renderReports(client);

    await screen.findByText('Distribución de porcinos por estado');

    fireEvent.change(screen.getByLabelText('Tipo de documento PDF'), {
      target: { value: 'health' },
    });
    fireEvent.click(screen.getByRole('button', { name: /descargar pdf/i }));

    await screen.findByText('Descarga iniciada');
    expect(client.getFile).toHaveBeenCalledWith(
      '/reports/export/pdf?type=health',
      undefined,
    );
  });

  it('muestra el estado de generación mientras se descarga', async () => {
    stubDownload();
    let resolveFile: (value: FileDownload) => void = () => {};
    const client = makeClient(
      async () => FULL_REPORTS,
      () =>
        new Promise<FileDownload>((resolve) => {
          resolveFile = resolve;
        }),
    );
    renderReports(client);

    await screen.findByText('Distribución de porcinos por estado');
    fireEvent.click(screen.getByRole('button', { name: /descargar excel/i }));

    expect(
      await screen.findByText(/Generando el archivo/),
    ).toBeInTheDocument();

    resolveFile({
      blob: new Blob(['x']),
      filename: 'PigTec_Reportes.xlsx',
      contentType: null,
    });
    await screen.findByText('Descarga iniciada');
  });

  it('muestra el error del backend si la generación falla', async () => {
    stubDownload();
    const client = makeClient(async () => FULL_REPORTS, async () => {
      throw new ApiError(503, 'service_unavailable', 'no disponible');
    });
    renderReports(client);

    await screen.findByText('Distribución de porcinos por estado');
    fireEvent.click(screen.getByRole('button', { name: /descargar excel/i }));

    await screen.findByText('No se pudo generar la exportación');
    expect(
      screen.getByText('El servicio no esta disponible. Intenta mas tarde.'),
    ).toBeInTheDocument();
  });

  it('avisa cuando el navegador no soporta la descarga de archivos', async () => {
    stubDownload();
    // Sin `getFile`: simula un cliente que no puede descargar archivos.
    const client = makeClient(async () => FULL_REPORTS);
    renderReports(client);

    await screen.findByText('Distribución de porcinos por estado');
    fireEvent.click(screen.getByRole('button', { name: /descargar excel/i }));

    await screen.findByText('No se pudo generar la exportación');
    expect(
      screen.getByText(/no esta disponible en este navegador/),
    ).toBeInTheDocument();
  });

  it('desactiva las exportaciones con un rango de fechas invertido', async () => {
    const client = makeClient(async () => FULL_REPORTS, fileReturning());
    renderReports(client);

    await screen.findByText('Distribución de porcinos por estado');

    fireEvent.change(screen.getByLabelText('Hasta'), {
      target: { value: '2026-10-01' },
    });
    await vi.waitFor(() => expect(client.get).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByLabelText('Desde'), {
      target: { value: '2026-10-10' },
    });

    await screen.findByText('Rango de fechas no válido');
    expect(
      screen.getByRole('button', { name: /descargar excel/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /descargar pdf/i }),
    ).toBeDisabled();
  });
});
