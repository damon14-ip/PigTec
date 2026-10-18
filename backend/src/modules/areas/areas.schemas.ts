import { z } from 'zod';

/**
 * Esquemas de validacion de entrada para areas.
 * Se usa `strictObject` para rechazar propiedades no previstas (p. ej. `status`
 * o `id` enviados por el cliente). Los nombres de campo coinciden con las
 * columnas reales de `public.areas`.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uuid = (label: string) =>
  z.string().regex(UUID_PATTERN, `${label} debe ser un UUID valido`);

export const areaIdParamSchema = z.strictObject({ id: uuid('id') });

export const listAreasQuerySchema = z.strictObject({
  status: z.enum(['active', 'inactive']).optional(),
});

const name = z.string().trim().min(1).max(200);
const description = z.string().trim().max(2000).nullable();

export const createAreaSchema = z.strictObject({
  name,
  description: description.optional(),
});

export const updateAreaSchema = z
  .strictObject({
    name: name.optional(),
    description: description.optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.description !== undefined,
    { message: 'debe incluir al menos un campo para actualizar' },
  );
