import { OPERATIONAL_ROLES, type OperationalRole } from './roles';

/** Identificadores de los iconos disponibles en la interfaz. */
export type IconName =
  | 'dashboard'
  | 'areas'
  | 'pig'
  | 'movements'
  | 'litters'
  | 'health'
  | 'reports'
  | 'users'
  | 'menu'
  | 'close'
  | 'logout'
  | 'chat'
  | 'send'
  | 'info'
  | 'alert'
  | 'refresh';

/** Entrada de navegacion principal. */
export interface NavItem {
  /** Clave estable usada para permisos y pruebas. */
  key: string;
  /** Ruta de la aplicacion. */
  path: string;
  /** Etiqueta visible en el menu. */
  label: string;
  /** Descripcion breve (se muestra como texto de apoyo). */
  description: string;
  icon: IconName;
  /** Roles que pueden acceder a la seccion. */
  roles: readonly OperationalRole[];
  /** `true` para coincidir solo con la ruta exacta (Dashboard). */
  end?: boolean;
}

/**
 * Navegacion principal de PigTec.
 *
 * Los permisos se declaran una sola vez (aqui) y se reutilizan tanto en el menu
 * lateral como en la proteccion de rutas, para no duplicar reglas.
 *
 * Matriz de referencia (especificacion maestra, seccion 5.1):
 * - todas las secciones operativas: cualquier rol operativo activo,
 * - `Usuarios`: solo `admin`.
 * La seccion de reportes es visible para todos los roles operativos; los filtros
 * y exportaciones respetaran el rol en S5-B/S5-E.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    key: 'dashboard',
    path: '/',
    label: 'Dashboard',
    description: 'Resumen general de la granja',
    icon: 'dashboard',
    roles: OPERATIONAL_ROLES,
    end: true,
  },
  {
    key: 'areas',
    path: '/areas',
    label: 'Áreas y corrales',
    description: 'Zonas de la granja y sus corrales',
    icon: 'areas',
    roles: OPERATIONAL_ROLES,
  },
  {
    key: 'animals',
    path: '/animals',
    label: 'Porcinos',
    description: 'Inventario y trazabilidad de animales',
    icon: 'pig',
    roles: OPERATIONAL_ROLES,
  },
  {
    key: 'movements',
    path: '/movements',
    label: 'Movimientos',
    description: 'Historial de ubicaciones y salidas',
    icon: 'movements',
    roles: OPERATIONAL_ROLES,
  },
  {
    key: 'litters',
    path: '/litters',
    label: 'Camadas',
    description: 'Nacimientos y crías por camada',
    icon: 'litters',
    roles: OPERATIONAL_ROLES,
  },
  {
    key: 'health',
    path: '/health',
    label: 'Sanidad',
    description: 'Eventos sanitarios y tratamientos',
    icon: 'health',
    roles: OPERATIONAL_ROLES,
  },
  {
    key: 'reports',
    path: '/reports',
    label: 'Reportes y análisis',
    description: 'Indicadores, series y exportaciones',
    icon: 'reports',
    roles: OPERATIONAL_ROLES,
  },
  {
    key: 'users',
    path: '/users',
    label: 'Usuarios',
    description: 'Perfiles, roles y estado de acceso',
    icon: 'users',
    roles: ['admin'],
  },
];

/** Devuelve los roles autorizados de una ruta, o `null` si la ruta no existe. */
export function rolesForPath(path: string): readonly OperationalRole[] | null {
  const item = NAV_ITEMS.find((entry) => entry.path === path);
  return item ? item.roles : null;
}

/** Indica si un rol puede acceder al modulo indicado. */
export function canAccessModule(
  key: string,
  role: OperationalRole,
): boolean {
  const item = NAV_ITEMS.find((entry) => entry.key === key);
  return item ? item.roles.includes(role) : false;
}
