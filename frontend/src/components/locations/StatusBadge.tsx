import {
  LOCATION_STATUS_LABELS,
  type LocationStatus,
} from '../../services/location-status';

export interface StatusBadgeProps {
  status: LocationStatus;
}

/** Etiqueta visual del estado de un area o corral (activo / inactivo). */
export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`status-badge status-badge--${status}`}>
      {LOCATION_STATUS_LABELS[status]}
    </span>
  );
}
