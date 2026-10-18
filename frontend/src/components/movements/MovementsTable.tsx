import {
  MOVEMENT_REASON_LABELS,
  allowsNullDestination,
  type Movement,
} from '../../services/movements.service';
import { formatMovementDateTime } from './labels';

export interface MovementsTableProps {
  movements: readonly Movement[];
  /** Resuelve el código PigTec de un porcino (columna "Porcino"). */
  animalCodeOf: (animalId: string) => string | null;
  /** Resuelve la etiqueta legible de un corral (`Área · código`). */
  penLabelOf: (penId: string) => string | null;
  /** Mensaje cuando no hay filas que mostrar. */
  emptyMessage: string;
  /** Muestra la columna "Porcino" (listado global). */
  showAnimal?: boolean;
  /** Texto del `caption` accesible de la tabla. */
  caption?: string;
}

function describeOrigin(
  movement: Movement,
  penLabelOf: (penId: string) => string | null,
): string {
  if (!movement.from_pen_id) {
    return '—';
  }
  return penLabelOf(movement.from_pen_id) ?? 'Corral no disponible';
}

/**
 * Texto del destino. Un destino nulo solo es coherente en salidas externas
 * (`sale` o `transfer` sin corral); se explica en lugar de mostrarlo como vacío.
 */
function describeDestination(
  movement: Movement,
  penLabelOf: (penId: string) => string | null,
): string {
  if (movement.to_pen_id) {
    return penLabelOf(movement.to_pen_id) ?? 'Corral no disponible';
  }
  return allowsNullDestination(movement.reason)
    ? 'Salida de la granja'
    : 'Sin destino';
}

/**
 * Tabla de movimientos reutilizada por el listado global (`/movements`) y por la
 * trazabilidad de un porcino. Es solo presentación: no pide datos ni decide
 * permisos.
 *
 * El historial llega ordenado por `moved_at` descendente desde el backend; el
 * consumidor decide si invierte el orden (la ficha del porcino lo muestra del
 * más antiguo al más reciente).
 */
export function MovementsTable({
  movements,
  animalCodeOf,
  penLabelOf,
  emptyMessage,
  showAnimal = true,
  caption = 'Movimientos de porcinos',
}: MovementsTableProps) {
  if (movements.length === 0) {
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
            <th scope="col">Tipo de movimiento</th>
            <th scope="col">Origen</th>
            <th scope="col">Destino</th>
            <th scope="col">Observaciones</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((movement) => {
            const code = animalCodeOf(movement.animal_id);
            return (
              <tr key={movement.id}>
                <td className="movement-when">
                  {formatMovementDateTime(movement.moved_at)}
                </td>
                {showAnimal ? (
                  <td>
                    {code ? (
                      <span className="code-chip">{code}</span>
                    ) : (
                      'Código no disponible'
                    )}
                  </td>
                ) : null}
                <td>{MOVEMENT_REASON_LABELS[movement.reason]}</td>
                <td>{describeOrigin(movement, penLabelOf)}</td>
                <td>{describeDestination(movement, penLabelOf)}</td>
                <td className="movement-notes">{movement.notes ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
