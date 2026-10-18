import { formatCalendarDate } from '../../lib/dates';
import type { ReportsLittersSummary } from '../../services/reports.service';

export interface ReportLittersTableProps {
  litters: ReportsLittersSummary;
}

/** Formatea un conteo de nacimientos; `null` significa "no registrado". */
function count(value: number | null): string {
  return value === null ? '—' : String(value);
}

/**
 * Tabla de las camadas mas recientes del periodo.
 *
 * Suma solo los conteos reales que trae cada camada: un valor `null` (no
 * registrado) se muestra como «—» y NUNCA se suma como 0. El aviso de
 * truncamiento lo aporta la propia seccion del resumen.
 */
export function ReportLittersTable({ litters }: ReportLittersTableProps) {
  return (
    <section className="card" aria-labelledby="reports-litters-table-title">
      <header className="card__header">
        <div>
          <h2 id="reports-litters-table-title" className="card__title">
            Camadas recientes
          </h2>
          <p className="card__subtitle">
            Últimas camadas registradas dentro del periodo analizado.
          </p>
        </div>
      </header>

      {litters.recent.length === 0 ? (
        <p className="table-empty">
          {litters.total === 0
            ? 'No hay camadas registradas en el periodo.'
            : 'No hay camadas que mostrar en el detalle.'}
        </p>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <caption className="visually-hidden">
              Camadas recientes del periodo
            </caption>
            <thead>
              <tr>
                <th scope="col">Camada</th>
                <th scope="col">Fecha de parto</th>
                <th scope="col">Nacidos</th>
                <th scope="col">Nacidos vivos</th>
                <th scope="col">Mortinatos</th>
              </tr>
            </thead>
            <tbody>
              {litters.recent.map((litter) => (
                <tr key={litter.id}>
                  <td>
                    {litter.litter_code ? (
                      <span className="code-chip">{litter.litter_code}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{formatCalendarDate(litter.birth_date)}</td>
                  <td>{count(litter.total_born)}</td>
                  <td>{count(litter.born_alive)}</td>
                  <td>{count(litter.stillborn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
