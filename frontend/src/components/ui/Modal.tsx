import { useEffect, type ReactNode } from 'react';
import { Icon } from '../icons';

export interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Acciones fijas al pie del panel (p. ej. Guardar / Cancelar). */
  footer?: ReactNode;
  /**
   * Si es `false`, la ventana no se cierra con Escape ni con el fondo (se usa
   * mientras hay una operacion en curso para no perder el envio).
   */
  dismissable?: boolean;
}

/**
 * Ventana modal accesible y responsive. Se usa para los formularios de alta y
 * edicion. No contiene logica de negocio: es solo presentacion.
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
  dismissable = true,
}: ModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissable) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, dismissable]);

  return (
    <div className="modal">
      <div
        className="modal__backdrop"
        onClick={dismissable ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        className="modal__panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal__header">
          <h2 className="modal__title">{title}</h2>
          <button
            type="button"
            className="modal__close"
            onClick={onClose}
            disabled={!dismissable}
            aria-label="Cerrar"
          >
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
