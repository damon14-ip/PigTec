import { z } from 'zod';
import { MOVEMENT_REASONS } from '../common/movement.js';

/**
 * Esquemas de validacion de entrada para movimientos de porcinos.
 *
 * Los nombres de campo coinciden con las columnas reales de
 * `public.animal_movements`. La validacion es estricta (`strictObject`) y
 * rechaza campos no previstos (por ejemplo `id`, `recorded_by` o `created_at`):
 * el autor se toma del JWT y la fila es historial inmutable.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fecha y hora ISO 8601 con zona horaria (`Z` o `±HH:MM`). Se exige zona para
 * almacenar en UTC sin ambiguedad (especificacion maestra, seccion 9).
 */
const ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

const uuid = (label: string) =>
  z.string().regex(UUID_PATTERN, `${label} debe ser un UUID valido`);

const isoDateTime = (label: string) =>
  z
    .string()
    .refine(
      (value) =>
        ISO_DATETIME_PATTERN.test(value) && !Number.isNaN(Date.parse(value)),
      `${label} debe ser una fecha ISO 8601 con zona horaria`,
    );

/** Texto opcional: se recorta; cadena vacia o nula se normaliza a `NULL`. */
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value === null || value === '' ? null : value));

const limit = z.coerce.number().int().min(1).max(500).optional();
const offset = z.coerce.number().int().min(0).optional();

export const movementIdParamSchema = z.strictObject({ id: uuid('id') });

export const animalIdParamSchema = z.strictObject({ id: uuid('id') });

/** Filtros del historial global (`GET /movements`). */
export const listMovementsQuerySchema = z.strictObject({
  animal_id: uuid('animal_id').optional(),
  from_pen_id: uuid('from_pen_id').optional(),
  to_pen_id: uuid('to_pen_id').optional(),
  /** Movimientos que tocan un corral (origen o destino). */
  pen_id: uuid('pen_id').optional(),
  reason: z.enum(MOVEMENT_REASONS).optional(),
  recorded_by: uuid('recorded_by').optional(),
  moved_from: isoDateTime('moved_from').optional(),
  moved_to: isoDateTime('moved_to').optional(),
  limit,
  offset,
});

/** Filtros del historial de un porcino (`GET /animals/:id/movements`). */
export const listAnimalMovementsQuerySchema = z.strictObject({
  reason: z.enum(MOVEMENT_REASONS).optional(),
  moved_from: isoDateTime('moved_from').optional(),
  moved_to: isoDateTime('moved_to').optional(),
  limit,
  offset,
});

/**
 * Registro de un movimiento.
 *
 * `from_pen_id` es opcional: si se omite, el backend lo completa con el corral
 * actual del animal (trazabilidad). Si se envia, debe coincidir con ese corral.
 * `to_pen_id` nulo solo es valido para motivos de salida (`sale`,
 * `transfer` externo); el resto exige corral destino.
 */
export const createMovementSchema = z.strictObject({
  animal_id: uuid('animal_id'),
  reason: z.enum(MOVEMENT_REASONS),
  from_pen_id: uuid('from_pen_id').nullable().optional(),
  to_pen_id: uuid('to_pen_id').nullable().optional(),
  moved_at: isoDateTime('moved_at').optional(),
  notes: nullableText(2000).optional(),
});
