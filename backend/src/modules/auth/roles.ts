/**
 * Roles del sistema.
 *
 * Fuente: especificacion maestra (seccion 5) y enum `public.user_role` del
 * esquema inicial. `viewer` existe en la base y es el valor por defecto de
 * `profiles.role`, pero NO tiene permisos operativos: se reconoce aqui para
 * poder denegarlo, no como rol utilizable.
 */
export const ROLES = [
  'admin',
  'manager',
  'operator',
  'veterinarian',
  'viewer',
] as const;

export type Role = (typeof ROLES)[number];

/**
 * Roles con permisos operativos. Deliberadamente excluye `viewer`.
 *
 * Se usa para tipar el conjunto permitido de cada operacion: al no incluir
 * `viewer`, TypeScript impide que una ruta lo autorice por descuido.
 */
export const OPERATIONAL_ROLES = [
  'admin',
  'manager',
  'operator',
  'veterinarian',
] as const;

export type OperationalRole = (typeof OPERATIONAL_ROLES)[number];

/** Indica si un valor desconocido (p. ej. de la base) es un rol definido. */
export function isRole(value: unknown): value is Role {
  return (
    typeof value === 'string' && (ROLES as readonly string[]).includes(value)
  );
}

/** Indica si un valor es un rol con permisos operativos (excluye `viewer`). */
export function isOperationalRole(value: unknown): value is OperationalRole {
  return (
    typeof value === 'string' &&
    (OPERATIONAL_ROLES as readonly string[]).includes(value)
  );
}
