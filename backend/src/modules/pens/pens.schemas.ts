import { z } from 'zod';

/**
 * Esquemas de validacion de entrada para corrales.
 * Los nombres de campo coinciden con las columnas reales de `public.pens`.
 * No se acepta `status` ni `area_id` al actualizar (ver limitacion en el
 * repositorio): el estado se cambia por la baja logica (DELETE) y el area de un
 * corral no se reasigna en esta etapa.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uuid = (label: string) =>
  z.string().regex(UUID_PATTERN, `${label} debe ser un UUID valido`);

export const penIdParamSchema = z.strictObject({ id: uuid('id') });

export const listPensQuerySchema = z.strictObject({
  area_id: uuid('area_id').optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

const code = z.string().trim().min(1).max(50);
const name = z.string().trim().min(1).max(200).nullable();
const notes = z.string().trim().max(2000).nullable();
const capacity = z.number().int().min(0).nullable();

export const createPenSchema = z.strictObject({
  area_id: uuid('area_id'),
  code,
  name: name.optional(),
  capacity: capacity.optional(),
  notes: notes.optional(),
});

export const updatePenSchema = z
  .strictObject({
    code: code.optional(),
    name: name.optional(),
    capacity: capacity.optional(),
    notes: notes.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'debe incluir al menos un campo para actualizar',
  });
