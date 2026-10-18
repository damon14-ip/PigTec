import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/auth-context';
import { formatCalendarDate } from '../../lib/dates';
import { describeApiError } from '../../lib/http';
import { ANIMAL_SEX_LABELS } from '../../services/animals.service';
import {
  getLitter,
  listLitterOffspring,
  type Litter,
  type LitterOffspring,
} from '../../services/litters.service';
import { AnimalStatusBadge } from '../animals/AnimalStatusBadge';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';

export interface LitterDetailModalProps {
  litterId: string;
  /** Resuelve el código PigTec de la madre/padre desde el catálogo. */
  animalCodeOf: (animalId: string) => string | null;
  canWrite: boolean;
  onEdit: (litter: Litter) => void;
  onClose: () => void;
}

type LoadState = 'loading' | 'ready' | 'error';

function codeText(
  animalId: string | null,
  animalCodeOf: (id: string) => string | null,
): string {
  if (!animalId) {
    return '—';
  }
  return animalCodeOf(animalId) ?? 'Código no disponible';
}

function countText(value: number | null): string {
  return value === null ? '—' : String(value);
}

/**
 * Vista de detalle de una camada. Consulta `GET /litters/:id` y
 * `GET /litters/:id/offspring` (ambas de solo lectura) y ofrece editar si el rol
 * lo permite.
 *
 * No permite eliminar: la camada es historial (decisión D-09).
 */
export function LitterDetailModal({
  litterId,
  animalCodeOf,
  canWrite,
  onEdit,
  onClose,
}: LitterDetailModalProps) {
  const { apiClient } = useAuth();
  const [state, setState] = useState<LoadState>('loading');
  const [litter, setLitter] = useState<Litter | null>(null);
  const [offspring, setOffspring] = useState<LitterOffspring[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState('loading');
      try {
        const [detail, children] = await Promise.all([
          getLitter(apiClient, litterId, signal ? { signal } : undefined),
          listLitterOffspring(apiClient, litterId, signal ? { signal } : undefined),
        ]);
        if (signal?.aborted) {
          return;
        }
        setLitter(detail);
        setOffspring(children);
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
    [apiClient, litterId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <Modal
      title="Detalle de la camada"
      onClose={onClose}
      footer={
        canWrite && litter ? (
          <Button variant="secondary" onClick={() => onEdit(litter)}>
            Editar
          </Button>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
        )
      }
    >
      {state === 'loading' ? (
        <div className="dashboard-loading" role="status" aria-live="polite">
          <Spinner size={20} />
          <span>Cargando camada…</span>
        </div>
      ) : null}

      {state === 'error' ? (
        <Alert
          variant="danger"
          title="No se pudo cargar la camada"
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Reintentar
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}

      {state === 'ready' && litter ? (
        <>
          <div className="detail-head">
            <span className="code-chip">
              {litter.litter_code ?? 'Sin código'}
            </span>
          </div>

          <dl className="detail-grid">
            <div>
              <dt>Madre</dt>
              <dd>{codeText(litter.mother_id, animalCodeOf)}</dd>
            </div>
            <div>
              <dt>Padre</dt>
              <dd>{codeText(litter.father_id, animalCodeOf)}</dd>
            </div>
            <div>
              <dt>Fecha del parto</dt>
              <dd>{formatCalendarDate(litter.birth_date)}</dd>
            </div>
            <div>
              <dt>Total nacidos</dt>
              <dd>{countText(litter.total_born)}</dd>
            </div>
            <div>
              <dt>Nacidos vivos</dt>
              <dd>{countText(litter.born_alive)}</dd>
            </div>
            <div>
              <dt>Nacidos muertos</dt>
              <dd>{countText(litter.stillborn)}</dd>
            </div>
            <div>
              <dt>Observaciones</dt>
              <dd>{litter.notes ?? '—'}</dd>
            </div>
            <div>
              <dt>Registrada</dt>
              <dd>{formatCalendarDate(litter.created_at.slice(0, 10))}</dd>
            </div>
          </dl>

          <section className="section">
            <h3 className="section__title">Descendencia</h3>
            {offspring.length === 0 ? (
              <p className="table-empty">
                Esta camada todavía no tiene crías asociadas. La asociación se
                realiza desde el módulo de porcinos.
              </p>
            ) : (
              <div className="table-wrapper">
                <table className="data-table">
                  <caption className="visually-hidden">
                    Crías asociadas a la camada
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Código PigTec</th>
                      <th scope="col">Arete</th>
                      <th scope="col">Sexo</th>
                      <th scope="col">Nacimiento</th>
                      <th scope="col">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {offspring.map((child) => (
                      <tr key={child.id}>
                        <td>
                          <span className="code-chip">{child.animal_code}</span>
                        </td>
                        <td>{child.ear_tag_code ?? '—'}</td>
                        <td>{ANIMAL_SEX_LABELS[child.sex]}</td>
                        <td>{formatCalendarDate(child.birth_date)}</td>
                        <td>
                          <AnimalStatusBadge status={child.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="field__hint">
              Las crías listadas son porcinos cuyo registro apunta a esta camada.
              El historial de camadas no se elimina.
            </p>
          </section>
        </>
      ) : null}
    </Modal>
  );
}
