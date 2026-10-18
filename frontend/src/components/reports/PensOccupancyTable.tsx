import { formatPercent } from '../dashboard/chart-utils';
import type { ReportsPensSummary } from '../../services/reports.service';

export interface PensOccupancyTableProps {
  pens: ReportsPensSummary;
}

/**
 * Tabla de ocupacion y capacidad de los corrales ACTIVOS.
 *
 * Se apoya en el resumen real del backend: `occupants` por corral y `capacity`
 * registrada. Una capacidad no registrada se muestra como «Sin registrar» y una
 * utilizacion no calculable como «—» (nunca 0%): no se presentan porcentajes
 * enganosos. Si la exploracion se trunco, el backend no devuelve filas y se
 * avisa de que el detalle no esta disponible.
 */
export function PensOccupancyTable({ pens }: PensOccupancyTableProps) {
  return (
    <section className="card" aria-labelledby="reports-pens-table-title">
      <header className="card__header">
        <div>
          <h2 id="reports-pens-table-title" className="card__title">
            Ocupación por corral
          </h2>
          <p className="card__subtitle">
            Corrales activos con su capacidad y ocupantes registrados.
          </p>
        </div>
      </header>

      {pens.truncated ? (
        <p className="chart-empty" role="status">
          La exploración de ocupación no se pudo completar: el detalle por corral
          no está disponible.
        </p>
      ) : pens.byPen.length === 0 ? (
        <p className="table-empty">
          {pens.total === 0
            ? 'No hay corrales activos registrados.'
            : 'No hay corrales que mostrar con los filtros actuales.'}
        </p>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <caption className="visually-hidden">
              Ocupación y capacidad de los corrales activos
            </caption>
            <thead>
              <tr>
                <th scope="col">Corral</th>
                <th scope="col">Área</th>
                <th scope="col">Capacidad</th>
                <th scope="col">Ocupantes</th>
                <th scope="col">Utilización</th>
              </tr>
            </thead>
            <tbody>
              {pens.byPen.map((pen) => {
                const usage = formatPercent(pen.usageRate);
                return (
                  <tr key={pen.id}>
                    <td>
                      <span className="code-chip">{pen.code}</span>
                      {pen.name ? (
                        <>
                          {' '}
                          <span>{pen.name}</span>
                        </>
                      ) : null}
                    </td>
                    <td>{pen.area_name ?? '—'}</td>
                    <td>{pen.capacity ?? 'Sin registrar'}</td>
                    <td>{pen.occupants}</td>
                    <td>{usage ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pens.capacity.partial && !pens.truncated ? (
        <p className="card__footnote">
          Capacidad parcial: algunos corrales activos no tienen capacidad
          registrada, así que no se calcula el porcentaje de utilización total.
        </p>
      ) : null}
    </section>
  );
}
