import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/auth-context';
import { formatDateTimeLocal } from '../../lib/dates';
import { describeApiError } from '../../lib/http';
import {
  HEALTH_EVENT_TYPE_LABELS,
  getHealthEvent,
  type HealthEvent,
} from '../../services/health-events.service';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';

export interface HealthEventDetailModalProps {
  eventId: string;
  /** Resuelve el código PigTec del porcino desde el catálogo. */
  animalCodeOf: (animalId: string) => string | null;
  onClose: () => void;
}

type LoadState = 'loading' | 'ready' | 'error';

/** Texto legible de un valor de `details` (que es un objeto JSON libre). */
function detailValueText(value: unknown): string {
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Vista de detalle de un evento sanitario. Consulta `GET /health-events/:id`
 * (solo lectura).
 *
 * No permite editar ni eliminar: el historial sanitario es inmutable (el backend
 * no expone endpoints y la base 007 no concede privilegio de UPDATE/DELETE).
 */
export function HealthEventDetailModal({
  eventId,
  animalCodeOf,
  onClose,
}: HealthEventDetailModalProps) {
  const { apiClient } = useAuth();
  const [state, setState] = useState<LoadState>('loading');
  const [event, setEvent] = useState<HealthEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState('loading');
      try {
        const detail = await getHealthEvent(
          apiClient,
          eventId,
          signal ? { signal } : undefined,
        );
        if (signal?.aborted) {
          return;
        }
        setEvent(detail);
        setError(null);
        setState('ready');
      } catch (caught) {
        if (signal?.aborted) {
          return;
        }
        setError(describeApiError(caught));
        setState('error');
      }
    },
    [apiClient, eventId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const detailEntries = event ? Object.entries(event.details) : [];

  return (
    <Modal
      title="Detalle del evento sanitario"
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
      }
    >
      {state === 'loading' ? (
        <div className="dashboard-loading" role="status" aria-live="polite">
          <Spinner size={20} />
          <span>Cargando evento…</span>
        </div>
      ) : null}

      {state === 'error' ? (
        <Alert
          variant="danger"
          title="No se pudo cargar el evento"
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Reintentar
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}

      {state === 'ready' && event ? (
        <>
          <div className="detail-head">
            <span className="code-chip">
              {HEALTH_EVENT_TYPE_LABELS[event.event_type]}
            </span>
          </div>

          <dl className="detail-grid">
            <div>
              <dt>Porcino</dt>
              <dd>{animalCodeOf(event.animal_id) ?? 'Código no disponible'}</dd>
            </div>
            <div>
              <dt>Fecha y hora</dt>
              <dd>{formatDateTimeLocal(event.occurred_at)}</dd>
            </div>
            <div>
              <dt>Título</dt>
              <dd>{event.title}</dd>
            </div>
            <div>
              <dt>Descripción</dt>
              <dd>{event.description ?? '—'}</dd>
            </div>
            <div>
              <dt>Documentado por</dt>
              <dd>{event.documented_by ?? '—'}</dd>
            </div>
            <div>
              <dt>Registrado</dt>
              <dd>{formatDateTimeLocal(event.created_at)}</dd>
            </div>
            {event.attachment_url ? (
              <div>
                <dt>Referencia o adjunto</dt>
                <dd>
                  <a
                    href={event.attachment_url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {event.attachment_url}
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>

          {detailEntries.length > 0 ? (
            <section className="section">
              <h3 className="section__title">Datos adicionales</h3>
              <dl className="detail-grid">
                {detailEntries.map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{detailValueText(value)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          <p className="field__hint">
            El historial sanitario es permanente: no se puede editar ni eliminar.
          </p>
        </>
      ) : null}
    </Modal>
  );
}
