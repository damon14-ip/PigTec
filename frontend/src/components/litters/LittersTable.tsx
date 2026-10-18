import { formatCalendarDate } from '../../lib/dates';
import type { Litter } from '../../services/litters.service';
import { Button } from '../ui/Button';

export interface LittersTableProps {
  litters: readonly Litter[];
  /** Resuelve el código PigTec de un porcino (madre/padre). */
  animalCodeOf: (animalId: string) => string | null;
  /** Muestra la acción "Editar" (solo roles autorizados). */
  canWrite: boolean;
  onView: (litter: Litter) => void;
  onEdit: (litter: Litter) => void;
  /** Mensaje cuando no hay filas que mostrar. */
  emptyMessage: string;
}

/** Texto de un código de porcino del catálogo (o aviso si no está disponible). */
function codeText(
  animalId: string | null,
  animalCodeOf: (id: string) => string | null,
): string {
  if (!animalId) {
    return '—';
  }
  return animalCodeOf(animalId) ?? 'Código no disponible';
}

/** Número opcional: muestra «—» cuando no se registró. */
function countText(value: number | null): string {
  return value === null ? '—' : String(value);
}

/**
 * Tabla de camadas reutilizada por el listado (`/litters`). Es solo
 * presentación: no pide datos ni decide permisos.
 *
 * La camada NO se elimina (decisión D-09): no se ofrece borrado.
 */
export function LittersTable({
  litters,
  animalCodeOf,
  canWrite,
  onView,
  onEdit,
  emptyMessage,
}: LittersTableProps) {
  if (litters.length === 0) {
    return <p className="table-empty">{emptyMessage}</p>;
  }

  return (
    <div className="table-wrapper">
      <table className="data-table">
        <caption className="visually-hidden">Camadas registradas</caption>
        <thead>
          <tr>
            <th scope="col">Camada</th>
            <th scope="col">Madre</th>
            <th scope="col">Padre</th>
            <th scope="col">Parto</th>
            <th scope="col">Nacidos</th>
            <th scope="col">Vivos</th>
            <th scope="col">Muertos</th>
            <th scope="col">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {litters.map((litter) => (
            <tr key={litter.id}>
              <td>
                {litter.litter_code ? (
                  <span className="code-chip">{litter.litter_code}</span>
                ) : (
                  'Sin código'
                )}
              </td>
              <td>{codeText(litter.mother_id, animalCodeOf)}</td>
              <td>{codeText(litter.father_id, animalCodeOf)}</td>
              <td>{formatCalendarDate(litter.birth_date)}</td>
              <td>{countText(litter.total_born)}</td>
              <td>{countText(litter.born_alive)}</td>
              <td>{countText(litter.stillborn)}</td>
              <td>
                <div className="row-actions">
                  <Button variant="secondary" onClick={() => onView(litter)}>
                    Ver detalle
                  </Button>
                  {canWrite ? (
                    <Button variant="secondary" onClick={() => onEdit(litter)}>
                      Editar
                    </Button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
