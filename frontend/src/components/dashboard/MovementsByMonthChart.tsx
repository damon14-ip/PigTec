import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DashboardMovementsByMonth } from '../../services/dashboard.service';
import { ChartCard } from './ChartCard';
import { formatMonthLabel } from './chart-utils';

export interface MovementsByMonthChartProps {
  byMonth: DashboardMovementsByMonth[];
}

/**
 * Grafico C: movimientos por mes.
 *
 * Periodo claramente definido: los meses informados por el backend (los seis
 * meses recientes, terminando en el mes actual). Sin movimientos en todo el
 * periodo se muestra el estado vacio.
 */
export function MovementsByMonthChart({ byMonth }: MovementsByMonthChartProps) {
  const data = byMonth.map((item) => ({
    month: item.month,
    label: formatMonthLabel(item.month),
    count: item.count,
  }));
  const total = data.reduce((sum, item) => sum + item.count, 0);
  const first = byMonth[0]?.month;
  const last = byMonth[byMonth.length - 1]?.month;

  return (
    <ChartCard
      title="Movimientos por mes"
      description={
        first && last
          ? `Periodo reciente: ${formatMonthLabel(first)} – ${formatMonthLabel(last)}.`
          : 'Historial de movimientos registrados.'
      }
      isEmpty={total === 0}
      emptyMessage="No hay movimientos registrados en el periodo reciente."
      action={<span className="chart-card__total">Total: {total}</span>}
    >
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis allowDecimals={false} width={36} tick={{ fontSize: 12 }} />
          <Tooltip
            formatter={(value) => [String(value), 'Movimientos']}
            cursor={{ fill: 'rgba(31, 122, 77, 0.08)' }}
          />
          <Bar
            dataKey="count"
            name="Movimientos"
            fill="#1f7a4d"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
