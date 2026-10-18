/**
 * Roles del sistema, alineados con el backend (`src/modules/auth/roles.ts`) y el
 * enum `public.user_role` de la base de datos.
 *
 * `viewer` existe en la base como valor por defecto de `profiles.role`, pero NO
 * tiene permisos operativos. El frontend no lo ofrece como rol utilizable y el
 * backend ya responde 403 para ese caso en `GET /auth/profile`.
 */
export const ROLES = [
  'admin',
  'manager',
  'operator',
  'veterinarian',
  'viewer',
] as const;

export type Role = (typeof ROLES)[number];

/** Roles con permisos operativos (excluye `viewer`). */
export const OPERATIONAL_ROLES = [
  'admin',
  'manager',
  'operator',
  'veterinarian',
] as const;

export type OperationalRole = (typeof OPERATIONAL_ROLES)[number];

/**
 * Roles que pueden administrar el catalogo de areas y corrales (alta, edicion y
 * baja logica). Debe coincidir EXACTAMENTE con el backend
 * (`src/modules/areas/areas.routes.ts`) y con las politicas RLS de areas/pens.
 * El backend es la fuente de verdad: esto solo oculta acciones no permitidas.
 */
export const CATALOG_WRITE_ROLES = ['admin', 'manager'] as const;

export type CatalogWriteRole = (typeof CATALOG_WRITE_ROLES)[number];

/** Indica si un rol operativo puede administrar el catalogo de areas/corrales. */
export function canManageCatalog(role: OperationalRole): boolean {
  return (CATALOG_WRITE_ROLES as readonly string[]).includes(role);
}

/**
 * Roles que pueden registrar y editar porcinos (alta oficial directa y cambios
 * de estado administrativo). Debe coincidir EXACTAMENTE con el backend
 * (`src/modules/animals/animals.routes.ts`, `ADMIN_MANAGER`) y con las politicas
 * RLS de `animals`.
 *
 * La edicion de animales por parte de `operator` esta pendiente de definicion
 * tecnica (especificacion maestra 5.1): por eso hoy solo se habilita a
 * admin/manager. El backend responde 403 a cualquier otro rol.
 */
export const ANIMAL_WRITE_ROLES = ['admin', 'manager'] as const;

export type AnimalWriteRole = (typeof ANIMAL_WRITE_ROLES)[number];

/** Indica si un rol operativo puede registrar o editar porcinos. */
export function canManageAnimals(role: OperationalRole): boolean {
  return (ANIMAL_WRITE_ROLES as readonly string[]).includes(role);
}

/** Etiquetas en espanol para mostrar (la API y la base usan valores en ingles). */
const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador',
  manager: 'Encargado',
  operator: 'Trabajador',
  veterinarian: 'Veterinario',
  viewer: 'Solo lectura (sin permisos)',
};

/** Devuelve la etiqueta en espanol de un rol. */
export function roleLabel(role: Role): string {
  return ROLE_LABELS[role];
}

/** Indica si un valor desconocido es un rol operativo valido. */
export function isOperationalRole(value: unknown): value is OperationalRole {
  return (
    typeof value === 'string' &&
    (OPERATIONAL_ROLES as readonly string[]).includes(value)
  );
}
