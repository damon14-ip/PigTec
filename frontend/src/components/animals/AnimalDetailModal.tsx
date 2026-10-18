import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/auth-context';
import { describeApiError } from '../../lib/http';
import {
  ADMINISTRATIVE_ANIMAL_STATUSES,
  ANIMAL_ORIGIN_LABELS,
  ANIMAL_SEX_LABELS,
  getAnimal,
  getAnimalLocation,
  type Animal,
  type AnimalLocation,
} from '../../services/animals.service';
import type { Area } from '../../services/areas.service';
import type { Pen } from '../../services/pens.service';
import { AnimalHealthEventsModal } from '../health/AnimalHealthEventsModal';
import { AnimalMovementsModal } from '../movements/AnimalMovementsModal';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { AnimalStatusBadge } from './AnimalStatusBadge';

export interface AnimalDetailModalProps {
  animalId: string;
  canWrite: boolean;
  /** Corrales del catálogo (para etiquetar la trazabilidad). */
  pens: readonly Pen[];
  /** Áreas del catálogo (para etiquetar los corrales del historial). */
  areas: readonly Area[];
  onClose: () => void;
  onEdit: (animal: Animal) => void;
  onRequestStatusChange: (animal: Animal) => void;
}

type LoadState = 'loading' | 'ready' | 'error';

/** Fecha `YYYY-MM-DD` o marca de tiempo: se muestra solo la parte de fecha. */
function formatDate(value: string | null): string {
  if (!value) {
    return '—';
  }
  return value.slice(0, 10);
}

/**
 * Vista de detalle de un porcino. Consulta `GET /animals/:id` y
 * `GET /animals/:id/location` (ambas de solo lectura) y ofrece editar o cambiar
 * el estado administrativo si el rol lo permite.
 */
export function AnimalDetailModal({
  animalId,
  canWrite,
  pens,
  areas,
  onClose,
  onEdit,
  onRequestStatusChange,
}: AnimalDetailModalProps) {
  const { apiClient } = useAuth();
  const [state, setState] = useState<LoadState>('loading');
  const [animal, setAnimal] = useState<Animal | null>(null);
  const [location, setLocation] = useState<AnimalLocation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showMovements, setShowMovements] = useState(false);
  const [showHealth, setShowHealth] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState('loading');
      try {
        const [detail, place] = await Promise.all([
          getAnimal(apiClient, animalId, signal ? { signal } : undefined),
          getAnimalLocation(apiClient, animalId, signal ? { signal } : undefined),
        ]);
        if (signal?.aborted) {
          return;
        }
        setAnimal(detail);
        setLocation(place);
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
    [apiClient, animalId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const isAdministrative = animal
    ? (ADMINISTRATIVE_ANIMAL_STATUSES as readonly string[]).includes(
        animal.status,
      )
    : false;

  return (
    <>
      <Modal
        title="Detalle del porcino"
        onClose={onClose}
        dismissable={!showMovements && !showHealth}
      >
      {state === 'loading' ? (
        <div className="dashboard-loading" role="status" aria-live="polite">
          <Spinner size={20} />
          <span>Cargando porcino…</span>
        </div>
      ) : null}

      {state === 'error' ? (
        <Alert
          variant="danger"
          title="No se pudo cargar el porcino"
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Reintentar
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}

      {state === 'ready' && animal ? (
        <>
          <div className="detail-head">
            <span className="code-chip">{animal.animal_code}</span>
            <AnimalStatusBadge status={animal.status} />
          </div>

          <dl className="detail-grid">
            <div>
              <dt>Arete</dt>
              <dd>{animal.ear_tag_code ?? '—'}</dd>
            </div>
            <div>
              <dt>Sexo</dt>
              <dd>{ANIMAL_SEX_LABELS[animal.sex]}</dd>
            </div>
            <div>
              <dt>Raza</dt>
              <dd>{animal.breed ?? '—'}</dd>
            </div>
            <div>
              <dt>Fecha de nacimiento</dt>
              <dd>{formatDate(animal.birth_date)}</dd>
            </div>
            <div>
              <dt>Origen</dt>
              <dd>
                {animal.origin ? ANIMAL_ORIGIN_LABELS[animal.origin] : 'No registrado'}
              </dd>
            </div>
            <div>
              <dt>Ubicación actual</dt>
              <dd>
                {location?.pen
                  ? `${location.pen.area ? `${location.pen.area.name} · ` : ''}${location.pen.code}`
                  : 'Sin corral asignado'}
              </dd>
            </div>
            <div>
              <dt>Fecha de ingreso</dt>
              <dd>{formatDate(animal.entry_date)}</dd>
            </div>
            <div>
              <dt>Fecha de salida</dt>
              <dd>{formatDate(animal.exit_date)}</dd>
            </div>
            <div>
              <dt>Notas</dt>
              <dd>{animal.notes ?? '—'}</dd>
            </div>
            <div>
              <dt>Actualizado</dt>
              <dd>{formatDate(animal.updated_at)}</dd>
            </div>
          </dl>

          <p className="field__hint">
            La ubicación se modifica con un movimiento (módulo Movimientos). El
            parentesco y las camadas se gestionan en el módulo Camadas.
          </p>

          <div className="modal__actions">
            <Button
              variant="secondary"
              onClick={() => setShowMovements(true)}
            >
              Ver movimientos
            </Button>
            <Button variant="secondary" onClick={() => setShowHealth(true)}>
              Ver sanidad
            </Button>
          </div>

          {canWrite ? (
            isAdministrative ? (
              <div className="modal__actions">
                <Button
                  variant="secondary"
                  onClick={() => onEdit(animal)}
                >
                  Editar
                </Button>
                <Button
                  variant="danger"
                  onClick={() => onRequestStatusChange(animal)}
                >
                  Cambiar estado
                </Button>
              </div>
            ) : (
              <>
                <Alert variant="info" title="Estado derivado">
                  El estado actual ({animal.status}) proviene de un movimiento o
                  de un evento sanitario y no se cambia desde aquí.
                </Alert>
                <div className="modal__actions">
                  <Button variant="secondary" onClick={() => onEdit(animal)}>
                    Editar
                  </Button>
                </div>
              </>
            )
          ) : null}
        </>
      ) : null}
      </Modal>

      {showMovements && animal ? (
        <AnimalMovementsModal
          animal={animal}
          pens={pens}
          areas={areas}
          onClose={() => setShowMovements(false)}
        />
      ) : null}

      {showHealth && animal ? (
        <AnimalHealthEventsModal
          animal={animal}
          onClose={() => setShowHealth(false)}
        />
      ) : null}
    </>
  );
}
