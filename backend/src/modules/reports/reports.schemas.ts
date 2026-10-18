import { z } from 'zod';
import { ANIMAL_ORIGINS, ANIMAL_SEXES } from '../common/animal.js';
import { HEALTH_EVENT_TYPES } from '../common/health-event.js';
import { MOVEMENT_REASONS } from '../common/movement.js';

/**
 * Esquemas de validacion de la consulta de reportes.
 *
 * Todos los parametros son opcionales: la seccion de reportes siempre responde
 * con datos REALES, aplicando un periodo por defecto cuando el cliente no fija
 * `from`/`to`. La validacion es estricta (`strictObject`) y rechaza campos no
 * previstos: el cliente no puede forzar consultas arbitrarias.
 *
 * Los filtros de categoria son EXACTAMENTE los que admite el backend en sus
 * endpoints operativos (`reason`, `event_type`, `sex`, `origin`), de modo que los
 * reportes no inventan criterios nuevos.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Comprueba que `YYYY-MM-DD` es una fecha de calendario real. */
function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const calendarDate = (label: string) =>
  z
    .string()
    .refine(isCalendarDate, `${label} debe ser una fecha YYYY-MM-DD valida`);

export const reportsQuerySchema = z.strictObject({
  /** Limite inferior inclusivo del periodo (UTC). */
  from: calendarDate('from').optional(),
  /** Limite superior inclusivo del periodo (UTC). */
  to: calendarDate('to').optional(),
  /** Motivo de movimiento (acota la seccion de movimientos). */
  movement_reason: z.enum(MOVEMENT_REASONS).optional(),
  /** Tipo de evento sanitario (acota la seccion de sanidad). */
  health_event_type: z.enum(HEALTH_EVENT_TYPES).optional(),
  /** Sexo del porcino (acota el inventario). */
  sex: z.enum(ANIMAL_SEXES).optional(),
  /** Origen del porcino (acota el inventario). */
  origin: z.enum(ANIMAL_ORIGINS).optional(),
});

export type ReportsQuery = z.infer<typeof reportsQuerySchema>;
