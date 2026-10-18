import { z } from 'zod';

/**
 * Esquemas de validacion de entrada para camadas (reproduccion).
 *
 * Los nombres de campo coinciden con las columnas reales de `public.litters`.
 * La validacion es estricta (`strictObject`) y rechaza campos no previstos
 * (por ejemplo `id`, `created_at` o `updated_at`).
 *
 * No hay generacion automatica de `litter_code` documentada: se acepta tal
 * cual, opcional; su unicidad la garantiza la base (`litter_code` UNIQUE).
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

/** Cantidad entera no negativa (coherente con los CHECK de `public.litters`). */
const count = z.number().int().min(0);

const limit = z.coerce.number().int().min(1).max(500).optional();
const offset = z.coerce.number().int().min(0).optional();

export const litterIdParamSchema = z.strictObject({ id: uuid('id') });

export const listLittersQuerySchema = z.strictObject({
  mother_id: uuid('mother_id').optional(),
  father_id: uuid('father_id').optional(),
  birth_from: date('birth_from').optional(),
  birth_to: date('birth_to').optional(),
  limit,
  offset,
});

/**
 * Registro de una camada.
 *
 * `mother_id` es obligatorio (flujo de nacimiento: madre -> camada -> crias).
 * `father_id` es opcional; si se indica debe ser macho. Las cantidades se
 * validan tambien en el servicio contra `total_born`.
 */
export const createLitterSchema = z.strictObject({
  mother_id: uuid('mother_id'),
  litter_code: nullableText(100).optional(),
  father_id: uuid('father_id').nullable().optional(),
  birth_date: date('birth_date').nullable().optional(),
  total_born: count.optional(),
  born_alive: count.optional(),
  stillborn: count.optional(),
  notes: nullableText(2000).optional(),
});

/**
 * Actualizacion de datos permitidos de una camada. NO se aceptan `id`,
 * `created_at` ni `updated_at`. `mother_id` se reemplaza (no se anula) por otra
 * madre valida; `father_id` si puede anularse (no se indico o se corrige).
 */
export const updateLitterSchema = z
  .strictObject({
    litter_code: nullableText(100).optional(),
    mother_id: uuid('mother_id').optional(),
    father_id: uuid('father_id').nullable().optional(),
    birth_date: date('birth_date').nullable().optional(),
    total_born: count.nullable().optional(),
    born_alive: count.nullable().optional(),
    stillborn: count.nullable().optional(),
    notes: nullableText(2000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'debe incluir al menos un campo para actualizar',
  });
