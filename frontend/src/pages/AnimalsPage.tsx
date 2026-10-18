import { useCallback, useEffect, useMemo, useState } from 'react';
import { canManageAnimals } from '../config/roles';
import { useAuth } from '../context/auth-context';
import { describeApiError } from '../lib/http';
import { listAreas, type Area } from '../services/areas.service';
import { listPens, type Pen } from '../services/pens.service';
import {
  ANIMAL_ORIGINS,
  ANIMAL_ORIGIN_LABELS,
  ANIMAL_SEXES,
  ANIMAL_SEX_LABELS,
  ANIMAL_STATUSES,
  ANIMAL_STATUS_LABELS,
  createAnimal,
  listAnimals,
  updateAnimal,
  updateAnimalStatus,
  type AdministrativeAnimalStatus,
  type Animal,
  type AnimalOrigin,
  type AnimalSex,
  type AnimalStatus,
  type CreateAnimalInput,
  type UpdateAnimalInput,
} from '../services/animals.service';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/icons';
import { PageHeader } from '../components/ui/PageHeader';
import { Spinner } from '../components/ui/Spinner';
import { AnimalDetailModal } from '../components/animals/AnimalDetailModal';
import { AnimalFormModal } from '../components/animals/AnimalFormModal';
import { AnimalStatusDialog } from '../components/animals/AnimalStatusDialog';
import { AnimalStatusBadge } from '../components/animals/AnimalStatusBadge';

type LoadState = 'loading' | 'ready' | 'error';
type Notice = { variant: 'success' | 'danger'; message: string };
type AnimalFormState = { mode: 'create' } | { mode: 'edit'; animal: Animal };

/**
 * Sección "Porcinos".
 *
 * Consulta, registra y edita porcinos usando los endpoints REALES del backend
 * con el JWT de la sesión. Permisos (coinciden con el backend):
 * - lectura: cualquier rol operativo activo,
 * - escritura (alta, edición y cambio de estado administrativo): solo admin y
 *   manager.
 *
 * Honestidad y reglas respetadas:
 * - el código PigTec lo genera la base y nunca se edita,
 * - la ubicación se cambia con movimientos, no desde aquí,
 * - los estados `sold`/`dead`/`transferred_out` se derivan de operaciones con
 *   historial y no se fijan a mano,
 * - la capacidad del corral se AVISA pero no se impone: el backend no aplica esa
 *   regla (decisión pendiente) y este frontend no inventa reglas de negocio.
 */
export function AnimalsPage() {
  const { profile, apiClient } = useAuth();
  const canWrite = profile ? canManageAnimals(profile.role) : false;

  const [animals, setAnimals] = useState<Animal[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [pens, setPens] = useState<Pen[]>([]);
  const [listState, setListState] = useState<LoadState>('loading');
  const [listError, setListError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | AnimalStatus>('all');
  const [sexFilter, setSexFilter] = useState<'all' | AnimalSex>('all');
  const [originFilter, setOriginFilter] = useState<'all' | AnimalOrigin>('all');
  const [penFilter, setPenFilter] = useState<string>('all');

  const [notice, setNotice] = useState<Notice | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [formState, setFormState] = useState<AnimalFormState | null>(null);
  const [statusTarget, setStatusTarget] = useState<Animal | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setListState('loading');
      try {
        const [animalList, areaList, penList] = await Promise.all([
          listAnimals(apiClient, undefined, signal ? { signal } : undefined),
          listAreas(apiClient, undefined, signal ? { signal } : undefined),
          listPens(apiClient, undefined, signal ? { signal } : undefined),
        ]);
        if (signal?.aborted) {
          return;
        }
        setAnimals(animalList);
        setAreas(areaList);
        setPens(penList);
        setListError(null);
        setListState('ready');
      } catch (caught) {
        if (signal?.aborted) {
          return;
        }
        setListError(describeApiError(caught));
        setListState('error');
      }
    },
    [apiClient],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const penById = useMemo(() => {
    const map = new Map<string, Pen>();
    for (const pen of pens) {
      map.set(pen.id, pen);
    }
    return map;
  }, [pens]);

  /** Porcinos registrados por corral (para el aviso de capacidad del formulario). */
  const occupancy = useMemo(() => {
    const map = new Map<string, number>();
    for (const animal of animals) {
      if (animal.current_pen_id) {
        map.set(animal.current_pen_id, (map.get(animal.current_pen_id) ?? 0) + 1);
      }
    }
    return map;
  }, [animals]);

  const visibleAnimals = useMemo(() => {
    const text = query.trim().toLowerCase();
    return animals.filter((animal) => {
      if (statusFilter !== 'all' && animal.status !== statusFilter) {
        return false;
      }
      if (sexFilter !== 'all' && animal.sex !== sexFilter) {
        return false;
      }
      if (originFilter !== 'all' && animal.origin !== originFilter) {
        return false;
      }
      if (penFilter !== 'all' && animal.current_pen_id !== penFilter) {
        return false;
      }
      if (!text) {
        return true;
      }
      return (
        animal.animal_code.toLowerCase().includes(text) ||
        (animal.ear_tag_code ?? '').toLowerCase().includes(text)
      );
    });
  }, [animals, query, statusFilter, sexFilter, originFilter, penFilter]);

  const handleSubmit = useCallback(
    async (input: CreateAnimalInput | UpdateAnimalInput): Promise<void> => {
      if (!formState) {
        return;
      }
      try {
        if (formState.mode === 'create') {
          const created = await createAnimal(apiClient, input as CreateAnimalInput);
          setNotice({
            variant: 'success',
            message: `Porcino registrado con el código ${created.animal_code}.`,
          });
        } else {
          await updateAnimal(apiClient, formState.animal.id, input as UpdateAnimalInput);
          setNotice({
            variant: 'success',
            message: 'Porcino actualizado correctamente.',
          });
        }
        setFormState(null);
        await load();
      } catch (caught) {
        setNotice({ variant: 'danger', message: describeApiError(caught) });
      }
    },
    [apiClient, formState, load],
  );

  const handleStatusConfirm = useCallback(
    async (status: AdministrativeAnimalStatus) => {
      if (!statusTarget) {
        return;
      }
      setStatusBusy(true);
      try {
        await updateAnimalStatus(apiClient, statusTarget.id, status);
        setNotice({
          variant: 'success',
          message: 'Estado del porcino actualizado.',
        });
        setStatusTarget(null);
        setDetailId(null);
        await load();
      } catch (caught) {
        setNotice({ variant: 'danger', message: describeApiError(caught) });
      } finally {
        setStatusBusy(false);
      }
    },
    [apiClient, statusTarget, load],
  );

  return (
    <div className="page">
      <PageHeader
        title="Porcinos"
        description="Inventario y trazabilidad de animales de la granja."
        action={
          canWrite ? (
            <Button
              icon={<Icon name="pig" size={16} />}
              onClick={() => setFormState({ mode: 'create' })}
            >
              Nuevo porcino
            </Button>
          ) : null
        }
      />

      {notice ? (
        <Alert
          variant={notice.variant}
          title={notice.variant === 'success' ? 'Listo' : 'No se pudo completar'}
          action={
            <Button variant="ghost" onClick={() => setNotice(null)}>
              Cerrar
            </Button>
          }
        >
          {notice.message}
        </Alert>
      ) : null}

      {!canWrite ? (
        <Alert variant="info" title="Modo consulta">
          Tu rol permite consultar el inventario, pero no registrar ni editar
          porcinos. Esas acciones están reservadas a administradores y
          encargados.
        </Alert>
      ) : null}

      <section className="card">
        <div className="toolbar">
          <div className="field toolbar__search">
            <label className="visually-hidden" htmlFor="animal-search">
              Buscar porcino
            </label>
            <input
              id="animal-search"
              className="field__input"
              type="search"
              placeholder="Buscar por código o arete…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="field toolbar__field">
            <label className="visually-hidden" htmlFor="animal-status-filter">
              Filtrar por estado
            </label>
            <select
              id="animal-status-filter"
              className="field__input"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as 'all' | AnimalStatus)
              }
            >
              <option value="all">Todos los estados</option>
              {ANIMAL_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {ANIMAL_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="field toolbar__field">
            <label className="visually-hidden" htmlFor="animal-sex-filter">
              Filtrar por sexo
            </label>
            <select
              id="animal-sex-filter"
              className="field__input"
              value={sexFilter}
              onChange={(event) =>
                setSexFilter(event.target.value as 'all' | AnimalSex)
              }
            >
              <option value="all">Todos los sexos</option>
              {ANIMAL_SEXES.map((value) => (
                <option key={value} value={value}>
                  {ANIMAL_SEX_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="field toolbar__field">
            <label className="visually-hidden" htmlFor="animal-origin-filter">
              Filtrar por origen
            </label>
            <select
              id="animal-origin-filter"
              className="field__input"
              value={originFilter}
              onChange={(event) =>
                setOriginFilter(event.target.value as 'all' | AnimalOrigin)
              }
            >
              <option value="all">Todos los orígenes</option>
              {ANIMAL_ORIGINS.map((value) => (
                <option key={value} value={value}>
                  {ANIMAL_ORIGIN_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="field toolbar__field">
            <label className="visually-hidden" htmlFor="animal-pen-filter">
              Filtrar por corral
            </label>
            <select
              id="animal-pen-filter"
              className="field__input"
              value={penFilter}
              onChange={(event) => setPenFilter(event.target.value)}
            >
              <option value="all">Todos los corrales</option>
              {pens.map((pen) => (
                <option key={pen.id} value={pen.id}>
                  {pen.code}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="secondary"
            icon={<Icon name="refresh" size={16} />}
            loading={listState === 'loading'}
            onClick={() => void load()}
          >
            Actualizar
          </Button>
        </div>

        {listState === 'loading' ? (
          <div className="dashboard-loading" role="status" aria-live="polite">
            <Spinner size={20} />
            <span>Cargando porcinos…</span>
          </div>
        ) : null}

        {listState === 'error' ? (
          <Alert
            variant="danger"
            title="No se pudieron cargar los porcinos"
            action={
              <Button variant="secondary" onClick={() => void load()}>
                Reintentar
              </Button>
            }
          >
            {listError}
          </Alert>
        ) : null}

        {listState === 'ready' && visibleAnimals.length === 0 ? (
          <p className="table-empty">
            {animals.length === 0
              ? 'Todavía no hay porcinos registrados.'
              : 'No hay porcinos que coincidan con la búsqueda o los filtros.'}
          </p>
        ) : null}

        {listState === 'ready' && visibleAnimals.length > 0 ? (
          <div className="table-wrapper">
            <table className="data-table">
              <caption className="visually-hidden">Porcinos de la granja</caption>
              <thead>
                <tr>
                  <th scope="col">Código PigTec</th>
                  <th scope="col">Arete</th>
                  <th scope="col">Sexo</th>
                  <th scope="col">Raza</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Ubicación</th>
                  <th scope="col">Ingreso</th>
                  <th scope="col">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibleAnimals.map((animal) => {
                  const pen = animal.current_pen_id
                    ? penById.get(animal.current_pen_id)
                    : null;
                  return (
                    <tr key={animal.id}>
                      <td>
                        <span className="code-chip">{animal.animal_code}</span>
                      </td>
                      <td>{animal.ear_tag_code ?? '—'}</td>
                      <td>{ANIMAL_SEX_LABELS[animal.sex]}</td>
                      <td>{animal.breed ?? '—'}</td>
                      <td>
                        <AnimalStatusBadge status={animal.status} />
                      </td>
                      <td>
                        {animal.current_pen_id
                          ? pen
                            ? pen.code
                            : 'Corral no disponible'
                          : 'Sin corral'}
                      </td>
                      <td>{animal.entry_date.slice(0, 10)}</td>
                      <td>
                        <div className="row-actions">
                          <Button
                            variant="secondary"
                            onClick={() => setDetailId(animal.id)}
                          >
                            Ver detalle
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {detailId ? (
        <AnimalDetailModal
          animalId={detailId}
          canWrite={canWrite}
          pens={pens}
          areas={areas}
          onClose={() => setDetailId(null)}
          onEdit={(animal) => {
            setDetailId(null);
            setFormState({ mode: 'edit', animal });
          }}
          onRequestStatusChange={(animal) => setStatusTarget(animal)}
        />
      ) : null}

      {formState ? (
        <AnimalFormModal
          mode={formState.mode}
          animal={formState.mode === 'edit' ? formState.animal : undefined}
          areas={areas}
          pens={pens}
          occupancy={occupancy}
          onClose={() => setFormState(null)}
          onSubmit={handleSubmit}
        />
      ) : null}

      {statusTarget ? (
        <AnimalStatusDialog
          animal={statusTarget}
          busy={statusBusy}
          onConfirm={(status) => void handleStatusConfirm(status)}
          onCancel={() => setStatusTarget(null)}
        />
      ) : null}
    </div>
  );
}
