import type { ReactNode } from 'react';

export interface CardProps {
  children: ReactNode;
  className?: string;
  /** Etiqueta accesible cuando la tarjeta es una region relevante. */
  as?: 'section' | 'article' | 'div';
}

/** Contenedor visual base (superficie con borde y sombra suave). */
export function Card({ children, className, as: Tag = 'section' }: CardProps) {
  return (
    <Tag className={className ? `card ${className}` : 'card'}>{children}</Tag>
  );
}

export interface CardHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

/** Cabecera de tarjeta con titulo, descripcion y accion opcional. */
export function CardHeader({ title, description, action }: CardHeaderProps) {
  return (
    <header className="card__header">
      <div>
        <h2 className="card__title">{title}</h2>
        {description ? <p className="card__subtitle">{description}</p> : null}
      </div>
      {action ? <div className="card__action">{action}</div> : null}
    </header>
  );
}
