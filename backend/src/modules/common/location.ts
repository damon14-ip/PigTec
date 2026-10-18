/**
 * Estado de ubicaciones (areas y corrales), segun el enum `public.location_status`
 * del esquema inicial. `active` permite operar; `inactive` es la baja logica.
 */
export const LOCATION_STATUSES = ['active', 'inactive'] as const;

export type LocationStatus = (typeof LOCATION_STATUSES)[number];

/** Indica si un valor desconocido (p. ej. de la base) es un estado valido. */
export function isLocationStatus(value: unknown): value is LocationStatus {
  return (
    typeof value === 'string' &&
    (LOCATION_STATUSES as readonly string[]).includes(value)
  );
}
