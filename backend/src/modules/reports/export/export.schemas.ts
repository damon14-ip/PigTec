import { z } from 'zod';
import { reportsQuerySchema } from '../reports.schemas.js';

/**
 * Esquemas de validacion de las exportaciones.
 *
 * Reutilizan EXACTAMENTE los filtros de `GET /reports/summary`
 * (`reportsQuerySchema`): no se inventan criterios nuevos. El PDF anade el
 * parametro `type` para elegir el documento; su valor por defecto es el informe
 * general.
 */

/** Tipos de documento PDF disponibles. */
export const PDF_DOCUMENT_TYPES = [
  'general',
  'animals',
  'movements',
  'health',
  'litters',
] as const;

export type PdfDocumentType = (typeof PDF_DOCUMENT_TYPES)[number];

/** Filtros del Excel integral (identicos a los del resumen de reportes). */
export const exportExcelQuerySchema = reportsQuerySchema;

/** Filtros del PDF mas el tipo de documento. */
export const exportPdfQuerySchema = z.strictObject({
  ...reportsQuerySchema.shape,
  type: z.enum(PDF_DOCUMENT_TYPES).default('general'),
});

export type ExportExcelQuery = z.infer<typeof exportExcelQuerySchema>;
export type ExportPdfQuery = z.infer<typeof exportPdfQuerySchema>;
