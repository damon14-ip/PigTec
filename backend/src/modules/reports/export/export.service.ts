import type { ReportsService } from '../reports.service.js';
import { buildExcelWorkbook } from './excel.builder.js';
import { buildExportFilename } from './export-format.js';
import { loadReportExportData } from './export-data.js';
import type { ReportsExportRepository } from './export.repository.js';
import type { ExportExcelQuery, ExportPdfQuery } from './export.schemas.js';
import {
  buildPdfDocument,
  pdfDocumentCode,
  pdfDocumentTitle,
} from './pdf.builder.js';

/**
 * Servicio de exportaciones del modulo de reportes.
 *
 * Es de SOLO LECTURA: usa el resumen agregado (`ReportsService`) y el repositorio
 * detallado de exportacion, ambos con el JWT del usuario y RLS. No guarda nada en
 * disco ni en buckets: genera el archivo EN MEMORIA y lo devuelve para descarga
 * bajo demanda.
 */

/** Archivo generado listo para enviar como descarga. */
export interface ReportExportFile {
  filename: string;
  contentType: string;
  buffer: Buffer;
}

export interface ReportsExportService {
  getExcel(
    query: ExportExcelQuery,
    accessToken: string,
  ): Promise<ReportExportFile>;
  getPdf(query: ExportPdfQuery, accessToken: string): Promise<ReportExportFile>;
}

export interface ReportsExportServiceOptions {
  repository: ReportsExportRepository;
  summaryService: ReportsService;
}

export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const PDF_CONTENT_TYPE = 'application/pdf';

export function createReportsExportService(
  options: ReportsExportServiceOptions,
): ReportsExportService {
  const { repository, summaryService } = options;

  return {
    async getExcel(query, accessToken) {
      const summary = await summaryService.getSummary(query, accessToken);
      const data = await loadReportExportData(repository, summary, accessToken);
      const buffer = await buildExcelWorkbook(data);

      return {
        filename: buildExportFilename(
          'Reportes_KolkaPig',
          'xlsx',
          summary.generatedAt,
        ),
        contentType: XLSX_CONTENT_TYPE,
        buffer,
      };
    },

    async getPdf(query, accessToken) {
      const summary = await summaryService.getSummary(query, accessToken);
      const data = await loadReportExportData(repository, summary, accessToken);
      const buffer = await buildPdfDocument(query.type, data);

      // El nombre de archivo describe el documento y su codigo cuando aplica.
      const slug =
        query.type === 'general'
          ? 'Informe_general'
          : `${pdfDocumentCode(query.type)}_${pdfDocumentTitle(query.type)}`;

      return {
        filename: buildExportFilename(slug, 'pdf', summary.generatedAt),
        contentType: PDF_CONTENT_TYPE,
        buffer,
      };
    },
  };
}
