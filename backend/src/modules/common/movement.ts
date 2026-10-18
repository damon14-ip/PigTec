/**
 * Valores del enum `public.movement_reason` (esquema inicial, seccion 9) y
 * clasificacion de motivos segun su naturaleza.
 *
 * Se replican aqui para validar entradas y normalizar filas devueltas por la
 * base. Cualquier valor fuera de esta lista se rechaza: no se inventan motivos.
 */

/** Enum `public.movement_reason`. */
export const MOVEMENT_REASONS = [
  'weaning',
  'growth_stage',
  'fattening',
  'breeding',
  'health_isolation',
  'sale',
  'transfer',
  'management',
  'other',
] as const;
export type MovementReason = (typeof MOVEMENT_REASONS)[number];

export function isMovementReason(value: unknown): value is MovementReason {
  return (
    typeof value === 'string' &&
    (MOVEMENT_REASONS as readonly string[]).includes(value)
  );
}

/**
 * Motivos que SIEMPRE implican una salida del animal de la granja
 * (`to_pen_id` nulo). `transfer` se trata aparte porque puede ser interno
 * (cambio de corral) o externo (salida), segun tenga o no corral destino.
 */
export const EXTERNAL_EXIT_REASONS = ['sale'] as const;

/**
 * Motivos internos que exigen un corral destino: no tienen sentido sin cambio
 * de ubicacion y dejarian al animal activo sin corral.
 */
export const DESTINATION_REQUIRED_REASONS = [
  'weaning',
  'growth_stage',
  'fattening',
  'breeding',
  'health_isolation',
  'management',
  'other',
] as const;

/**
 * Estados de `public.animals` que admiten movimientos ordinarios. Los estados
 * terminales (`sold`, `dead`, `transferred_out`) y la baja logica (`inactive`)
 * quedan fuera (especificacion maestra, seccion 9: las transiciones de estado
 * deben impedir movimientos posteriores a venta, muerte o salida externa).
 */
export const MOVEMENT_COMPATIBLE_ANIMAL_STATUSES = ['active', 'missing'] as const;
