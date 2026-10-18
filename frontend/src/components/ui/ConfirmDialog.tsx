import type { ReactNode } from 'react';
import { Button, type ButtonVariant } from './Button';
import { Modal } from './Modal';

export interface ConfirmDialogProps {
  title: string;
  /** Contenido de la confirmación (texto o resumen estructurado). */
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Variante visual del botón de confirmación (por defecto `danger`). */
  confirmVariant?: ButtonVariant;
  /** Muestra el estado de envío y bloquea el cierre mientras se procesa. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmación previa a una acción importante (p. ej. una baja lógica o el
 * registro de un movimiento, que crea historial inmutable). No ejecuta nada por
 * sí misma: delega en `onConfirm`.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  confirmVariant = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      dismissable={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="modal__message">{message}</div>
    </Modal>
  );
}
