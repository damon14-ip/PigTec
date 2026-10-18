/**
 * Estado de ubicacion (`public.location_status`), compartido por areas y
 * corrales. Coincide EXACTAMENTE con el enum real de la base de datos y con el
 * esquema del backend; no se anaden valores que no existan.
 */
export const LOCATION_STATUSES = ['active', 'inactive'] as const;

export type LocationStatus = (typeof LOCATION_STATUSES)[number];

/** Etiquetas en espanol para la interfaz (los valores de la API estan en ingles). */
export const LOCATION_STATUS_LABELS: Record<LocationStatus, string> = {
  active: 'Activo',
  inactive: 'Inactivo',
};

/** Indica si un valor desconocido es un estado de ubicacion valido. */
export function isLocationStatus(value: unknown): value is LocationStatus {
  return (
    typeof value === 'string' &&
    (LOCATION_STATUSES as readonly string[]).includes(value)
  );
}
