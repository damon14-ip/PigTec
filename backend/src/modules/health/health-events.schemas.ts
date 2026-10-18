import { z } from 'zod';
import { HEALTH_EVENT_TYPES } from '../common/health-event.js';

/**
 * Esquemas de validacion de entrada para eventos sanitarios.
 *
 * Los nombres de campo coinciden con las columnas reales de
 * `public.health_events`. La validacion es estricta (`strictObject`) y rechaza
 * campos no previstos (por ejemplo `id`, `recorded_by`, `created_at` o
 * `updated_at`): el autor (`recorded_by`) se toma del JWT y la fila es historial
 * inmutable (no hay PATCH ni DELETE).
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

/**
 * `details` es JSONB y el CHECK de `public.health_events` exige que sea un
 * objeto JSON (`jsonb_typeof(details) = 'object'`). Se acepta un objeto de
 * claves/valores libres; un arreglo o un escalar se rechazan aqui (400) en vez
 * de provocar un fallo de CHECK en la base.
 */
const jsonObject = z.record(z.string(), z.unknown());

const limit = z.coerce.number().int().min(1).max(500).optional();
const offset = z.coerce.number().int().min(0).optional();

export const healthEventIdParamSchema = z.strictObject({ id: uuid('id') });

/** Parametro de porcino en `GET /animals/:id/health-events`. */
export const animalIdParamSchema = z.strictObject({ id: uuid('id') });

/** Filtros del historial sanitario global (`GET /health-events`). */
export const listHealthEventsQuerySchema = z.strictObject({
  animal_id: uuid('animal_id').optional(),
  event_type: z.enum(HEALTH_EVENT_TYPES).optional(),
  recorded_by: uuid('recorded_by').optional(),
  occurred_from: isoDateTime('occurred_from').optional(),
  occurred_to: isoDateTime('occurred_to').optional(),
  limit,
  offset,
});

/** Filtros del historial de un porcino (`GET /animals/:id/health-events`). */
export const listAnimalHealthEventsQuerySchema = z.strictObject({
  event_type: z.enum(HEALTH_EVENT_TYPES).optional(),
  occurred_from: isoDateTime('occurred_from').optional(),
  occurred_to: isoDateTime('occurred_to').optional(),
  limit,
  offset,
});

/**
 * Registro de un evento sanitario.
 *
 * `animal_id` y `event_type` son obligatorios; `title` tambien (columna NOT NULL).
 * `recorded_by` NO se acepta: se deriva del usuario autenticado. Tampoco se
 * aceptan `id`, `created_at` ni `updated_at`.
 *
 * `documented_by` es un campo TEXT del esquema (no FK) previsto para la
 * identificacion de quien documenta (puede ser un profesional externo). Su
 * semantica definitiva esta pendiente de revision (ver README de migraciones);
 * se acepta como texto opcional y se documenta como decision pendiente.
 */
export const createHealthEventSchema = z.strictObject({
  animal_id: uuid('animal_id'),
  event_type: z.enum(HEALTH_EVENT_TYPES),
  title: z.string().trim().min(1).max(200),
  occurred_at: isoDateTime('occurred_at').optional(),
  description: nullableText(2000).optional(),
  documented_by: nullableText(200).optional(),
  details: jsonObject.optional(),
  attachment_url: nullableText(2000).optional(),
});
