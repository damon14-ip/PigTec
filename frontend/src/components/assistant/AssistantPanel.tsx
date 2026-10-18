import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useAuth } from '../../context/auth-context';
import { describeApiError } from '../../lib/http';
import {
  sendAssistantMessage,
  type AssistantChatResponse,
  type AssistantSource,
} from '../../services/assistant.service';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Icon } from '../icons';
import { AssistantMarkdown } from './AssistantMarkdown';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  source?: AssistantSource;
}

const SOURCE_LABELS: Record<AssistantSource, string> = {
  local: 'Respuesta local',
  data: 'Datos del sistema',
  groq: 'IA (Groq)',
};

const SUGGESTIONS = [
  '¿Qué módulos tiene PigTec?',
  '¿Cómo se identifica a un animal?',
  'Resumen general de la granja',
];

export interface AssistantPanelProps {
  open: boolean;
  onClose: () => void;
  /**
   * Funcion de envio. Por defecto usa `POST /assistant/chat` con el JWT de la
   * sesion. Se puede inyectar en pruebas para no depender de la red.
   */
  sendMessage?: (
    message: string,
    options?: { signal?: AbortSignal },
  ) => Promise<AssistantChatResponse>;
}

/**
 * Panel de conversacion del asistente.
 *
 * Reglas clave:
 * - NO envia ningun mensaje al abrirse: solo lo hace cuando el usuario pulsa
 *   "Enviar" o presiona Enter.
 * - El asistente es de SOLO LECTURA: la interfaz unicamente llama a
 *   `POST /assistant/chat`; no existe ninguna accion que escriba en la base.
 * - Muestra el origen de cada respuesta (`local`, `data` o `groq`) y la cuota
 *   diaria restante cuando el backend la informa.
 */
export function AssistantPanel({
  open,
  onClose,
  sendMessage,
}: AssistantPanelProps) {
  const { apiClient, accessToken } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const nextId = () => {
    counterRef.current += 1;
    return `m${counterRef.current}`;
  };

  const send =
    sendMessage ??
    ((message: string, options?: { signal?: AbortSignal }) =>
      sendAssistantMessage(apiClient, message, options));

  // Gestion de foco y tecla Escape mientras el panel esta abierto.
  useEffect(() => {
    if (!open) {
      return;
    }
    const previouslyFocused = document.activeElement;
    inputRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      abortRef.current?.abort();
      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus();
      }
    };
  }, [open, onClose]);

  // Desplaza la conversacion al ultimo mensaje.
  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages, sending, error]);

  if (!open) {
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || sending) {
      return;
    }

    if (!accessToken && !sendMessage) {
      setError('La sesión no está activa. Vuelve a iniciar sesión.');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setMessages((prev) => [...prev, { id: nextId(), role: 'user', text }]);
    setInput('');
    setError(null);
    setSending(true);

    try {
      const response = await send(text, { signal: controller.signal });
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          text: response.reply,
          source: response.source,
        },
      ]);
      setQuotaRemaining(response.quotaRemaining);
    } catch (caught) {
      if (controller.signal.aborted) {
        return;
      }
      setError(describeApiError(caught));
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }

  function handlePanelKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab' || !panelRef.current) {
      return;
    }
    const focusables = panelRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href]',
    );
    if (focusables.length === 0) {
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="assistant">
      <div
        className="assistant__backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="assistant__panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="assistant-title"
        onKeyDown={handlePanelKeyDown}
      >
        <header className="assistant__header">
          <div className="assistant__heading">
            <span className="assistant__avatar" aria-hidden="true">
              <Icon name="chat" size={20} />
            </span>
            <div>
              <h2 id="assistant-title" className="assistant__title">
                Asistente PigTec
              </h2>
              <p className="assistant__subtitle">
                Consulta información existente (solo lectura)
              </p>
            </div>
          </div>
          <button
            type="button"
            className="assistant__close"
            onClick={onClose}
            aria-label="Cerrar asistente"
          >
            <Icon name="close" size={20} />
          </button>
        </header>

        <div
          className="assistant__messages"
          ref={listRef}
          role="log"
          aria-live="polite"
          aria-label="Conversación"
        >
          {messages.length === 0 && !error ? (
            <div className="assistant__empty">
              <p>
                Puedo responder con la información propia de PigTec, consultar
                datos de solo lectura del sistema o consultar a la IA.
              </p>
              <p className="assistant__empty-note">
                No escribo ni modifico registros de la base de datos.
              </p>
              <div className="assistant__suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="assistant__suggestion"
                    onClick={() => {
                      setInput(suggestion);
                      inputRef.current?.focus();
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`chat-bubble chat-bubble--${message.role}`}
            >
              {message.source ? (
                <span className={`chat-source chat-source--${message.source}`}>
                  {SOURCE_LABELS[message.source]}
                </span>
              ) : null}
              {message.role === 'assistant' ? (
                <AssistantMarkdown
                  className="chat-bubble__text"
                  text={message.text}
                />
              ) : (
                <p className="chat-bubble__text">{message.text}</p>
              )}
            </div>
          ))}

          {sending ? (
            <div className="chat-bubble chat-bubble--assistant chat-bubble--pending">
              <span className="typing" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span className="visually-hidden">Consultando…</span>
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="assistant__error">
            <Alert variant="danger">{error}</Alert>
          </div>
        ) : null}

        <form className="assistant__form" onSubmit={handleSubmit}>
          <label className="visually-hidden" htmlFor="assistant-input">
            Escribe tu consulta
          </label>
          <input
            id="assistant-input"
            ref={inputRef}
            className="assistant__input"
            type="text"
            value={input}
            maxLength={2000}
            autoComplete="off"
            placeholder="Escribe tu consulta…"
            onChange={(event) => setInput(event.target.value)}
            disabled={sending}
          />
          <Button
            type="submit"
            variant="primary"
            loading={sending}
            disabled={sending || input.trim() === ''}
            aria-label="Enviar consulta"
          >
            Enviar
          </Button>
        </form>

        <footer className="assistant__footer">
          <span>
            {quotaRemaining === null
              ? 'Consultas de IA sujetas a la cuota diaria.'
              : `Consultas de IA restantes hoy: ${quotaRemaining}`}
          </span>
        </footer>
      </div>
    </div>
  );
}
