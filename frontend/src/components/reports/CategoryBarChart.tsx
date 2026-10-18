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
import { ChartCard } from '../dashboard/ChartCard';

export interface CategoryBarItem {
  /** Clave estable (valor del enum o `null` serializado). */
  key: string;
  /** Etiqueta visible en el eje y la leyenda. */
  label: string;
  count: number;
  /** Color opcional de la barra; si falta se usa `defaultColor`. */
  color?: string;
}

export interface CategoryBarChartProps {
  title: string;
  description?: string;
  /** Nombre de la unidad contada (tooltip y leyenda). */
  unit: string;
  items: CategoryBarItem[];
  /** `true` cuando no hay datos reales que dibujar. */
  isEmpty?: boolean;
  emptyMessage?: string;
  /** Total mostrado en la cabecera; `null` u omitido lo oculta. */
  total?: number | null;
  /** Color por defecto de las barras sin color propio (identidad PigTec). */
  defaultColor?: string;
}

/**
 * Grafico de barras generico para una distribucion por categoria real.
 *
 * Reutiliza el marco `ChartCard` (con su estado vacio honesto) y dibuja una
 * barra por valor del enum, con leyenda de etiqueta y conteo. No inventa datos:
 * si la lista esta vacia o el total es 0, se muestra el estado vacio.
 */
export function CategoryBarChart({
  title,
  description,
  unit,
  items,
  isEmpty,
  emptyMessage = 'Sin datos suficientes para este gráfico.',
  total,
  defaultColor = '#1f7a4d',
}: CategoryBarChartProps) {
  const data = items.map((item) => ({
    key: item.key,
    label: item.label,
    count: item.count,
    color: item.color ?? defaultColor,
  }));

  const empty =
    isEmpty ??
    (typeof total === 'number' ? total === 0 : items.length === 0);

  return (
    <ChartCard
      title={title}
      description={description}
      isEmpty={empty}
      emptyMessage={emptyMessage}
      action={
        typeof total === 'number' ? (
          <span className="chart-card__total">Total: {total}</span>
        ) : null
      }
    >
      <>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 44, left: 0 }}
          >
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
              formatter={(value) => [String(value), unit]}
              cursor={{ fill: 'rgba(31, 122, 77, 0.08)' }}
            />
            <Bar dataKey="count" name={unit} radius={[4, 4, 0, 0]}>
              {data.map((entry) => (
                <Cell key={entry.key} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <ul className="chart-legend" aria-label={`Leyenda: ${unit}`}>
          {data.map((entry) => (
            <li key={entry.key} className="chart-legend__item">
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
