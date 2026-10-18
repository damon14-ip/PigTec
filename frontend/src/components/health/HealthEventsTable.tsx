import { formatDateTimeLocal } from '../../lib/dates';
import {
  CLINICAL_EVENT_TYPES,
  HEALTH_EVENT_TYPE_LABELS,
  MORTALITY_EVENT_TYPE,
  type HealthEvent,
  type HealthEventType,
} from '../../services/health-events.service';
import { Button } from '../ui/Button';

export interface HealthEventsTableProps {
  events: readonly HealthEvent[];
  /** Resuelve el código PigTec de un porcino (columna "Porcino"). */
  animalCodeOf: (animalId: string) => string | null;
  /** Acción "Ver detalle" (opcional). */
  onView?: (event: HealthEvent) => void;
  /** Acción "Historial del porcino" (opcional; no se muestra en el propio historial). */
  onAnimalHistory?: (event: HealthEvent) => void;
  /** Muestra la columna "Porcino" (listado global). */
  showAnimal?: boolean;
  /** Mensaje cuando no hay filas que mostrar. */
  emptyMessage: string;
  /** Texto del `caption` accesible de la tabla. */
  caption?: string;
}

/** Clase visual del tipo de evento (observación, clínico o mortalidad). */
function typeBadgeClass(type: HealthEventType): string {
  if (type === MORTALITY_EVENT_TYPE) {
    return 'badge badge--mortality';
  }
  if ((CLINICAL_EVENT_TYPES as readonly string[]).includes(type)) {
    return 'badge badge--clinical';
  }
  return 'badge badge--observation';
}

/**
 * Tabla de eventos sanitarios reutilizada por el listado global (`/health`) y
 * por el historial de un porcino. Es solo presentación: no pide datos ni decide
 * permisos.
 *
 * El historial es inmutable: no se ofrecen acciones de edición ni borrado.
 */
export function HealthEventsTable({
  events,
  animalCodeOf,
  onView,
  onAnimalHistory,
  showAnimal = true,
  emptyMessage,
  caption = 'Eventos sanitarios',
}: HealthEventsTableProps) {
  if (events.length === 0) {
    return <p className="table-empty">{emptyMessage}</p>;
  }

  return (
    <div className="table-wrapper">
      <table className="data-table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Fecha y hora</th>
            {showAnimal ? <th scope="col">Porcino</th> : null}
            <th scope="col">Tipo</th>
            <th scope="col">Título</th>
            <th scope="col">Descripción</th>
            <th scope="col">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const code = animalCodeOf(event.animal_id);
            return (
              <tr key={event.id}>
                <td>{formatDateTimeLocal(event.occurred_at)}</td>
                {showAnimal ? (
                  <td>
                    {code ? (
                      <span className="code-chip">{code}</span>
                    ) : (
                      'Código no disponible'
                    )}
                  </td>
                ) : null}
                <td>
                  <span className={typeBadgeClass(event.event_type)}>
                    {HEALTH_EVENT_TYPE_LABELS[event.event_type]}
                  </span>
                </td>
                <td>{event.title}</td>
                <td className="health-notes">{event.description ?? '—'}</td>
                <td>
                  <div className="row-actions">
                    {onView ? (
                      <Button variant="secondary" onClick={() => onView(event)}>
                        Ver detalle
                      </Button>
                    ) : null}
                    {showAnimal && onAnimalHistory ? (
                      <Button
                        variant="secondary"
                        onClick={() => onAnimalHistory(event)}
                      >
                        Historial del porcino
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
