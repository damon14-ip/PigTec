import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/auth-context';
import { describeApiError } from '../../lib/http';
import type { Animal } from '../../services/animals.service';
import {
  listAnimalHealthEvents,
  type HealthEvent,
} from '../../services/health-events.service';
import { AnimalStatusBadge } from '../animals/AnimalStatusBadge';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { HealthEventDetailModal } from './HealthEventDetailModal';
import { HealthEventsTable } from './HealthEventsTable';

/**
 * Tope de filas del historial de un porcino. El backend devuelve una página
 * (`limit` máx. 500, 100 por defecto) y no informa del total; se avisa cuando se
 * alcanza el tope en lugar de simular que el historial está completo.
 */
const HISTORY_LIMIT = 100;

export interface AnimalHealthEventsModalProps {
  animal: Animal;
  onClose: () => void;
}

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Historial sanitario de un porcino: consulta
 * `GET /animals/:id/health-events` (solo lectura) y muestra los eventos del más
 * antiguo al más reciente.
 *
 * No permite editar ni eliminar: el historial es inmutable.
 */
export function AnimalHealthEventsModal({
  animal,
  onClose,
}: AnimalHealthEventsModalProps) {
  const { apiClient } = useAuth();
  const [state, setState] = useState<LoadState>('loading');
  const [events, setEvents] = useState<HealthEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState('loading');
      try {
        const result = await listAnimalHealthEvents(
          apiClient,
          animal.id,
          { limit: HISTORY_LIMIT },
          signal ? { signal } : undefined,
        );
        if (signal?.aborted) {
          return;
        }
        // El backend ordena por fecha descendente; aquí se muestra como línea de
        // tiempo cronológica (del más antiguo al más reciente).
        setEvents(
          [...result].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)),
        );
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
    [apiClient, animal.id],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <>
      <Modal
        title="Historial sanitario del porcino"
        onClose={onClose}
        dismissable={!detailId}
        footer={
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
        }
      >
        <div className="detail-head">
          <span className="code-chip">{animal.animal_code}</span>
          <AnimalStatusBadge status={animal.status} />
        </div>

        {state === 'loading' ? (
          <div className="dashboard-loading" role="status" aria-live="polite">
            <Spinner size={20} />
            <span>Cargando historial…</span>
          </div>
        ) : null}

        {state === 'error' ? (
          <Alert
            variant="danger"
            title="No se pudo cargar el historial sanitario"
            action={
              <Button variant="secondary" onClick={() => void load()}>
                Reintentar
              </Button>
            }
          >
            {error}
          </Alert>
        ) : null}

        {state === 'ready' ? (
          <>
            <HealthEventsTable
              events={events}
              animalCodeOf={() => animal.animal_code}
              showAnimal={false}
              onView={(event) => setDetailId(event.id)}
              caption={`Historial sanitario del porcino ${animal.animal_code}`}
              emptyMessage="Este porcino todavía no tiene eventos sanitarios registrados."
            />
            {events.length > 0 ? (
              <p className="field__hint">
                Orden cronológico: del evento más antiguo al más reciente. El
                historial es permanente y no se puede editar.
                {events.length >= HISTORY_LIMIT
                  ? ` Se muestran los ${HISTORY_LIMIT} eventos más recientes.`
                  : null}
              </p>
            ) : null}
          </>
        ) : null}
      </Modal>

      {detailId ? (
        <HealthEventDetailModal
          eventId={detailId}
          animalCodeOf={() => animal.animal_code}
          onClose={() => setDetailId(null)}
        />
      ) : null}
    </>
  );
}
