import type { ReactNode } from 'react';
import { Icon } from '../icons';

export type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

const VARIANT_ICON = {
  info: 'info',
  success: 'info',
  warning: 'alert',
  danger: 'alert',
} as const;

const VARIANT_ROLE: Record<AlertVariant, 'status' | 'alert'> = {
  info: 'status',
  success: 'status',
  warning: 'status',
  danger: 'alert',
};

export interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  children: ReactNode;
  /** Accion opcional a la derecha del mensaje (p. ej. boton de reintento). */
  action?: ReactNode;
}

/** Mensaje de aviso, error o informacion con estilo consistente. */
export function Alert({
  variant = 'info',
  title,
  children,
  action,
}: AlertProps) {
  return (
    <div
      className={`alert alert--${variant}`}
      role={VARIANT_ROLE[variant]}
      aria-live={variant === 'danger' ? 'assertive' : 'polite'}
    >
      <Icon name={VARIANT_ICON[variant]} size={18} className="alert__icon" />
      <div className="alert__content">
        {title ? <p className="alert__title">{title}</p> : null}
        <div className="alert__body">{children}</div>
      </div>
      {action ? <div className="alert__action">{action}</div> : null}
    </div>
  );
}
