import { useState } from 'react';
import { Icon } from '../icons';
import { AssistantPanel } from './AssistantPanel';

/**
 * Boton flotante del asistente, disponible en todas las pantallas privadas.
 *
 * Solo abre y cierra el panel: la conversacion empieza cuando el usuario envia
 * un mensaje. No se realiza ninguna peticion al abrir el chat.
 */
export function AssistantWidget() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={`assistant-fab${open ? ' is-hidden' : ''}`}
        onClick={() => setOpen(true)}
        aria-label="Abrir asistente PigTec"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="assistant-title"
      >
        <Icon name="chat" size={24} />
        <span className="assistant-fab__label">Asistente</span>
      </button>

      <AssistantPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}
