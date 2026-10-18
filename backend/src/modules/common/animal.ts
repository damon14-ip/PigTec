/**
 * Valores de los enums de `public.animals` (esquema inicial, seccion 6) y
 * valores canonicos de `origin` (especificacion maestra, 4.2).
 *
 * Se replican aqui para validar entradas y normalizar filas devueltas por la
 * base. Cualquier valor fuera de estas listas se rechaza: no se inventan
 * estados, sexos ni origenes.
 */

/** Enum `public.animal_sex`. */
export const ANIMAL_SEXES = ['male', 'female', 'unknown'] as const;
export type AnimalSex = (typeof ANIMAL_SEXES)[number];

/** Enum `public.animal_status`. */
export const ANIMAL_STATUSES = [
  'active',
  'sold',
  'dead',
  'transferred_out',
  'missing',
  'inactive',
] as const;
export type AnimalStatus = (typeof ANIMAL_STATUSES)[number];

/**
 * Subconjunto de `animal_status` que la API puede fijar directamente por ser
 * estados administrativos y no implicar una operacion con historial:
 *   - active   (reactivacion / animal operativo)
 *   - inactive (baja logica administrativa)
 *   - missing  (animal no localizado)
 *
 * `sold`, `dead` y `transferred_out` NO se fijan por API: deben derivarse de
 * las operaciones con historial (`animal_movements`: venta/transferencia y
 * `health_events`: mortalidad, via triggers del esquema), para no romper la
 * trazabilidad (especificacion maestra 5.2 y 9).
 */
export const ADMINISTRATIVE_ANIMAL_STATUSES = [
  'active',
  'inactive',
  'missing',
] as const;
export type AdministrativeAnimalStatus =
  (typeof ADMINISTRATIVE_ANIMAL_STATUSES)[number];

/**
 * Formato del codigo oficial de un porcino (`animal_code`), generado por la
 * base de datos con la secuencia `public.animals_animal_code_seq` (migracion
 * 008): `PIG-` seguido de exactamente 6 digitos, p. ej. `PIG-000123`.
 *
 * Se usa para validar el parametro de las consultas del asistente ANTES de ir a
 * la base: un codigo con otro formato nunca llega a PostgREST.
 */
export const ANIMAL_CODE_PATTERN = /^PIG-\d{6}$/;

/** Indica si un valor desconocido tiene el formato de codigo oficial. */
export function isAnimalCode(value: unknown): value is string {
  return typeof value === 'string' && ANIMAL_CODE_PATTERN.test(value);
}

/**
 * Valores canonicos de `animals.origin` (columna TEXT con CHECK). `NULL`
 * representa "no registrado" y es distinto de `'unknown'`.
 */
export const ANIMAL_ORIGINS = [
  'born_on_farm',
  'purchased',
  'transferred_in',
  'unknown',
] as const;
export type AnimalOrigin = (typeof ANIMAL_ORIGINS)[number];

export function isAnimalSex(value: unknown): value is AnimalSex {
  return (
    typeof value === 'string' &&
    (ANIMAL_SEXES as readonly string[]).includes(value)
  );
}

export function isAnimalStatus(value: unknown): value is AnimalStatus {
  return (
    typeof value === 'string' &&
    (ANIMAL_STATUSES as readonly string[]).includes(value)
  );
}

export function isAnimalOrigin(value: unknown): value is AnimalOrigin {
  return (
    typeof value === 'string' &&
    (ANIMAL_ORIGINS as readonly string[]).includes(value)
  );
}
