import { Icon } from '../icons';
import type { IconName } from '../../config/navigation';
import { Alert } from './Alert';
import { PageHeader } from './PageHeader';

export interface ModulePlaceholderProps {
  title: string;
  description: string;
  /** Fase del plan en la que se implementara la seccion. */
  phase: string;
  /** Funcionalidades previstas (informativo, no son datos reales). */
  planned: readonly string[];
  /** Aclaracion adicional opcional. */
  note?: string;
  icon?: IconName;
}

/**
 * Pantalla informativa para secciones aun no implementadas.
 *
 * Muestra que la seccion esta pendiente y que es lo que incluira. NO muestra
 * formularios ni datos ficticios que puedan confundirse con registros reales.
 */
export function ModulePlaceholder({
  title,
  description,
  phase,
  planned,
  note,
  icon = 'info',
}: ModulePlaceholderProps) {
  return (
    <div className="page">
      <PageHeader title={title} description={description} />

      <Alert variant="warning" title="Sección en desarrollo">
        Esta sección todavía no está implementada. Se habilitará en{' '}
        <strong>{phase}</strong>. No se muestran datos ficticios: cuando exista
        información real, se mostrará aquí con sus filtros y permisos.
      </Alert>

      <div className="card placeholder">
        <div className="placeholder__head">
          <span className="placeholder__icon" aria-hidden="true">
            <Icon name={icon} size={22} />
          </span>
          <div>
            <h2 className="card__title">Alcance previsto</h2>
            <p className="card__subtitle">
              Lo que incluirá esta sección al implementarse.
            </p>
          </div>
        </div>

        <ul className="placeholder__list">
          {planned.map((item) => (
            <li key={item} className="placeholder__item">
              <span className="placeholder__bullet" aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>

        {note ? <p className="placeholder__note">{note}</p> : null}
      </div>
    </div>
  );
}
