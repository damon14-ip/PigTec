import { z } from 'zod';
import {
  ADMINISTRATIVE_ANIMAL_STATUSES,
  ANIMAL_ORIGINS,
  ANIMAL_SEXES,
  ANIMAL_STATUSES,
} from '../common/animal.js';

/**
 * Esquemas de validacion de entrada para porcinos.
 *
 * Los nombres de campo coinciden con las columnas reales de `public.animals`.
 * La validacion es estricta (`strictObject`) y rechaza campos no previstos
 * (por ejemplo `status`, `animal_code` o `current_pen_id` en una actualizacion
 * general, o `id`/`created_at`).
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/**
 * Busqueda de texto segura para el filtro OR de PostgREST: se limita a
 * caracteres que no rompen la sintaxis de filtros (sin comas, parentesis ni
 * comodines). La busqueda aplica `ilike` sobre los dos codigos.
 */
const SEARCH_PATTERN = /^[A-Za-z0-9._\- ]+$/;

const uuid = (label: string) =>
  z.string().regex(UUID_PATTERN, `${label} debe ser un UUID valido`);

/** Fecha de calendario real en formato `YYYY-MM-DD` (rechaza p. ej. 2026-02-30). */
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

const date = (label: string) =>
  z
    .string()
    .refine(isCalendarDate, `${label} debe ser una fecha YYYY-MM-DD valida`);

/** Texto opcional: se recorta; cadena vacia o nula se normaliza a `NULL`. */
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value === null || value === '' ? null : value));

export const animalIdParamSchema = z.strictObject({ id: uuid('id') });

export const listAnimalsQuerySchema = z.strictObject({
  status: z.enum(ANIMAL_STATUSES).optional(),
  sex: z.enum(ANIMAL_SEXES).optional(),
  origin: z.enum(ANIMAL_ORIGINS).optional(),
  breed: z.string().trim().min(1).max(200).optional(),
  current_pen_id: uuid('current_pen_id').optional(),
  q: z.string().trim().min(1).max(100).regex(SEARCH_PATTERN).optional(),
});

/**
 * Registro de un porcino.
 *
 * `animal_code` NO se acepta: lo genera la base de datos con la secuencia
 * `public.animals_animal_code_seq` en formato `PIG-000001` (migracion 008), de
 * modo que sea unico, permanente e inmutable (especificacion 4.1). El backend
 * nunca lo envia. Como el esquema es estricto (`strictObject`), enviar
 * `animal_code` responde 400.
 *
 * Tampoco se aceptan `status`, `exit_date` ni `created_by`: el alta siempre es
 * `active`, la fecha de salida se deriva de operaciones con historial y el autor
 * se toma del JWT.
 */
export const createAnimalSchema = z.strictObject({
  ear_tag_code: nullableText(100).optional(),
  sex: z.enum(ANIMAL_SEXES).optional(),
  breed: nullableText(200).optional(),
  birth_date: date('birth_date').nullable().optional(),
  origin: z.enum(ANIMAL_ORIGINS).nullable().optional(),
  mother_id: uuid('mother_id').nullable().optional(),
  father_id: uuid('father_id').nullable().optional(),
  litter_id: uuid('litter_id').nullable().optional(),
  current_pen_id: uuid('current_pen_id').nullable().optional(),
  entry_date: date('entry_date').optional(),
  notes: nullableText(2000).optional(),
});

/**
 * Actualizacion de datos editables. NO se aceptan `animal_code` (inmutable),
 * `status` (endpoint dedicado), `current_pen_id` (se cambia por movimientos,
 * para no romper la trazabilidad), `entry_date`/`exit_date` ni `created_by`.
 */
export const updateAnimalSchema = z
  .strictObject({
    ear_tag_code: nullableText(100).optional(),
    sex: z.enum(ANIMAL_SEXES).optional(),
    breed: nullableText(200).optional(),
    birth_date: date('birth_date').nullable().optional(),
    origin: z.enum(ANIMAL_ORIGINS).nullable().optional(),
    mother_id: uuid('mother_id').nullable().optional(),
    father_id: uuid('father_id').nullable().optional(),
    litter_id: uuid('litter_id').nullable().optional(),
    notes: nullableText(2000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'debe incluir al menos un campo para actualizar',
  });

/**
 * Cambio de estado administrativo. Solo admite `active`, `inactive` y
 * `missing`; los estados derivados de operaciones con historial (`sold`,
 * `dead`, `transferred_out`) se rechazan aqui.
 */
export const updateAnimalStatusSchema = z.strictObject({
  status: z.enum(ADMINISTRATIVE_ANIMAL_STATUSES),
});
