import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient, type FileDownload } from '../lib/http';
import {
  PDF_DOCUMENT_LABELS,
  PDF_DOCUMENT_TYPES,
  exportReportsExcel,
  exportReportsPdf,
  triggerDownload,
} from './reports-export.service';

/** Cliente con `getFile` controlado (y un `get` que no debe usarse). */
function makeClient(
  getFile: (path: string) => Promise<FileDownload>,
): ApiClient {
  return {
    getFile: vi.fn(getFile),
    get: vi.fn(async () => {
      throw new Error('no debe usarse GET');
    }),
  } as unknown as ApiClient;
}

function fileDownload(overrides: Partial<FileDownload> = {}): FileDownload {
  return {
    blob: new Blob(['contenido']),
    filename: 'PigTec_archivo.xlsx',
    contentType: 'application/octet-stream',
    ...overrides,
  };
}

describe('reports-export.service: Excel', () => {
  it('descarga /reports/export/excel sin filtros', async () => {
    const client = makeClient(async () => fileDownload());
    const file = await exportReportsExcel(client);

    expect(client.getFile).toHaveBeenCalledWith(
      '/reports/export/excel',
      undefined,
    );
    expect(file.filename).toBe('PigTec_archivo.xlsx');
  });

  it('adjunta los filtros reales a la URL', async () => {
    const client = makeClient(async () => fileDownload());
    await exportReportsExcel(client, { from: '2026-05-01', sex: 'female' });

    expect(client.getFile).toHaveBeenCalledWith(
      '/reports/export/excel?from=2026-05-01&sex=female',
      undefined,
    );
  });

  it('usa un nombre de reserva si el servidor no lo indica', async () => {
    const client = makeClient(async () => fileDownload({ filename: null }));
    const file = await exportReportsExcel(client);

    expect(file.filename).toBe('PigTec_Reportes_KolkaPig.xlsx');
  });

  it('propaga el ApiError del backend (fail-closed)', async () => {
    const client = makeClient(async () => {
      throw new ApiError(503, 'service_unavailable', 'no disponible');
    });

    await expect(exportReportsExcel(client)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('reports-export.service: PDF', () => {
  it('anade SIEMPRE el parametro type', async () => {
    const client = makeClient(async () => fileDownload({ filename: 'x.pdf' }));
    await exportReportsPdf(client, 'health');

    expect(client.getFile).toHaveBeenCalledWith(
      '/reports/export/pdf?type=health',
      undefined,
    );
  });

  it('combina el tipo con los filtros aplicados', async () => {
    const client = makeClient(async () => fileDownload({ filename: 'x.pdf' }));
    await exportReportsPdf(client, 'movements', {
      movement_reason: 'sale',
      from: '2026-05-01',
    });

    const [url] = vi.mocked(client.getFile!).mock.calls[0];
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('type')).toBe('movements');
    expect(params.get('movement_reason')).toBe('sale');
    expect(params.get('from')).toBe('2026-05-01');
  });

  it('usa un nombre de reserva si el servidor no lo indica', async () => {
    const client = makeClient(async () => fileDownload({ filename: null }));
    const file = await exportReportsPdf(client, 'animals');

    expect(file.filename).toBe('PigTec_KPG-RG-14_Inventario_porcinos.pdf');
  });

  it('etiqueta cada tipo con su codigo KolkaPig', () => {
    expect(PDF_DOCUMENT_TYPES).toContain('general');
    expect(PDF_DOCUMENT_LABELS.animals).toContain('KPG-RG-14');
    expect(PDF_DOCUMENT_LABELS.movements).toContain('KPG-RG-15');
    expect(PDF_DOCUMENT_LABELS.health).toContain('KPG-RG-07');
    expect(PDF_DOCUMENT_LABELS.litters).toContain('KPG-RG-03');
  });
});

describe('reports-export.service: cliente sin soporte de archivos', () => {
  it('falla con un error claro si getFile no existe', async () => {
    const client = {
      get: vi.fn(async () => undefined),
    } as unknown as ApiClient;

    await expect(exportReportsExcel(client)).rejects.toMatchObject({
      code: 'download_unavailable',
    });
  });
});

describe('reports-export.service: descarga en el navegador', () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  it('crea un enlace temporal, hace clic y revoca el objeto URL', () => {
    const createObjectURL = vi.fn(() => 'blob:prueba');
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    let clicked: HTMLAnchorElement | null = null;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked = this;
      });

    triggerDownload({
      blob: new Blob(['x']),
      filename: 'PigTec_Informe_general.pdf',
      contentType: 'application/pdf',
    });

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(clicked).not.toBeNull();
    expect(clicked!.download).toBe('PigTec_Informe_general.pdf');
    expect(clicked!.href).toBe('blob:prueba');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:prueba');
    // El enlace temporal no se queda en el DOM.
    expect(document.querySelector('a[download]')).toBeNull();
  });
});
