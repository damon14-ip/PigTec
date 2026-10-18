import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/auth-context';
import { describeApiError } from '../../lib/http';
import type { Animal } from '../../services/animals.service';
import type { Area } from '../../services/areas.service';
import type { Pen } from '../../services/pens.service';
import {
  listAnimalMovements,
  type Movement,
} from '../../services/movements.service';
import { AnimalStatusBadge } from '../animals/AnimalStatusBadge';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { MovementsTable } from './MovementsTable';
import { buildPenLabelMap } from './labels';

/**
 * Tope de filas del historial de un porcino. El backend devuelve una página
 * (`limit` máx. 500, 100 por defecto) y no informa del total; se avisa cuando se
 * alcanza el tope en lugar de simular que el historial está completo.
 */
const HISTORY_LIMIT = 100;

export interface AnimalMovementsModalProps {
  animal: Animal;
  pens: readonly Pen[];
  areas: readonly Area[];
  onClose: () => void;
}

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Trazabilidad de un porcino: consulta `GET /animals/:id/movements` (solo
 * lectura) y muestra el historial del más antiguo al más reciente.
 *
 * No permite editar ni eliminar: el historial es inmutable y el backend no
 * expone endpoints para ello.
 */
export function AnimalMovementsModal({
  animal,
  pens,
  areas,
  onClose,
}: AnimalMovementsModalProps) {
  const { apiClient } = useAuth();
  const [state, setState] = useState<LoadState>('loading');
  const [movements, setMovements] = useState<Movement[]>([]);
  const [error, setError] = useState<string | null>(null);

  const penLabels = useMemo(() => buildPenLabelMap(pens, areas), [pens, areas]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState('loading');
      try {
        const result = await listAnimalMovements(
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
        setMovements(
          [...result].sort((a, b) => a.moved_at.localeCompare(b.moved_at)),
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

  /** Código del porcino consultado (la tabla no repite la columna "Porcino"). */
  const animalCodeOf = useCallback(() => animal.animal_code, [animal.animal_code]);

  return (
    <Modal
      title="Movimientos del porcino"
      onClose={onClose}
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
          <span>Cargando movimientos…</span>
        </div>
      ) : null}

      {state === 'error' ? (
        <Alert
          variant="danger"
          title="No se pudieron cargar los movimientos"
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
          <MovementsTable
            movements={movements}
            animalCodeOf={animalCodeOf}
            penLabelOf={(penId) => penLabels.get(penId) ?? null}
            showAnimal={false}
            caption={`Movimientos del porcino ${animal.animal_code}`}
            emptyMessage="Este porcino todavía no tiene movimientos registrados."
          />
          {movements.length > 0 ? (
            <p className="field__hint">
              Orden cronológico: del movimiento más antiguo al más reciente. El
              historial es permanente y no se puede editar.
              {movements.length >= HISTORY_LIMIT
                ? ` Se muestran los ${HISTORY_LIMIT} movimientos más recientes.`
                : null}
            </p>
          ) : null}
        </>
      ) : null}
    </Modal>
  );
}
