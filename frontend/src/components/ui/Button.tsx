import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  /** Muestra un indicador y desactiva el boton mientras se procesa. */
  loading?: boolean;
  /** Icono opcional a la izquierda del texto. */
  icon?: ReactNode;
  fullWidth?: boolean;
  children: ReactNode;
}

/** Boton reutilizable con variantes consistentes. */
export function Button({
  variant = 'primary',
  loading = false,
  icon,
  fullWidth = false,
  disabled,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = ['btn', `btn--${variant}`];
  if (fullWidth) {
    classes.push('btn--block');
  }

  return (
    <button
      {...rest}
      type={type}
      className={classes.join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <Spinner size={16} /> : icon}
      <span>{children}</span>
    </button>
  );
}
