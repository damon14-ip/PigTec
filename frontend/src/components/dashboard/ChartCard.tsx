import type { ReactNode } from 'react';
import { Card, CardHeader } from '../ui/Card';

export interface ChartCardProps {
  title: string;
  description?: string;
  /** Accion opcional en la cabecera (p. ej. una leyenda). */
  action?: ReactNode;
  /** `true` cuando no hay datos suficientes para dibujar el grafico. */
  isEmpty?: boolean;
  /** Mensaje mostrado en el estado vacio. */
  emptyMessage?: string;
  /** Contenido del grafico. */
  children: ReactNode;
}

/**
 * Marco visual comun de los graficos: titulo, descripcion y estado vacio.
 *
 * Centraliza el estado "Sin datos suficientes": si no hay datos reales, nunca
 * se dibuja un grafico con cifras inventadas.
 */
export function ChartCard({
  title,
  description,
  action,
  isEmpty = false,
  emptyMessage = 'Sin datos suficientes para este gráfico.',
  children,
}: ChartCardProps) {
  return (
    <Card className="chart-card">
      <CardHeader title={title} description={description} action={action} />
      {isEmpty ? (
        <p className="chart-empty" role="status">
          {emptyMessage}
        </p>
      ) : (
        <div className="chart-body">{children}</div>
      )}
    </Card>
  );
}
