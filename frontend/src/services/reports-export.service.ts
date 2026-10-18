import {
  ApiError,
  type ApiClient,
  type FileDownload,
  type RequestOptions,
} from '../lib/http';
import { reportsQueryString, type ReportsQuery } from './reports.service';

/**
 * Exportaciones del modulo de reportes (S5-E2).
 *
 * El backend genera el archivo EN MEMORIA con el JWT de la sesion y RLS; el
 * frontend solo solicita la descarga y la inicia en el navegador. Nunca se
 * construye el documento en el cliente ni se inventan datos.
 *
 * Los tipos de documento PDF y sus codigos coinciden con el backend
 * (`backend/src/modules/reports/export/export.schemas.ts` y `pdf.builder.ts`).
 */

/** Tipos de documento PDF disponibles (mismo orden que el backend). */
export const PDF_DOCUMENT_TYPES = [
  'general',
  'animals',
  'movements',
  'health',
  'litters',
] as const;

export type PdfDocumentType = (typeof PDF_DOCUMENT_TYPES)[number];

/** Etiqueta legible de cada documento PDF. */
export const PDF_DOCUMENT_LABELS: Record<PdfDocumentType, string> = {
  general: 'Informe general',
  animals: 'Inventario de porcinos (KPG-RG-14)',
  movements: 'Movimientos (KPG-RG-15)',
  health: 'Sanitario (KPG-RG-07)',
  litters: 'Camadas (KPG-RG-03)',
};

/**
 * Nombre de archivo de reserva, usado solo si el servidor no informa uno en
 * `Content-Disposition`. El backend siempre envia un nombre descriptivo.
 */
const PDF_FALLBACK_FILENAMES: Record<PdfDocumentType, string> = {
  general: 'PigTec_Informe_general.pdf',
  animals: 'PigTec_KPG-RG-14_Inventario_porcinos.pdf',
  movements: 'PigTec_KPG-RG-15_Movimientos.pdf',
  health: 'PigTec_KPG-RG-07_Sanitario.pdf',
  litters: 'PigTec_KPG-RG-03_Camadas.pdf',
};

const EXCEL_FALLBACK_FILENAME = 'PigTec_Reportes_KolkaPig.xlsx';

/** Descarga lista para usarse en el navegador (nombre de archivo garantizado). */
export interface ReportExportDownload {
  blob: Blob;
  filename: string;
  contentType: string | null;
}

type GetFile = (path: string, options?: RequestOptions) => Promise<FileDownload>;

/**
 * Obtiene `getFile` del cliente o falla con un `ApiError` claro. `getFile` es
 * opcional en el tipo para no romper los dobles de prueba; en produccion el
 * cliente real siempre lo implementa.
 */
function requireGetFile(client: ApiClient): GetFile {
  const getFile = client.getFile;
  if (!getFile) {
    throw new ApiError(
      0,
      'download_unavailable',
      'La descarga de archivos no esta disponible en este navegador.',
    );
  }
  return getFile;
}

/** Completa el nombre de archivo con un valor de reserva cuando falta. */
function toDownload(
  file: FileDownload,
  fallbackFilename: string,
): ReportExportDownload {
  const filename =
    file.filename && file.filename.trim() !== ''
      ? file.filename
      : fallbackFilename;
  return { blob: file.blob, filename, contentType: file.contentType };
}

/**
 * Descarga el Excel integral con los filtros aplicados.
 *
 * `GET /reports/export/excel` exige un rol operativo activo y responde 400 si un
 * filtro no es valido; cualquier error se propaga como `ApiError`.
 */
export async function exportReportsExcel(
  client: ApiClient,
  query?: ReportsQuery,
  options?: RequestOptions,
): Promise<ReportExportDownload> {
  const getFile = requireGetFile(client);
  const file = await getFile(
    `/reports/export/excel${reportsQueryString(query)}`,
    options,
  );
  return toDownload(file, EXCEL_FALLBACK_FILENAME);
}

/**
 * Descarga el PDF del tipo indicado con los filtros aplicados.
 *
 * `GET /reports/export/pdf?type=...` exige un rol operativo activo; el tipo se
 * anade SIEMPRE al `query string`, junto con los filtros reales.
 */
export async function exportReportsPdf(
  client: ApiClient,
  type: PdfDocumentType,
  query?: ReportsQuery,
  options?: RequestOptions,
): Promise<ReportExportDownload> {
  const getFile = requireGetFile(client);
  const params = new URLSearchParams(reportsQueryString(query).replace(/^\?/, ''));
  params.set('type', type);
  const file = await getFile(`/reports/export/pdf?${params.toString()}`, options);
  return toDownload(file, PDF_FALLBACK_FILENAMES[type]);
}

/**
 * Inicia la descarga del archivo en el navegador creando un enlace temporal.
 *
 * El objeto `URL` se revoca justo despues del clic para no retener el Blob en
 * memoria. Es la via estandar y no requiere ningun servicio externo.
 */
export function triggerDownload(file: ReportExportDownload): void {
  const url = URL.createObjectURL(file.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
