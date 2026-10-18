import { Icon } from '../icons';
import { Spinner } from './Spinner';
import type { IconName } from '../../config/navigation';

export interface StatCardProps {
  label: string;
  icon?: IconName;
  /**
   * Valor real del indicador, ya formateado. `null` significa que la metrica NO
   * es calculable con los datos disponibles: se muestra como "Sin datos
   * suficientes" y NUNCA se sustituye por una cifra inventada. Un valor `"0"`
   * solo aparece cuando la consulta confirmo que el conteo es cero.
   */
  value: string | null;
  /** Texto de apoyo o de contexto. */
  hint?: string;
  /** Etiqueta del estado no calculable (por defecto "Sin datos suficientes"). */
  emptyLabel?: string;
  /** Muestra el estado de actualizacion en lugar del valor. */
  loading?: boolean;
}

/** Tarjeta de indicador del dashboard. */
export function StatCard({
  label,
  icon,
  value,
  hint,
  emptyLabel = 'Sin datos suficientes',
  loading = false,
}: StatCardProps) {
  const isUnavailable = value === null;

  return (
    <article className="stat" aria-label={label}>
      <div className="stat__top">
        {icon ? (
          <span className="stat__icon" aria-hidden="true">
            <Icon name={icon} size={20} />
          </span>
        ) : null}
        <p className="stat__label">{label}</p>
      </div>

      {loading ? (
        <p className="stat__value stat__value--pending">
          <span className="badge badge--muted">
            <Spinner size={12} /> Actualizando…
          </span>
        </p>
      ) : isUnavailable ? (
        <p className="stat__value stat__value--pending">
          <span className="badge badge--muted">{emptyLabel}</span>
        </p>
      ) : (
        <p className="stat__value">{value}</p>
      )}

      {hint ? <p className="stat__hint">{hint}</p> : null}
    </article>
  );
}
