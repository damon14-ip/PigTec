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
import type { DashboardPensSummary } from '../../services/dashboard.service';
import { ChartCard } from './ChartCard';
import { formatPercent } from './chart-utils';

export interface PensOccupancyChartProps {
  pens: DashboardPensSummary;
}

/**
 * Grafico B: ocupacion de corrales.
 *
 * Se muestran los corrales activos ocupados frente a los libres (misma unidad,
 * para no mezclar corrales con animales). La utilizacion de capacidad, cuando
 * hay capacidad registrada, se resume bajo el grafico. Sin datos calculables
 * (sin corrales o exploracion parcial) se muestra el estado vacio.
 */
export function PensOccupancyChart({ pens }: PensOccupancyChartProps) {
  const { total, occupied, capacity } = pens;
  const empty = total === 0 || occupied === null;

  const data = [
    { label: 'Ocupados', count: occupied ?? 0, color: '#1f7a4d' },
    { label: 'Libres', count: Math.max(total - (occupied ?? 0), 0), color: '#cfd8d3' },
  ];

  const usageRate = formatPercent(capacity.usageRate);
  const occupancyRate = formatPercent(pens.occupancyRate);

  return (
    <ChartCard
      title="Ocupación de corrales"
      description="Corrales activos con al menos un porcino alojado."
      isEmpty={empty}
      emptyMessage={
        total === 0
          ? 'No hay corrales activos registrados.'
          : 'Sin datos suficientes para calcular la ocupación.'
      }
      action={
        occupancyRate ? (
          <span className="chart-card__total">Ocupación: {occupancyRate}</span>
        ) : null
      }
    >
      <>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} width={36} tick={{ fontSize: 12 }} />
            <Tooltip
              formatter={(value) => [String(value), 'Corrales']}
              cursor={{ fill: 'rgba(31, 122, 77, 0.08)' }}
            />
            <Bar dataKey="count" name="Corrales" radius={[4, 4, 0, 0]}>
              {data.map((entry) => (
                <Cell key={entry.label} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="chart-note">
          {capacity.registered && !capacity.partial && capacity.total !== null && usageRate
            ? `Utilización de capacidad: ${capacity.housedAnimals ?? 0} alojados de ${capacity.total} (${usageRate}).`
            : capacity.registered && capacity.partial
              ? 'Capacidad parcial: algunos corrales no tienen capacidad registrada. No se calcula el porcentaje de utilización.'
              : 'Sin capacidad registrada en los corrales: no se puede calcular la utilización.'}
        </p>
      </>
    </ChartCard>
  );
}
