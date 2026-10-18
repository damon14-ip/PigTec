import {
  ANIMAL_STATUS_LABELS,
  type AnimalStatus,
} from '../../services/animals.service';

export interface AnimalStatusBadgeProps {
  status: AnimalStatus;
}

/** Etiqueta visual del estado de un porcino (activo, vendido, fallecido, ...). */
export function AnimalStatusBadge({ status }: AnimalStatusBadgeProps) {
  return (
    <span className={`status-badge status-badge--animal-${status}`}>
      {ANIMAL_STATUS_LABELS[status]}
    </span>
  );
}
