import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DashboardStatusCount } from '../../services/dashboard.service';
import { ChartCard } from './ChartCard';
import { STATUS_COLORS, STATUS_LABELS } from './chart-utils';

export interface AnimalStatusChartProps {
  byStatus: DashboardStatusCount[];
  total: number;
}

/**
 * Grafico A: distribucion de porcinos por estado.
 *
 * Se dibujan los seis estados oficiales del enum `animal_status`. Si no hay
 * ningun porcino registrado, se muestra el estado vacio en lugar de un grafico
 * sin datos.
 */
export function AnimalStatusChart({ byStatus, total }: AnimalStatusChartProps) {
  const data = byStatus.map((item) => ({
    status: item.status,
    label: STATUS_LABELS[item.status],
    count: item.count,
    color: STATUS_COLORS[item.status],
  }));

  return (
    <ChartCard
      title="Distribución de porcinos por estado"
      description="Inventario oficial agrupado por el estado de cada animal."
      isEmpty={total === 0}
      emptyMessage="Aún no hay porcinos registrados."
      action={<span className="chart-card__total">Total: {total}</span>}
    >
      <>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 44, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              interval={0}
              angle={-22}
              textAnchor="end"
              height={56}
              tick={{ fontSize: 12 }}
            />
            <YAxis allowDecimals={false} width={36} tick={{ fontSize: 12 }} />
            <Tooltip
              formatter={(value) => [String(value), 'Porcinos']}
              cursor={{ fill: 'rgba(31, 122, 77, 0.08)' }}
            />
            <Bar dataKey="count" name="Porcinos" radius={[4, 4, 0, 0]}>
              {data.map((entry) => (
                <Cell key={entry.status} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <ul className="chart-legend" aria-label="Leyenda de estados">
          {data.map((entry) => (
            <li key={entry.status} className="chart-legend__item">
              <span
                className="chart-legend__swatch"
                style={{ backgroundColor: entry.color }}
                aria-hidden="true"
              />
              {entry.label}: {entry.count}
            </li>
          ))}
        </ul>
      </>
    </ChartCard>
  );
}
