import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/icons';
import { PageHeader } from '../components/ui/PageHeader';
import { Spinner } from '../components/ui/Spinner';
import { MovementFormModal } from '../components/movements/MovementFormModal';
import { MovementsTable } from '../components/movements/MovementsTable';
import {
  buildPenLabelMap,
  endOfDayIso,
  startOfDayIso,
} from '../components/movements/labels';
import { useAuth } from '../context/auth-context';
import { describeApiError } from '../lib/http';
import { listAnimals, type Animal } from '../services/animals.service';
import { listAreas, type Area } from '../services/areas.service';
import {
  MOVEMENT_REASONS,
  MOVEMENT_REASON_LABELS,
  createMovement,
  listMovements,
  movementReasonOptionsFor,
  type CreateMovementInput,
  type Movement,
  type MovementReason,
} from '../services/movements.service';
import { listPens, type Pen } from '../services/pens.service';

type LoadState = 'loading' | 'ready' | 'error';
type Notice = { variant: 'success' | 'danger'; message: string };

/**
 * Tamaño de página. El backend acepta `limit` 1..500 (100 por defecto) y
 * devuelve una página ordenada por `moved_at` descendente; NO informa del total
 * de registros, así que la interfaz no muestra un contador completo.
 */
const PAGE_SIZE = 20;

/**
 * Sección "Movimientos".
 *
 * Historial de cambios de ubicación y salidas del inventario. Consume
 * exclusivamente los endpoints REALES del backend con el JWT de la sesión:
 * `GET /movements`, `GET /animals/:id/movements` (vía el detalle del porcino) y
 * `POST /movements`, más las lecturas de apoyo `GET /animals`, `GET /areas` y
 * `GET /pens` para etiquetar y ofrecer corrales.
 *
 * Reglas y honestidad respetadas:
 * - el historial es inmutable: no hay edición ni eliminación (el backend no las
 *   expone);
 * - la ubicación, el estado y la fecha de salida los DERIVA el trigger de la
 *   base a partir del movimiento: el frontend nunca los calcula ni los fija;
 * - los tipos de movimiento ofrecidos dependen del rol (matriz 5.1);
 * - la paginación es por `limit`/`offset`, sin total (la API no lo devuelve).
 */
export function MovementsPage() {
  const { profile, apiClient } = useAuth();
  const canRegister = profile
    ? movementReasonOptionsFor(profile.role).length > 0
    : false;

  const [animals, setAnimals] = useState<Animal[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [pens, setPens] = useState<Pen[]>([]);
  const [catalogsState, setCatalogsState] = useState<LoadState>('loading');
  const [catalogsError, setCatalogsError] = useState<string | null>(null);
  const [catalogsKey, setCatalogsKey] = useState(0);

  const [movements, setMovements] = useState<Movement[]>([]);
  const [listState, setListState] = useState<LoadState>('loading');
  const [listError, setListError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [animalSearch, setAnimalSearch] = useState('');
  const [reasonFilter, setReasonFilter] = useState<'all' | MovementReason>('all');
  const [penFilter, setPenFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(0);

  const [notice, setNotice] = useState<Notice | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const loadCatalogs = useCallback(
    async (signal?: AbortSignal) => {
      setCatalogsState('loading');
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
        setCatalogsError(null);
        setCatalogsState('ready');
      } catch (caught) {
        if (signal?.aborted) {
          return;
        }
        setCatalogsError(describeApiError(caught));
        setCatalogsState('error');
      }
    },
    [apiClient],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadCatalogs(controller.signal);
    return () => controller.abort();
  }, [loadCatalogs, catalogsKey]);

  const animalById = useMemo(() => {
    const map = new Map<string, Animal>();
    for (const animal of animals) {
      map.set(animal.id, animal);
    }
    return map;
  }, [animals]);

  const penLabels = useMemo(() => buildPenLabelMap(pens, areas), [pens, areas]);

  /**
   * El backend no ofrece búsqueda por texto en movimientos: la búsqueda por
   * porcino se resuelve contra el catálogo (`animal_code`/`ear_tag_code`) y se
   * envía el `animal_id` real del filtro `GET /movements?animal_id=`.
   */
  const matchedAnimal = useMemo(() => {
    const text = animalSearch.trim().toLowerCase();
    if (!text) {
      return null;
    }
    return (
      animals.find(
        (animal) =>
          animal.animal_code.toLowerCase() === text ||
          (animal.ear_tag_code ?? '').toLowerCase() === text,
      ) ?? null
    );
  }, [animalSearch, animals]);

  const animalFilterId = matchedAnimal?.id ?? null;
  const fromIso = fromDate ? startOfDayIso(fromDate) : undefined;
  const toIso = toDate ? endOfDayIso(toDate) : undefined;

  const loadMovements = useCallback(
    async (signal?: AbortSignal) => {
      setListState('loading');
      try {
        const result = await listMovements(
          apiClient,
          {
            ...(animalFilterId ? { animal_id: animalFilterId } : {}),
            ...(penFilter !== 'all' ? { pen_id: penFilter } : {}),
            ...(reasonFilter !== 'all' ? { reason: reasonFilter } : {}),
            ...(fromIso ? { moved_from: fromIso } : {}),
            ...(toIso ? { moved_to: toIso } : {}),
            limit: PAGE_SIZE,
            offset: page * PAGE_SIZE,
          },
          signal ? { signal } : undefined,
        );
        if (signal?.aborted) {
          return;
        }
        setMovements(result);
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
    [
      apiClient,
      animalFilterId,
      penFilter,
      reasonFilter,
      fromIso,
      toIso,
      page,
    ],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadMovements(controller.signal);
    return () => controller.abort();
  }, [loadMovements, refreshKey]);

  const hasNext = movements.length >= PAGE_SIZE;
  const filtersActive =
    animalFilterId !== null ||
    reasonFilter !== 'all' ||
    penFilter !== 'all' ||
    fromDate !== '' ||
    toDate !== '';

  function resetPage(): void {
    setPage(0);
  }

  function clearFilters(): void {
    setAnimalSearch('');
    setReasonFilter('all');
    setPenFilter('all');
    setFromDate('');
    setToDate('');
    resetPage();
  }

  const handleCreate = useCallback(
    async (input: CreateMovementInput): Promise<void> => {
      const animal = animals.find((item) => item.id === input.animal_id);
      try {
        await createMovement(apiClient, input);
        setNotice({
          variant: 'success',
          message: animal
            ? `Movimiento registrado para el porcino ${animal.animal_code}.`
            : 'Movimiento registrado.',
        });
        setFormOpen(false);
        // Refresca el historial y los catálogos: la ubicación/estado del porcino
        // los deriva el trigger de la base y deben leerse del servidor.
        setPage(0);
        setRefreshKey((value) => value + 1);
        setCatalogsKey((value) => value + 1);
      } catch (caught) {
        setNotice({ variant: 'danger', message: describeApiError(caught) });
      }
    },
    [apiClient, animals],
  );

  return (
    <div className="page">
      <PageHeader
        title="Movimientos"
        description="Historial de cambios de ubicación y salidas del inventario."
        action={
          canRegister && catalogsState === 'ready' ? (
            <Button
              icon={<Icon name="movements" size={16} />}
              onClick={() => setFormOpen(true)}
            >
              Registrar movimiento
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

      {!canRegister ? (
        <Alert variant="info" title="Modo consulta">
          Tu rol permite consultar el historial de movimientos, pero no registrar
          movimientos.
        </Alert>
      ) : null}

      {catalogsState === 'error' ? (
        <Alert
          variant="warning"
          title="No se pudieron cargar los catálogos"
          action={
            <Button
              variant="secondary"
              onClick={() => setCatalogsKey((value) => value + 1)}
            >
              Reintentar
            </Button>
          }
        >
          {catalogsError} Los códigos de porcino y corral pueden aparecer como «no
          disponible» hasta que se recarguen.
        </Alert>
      ) : null}

      <section className="card">
        <div className="toolbar">
          <div className="field toolbar__search">
            <label className="visually-hidden" htmlFor="movement-animal-search">
              Buscar porcino
            </label>
            <input
              id="movement-animal-search"
              className="field__input"
              type="search"
              list="movement-animal-options"
              placeholder="Buscar porcino por código o arete…"
              value={animalSearch}
              disabled={catalogsState !== 'ready'}
              onChange={(event) => {
                setAnimalSearch(event.target.value);
                resetPage();
              }}
            />
            <datalist id="movement-animal-options">
              {animals.map((animal) => (
                <option key={animal.id} value={animal.animal_code}>
                  {animal.ear_tag_code ?? ''}
                </option>
              ))}
            </datalist>
            {animalSearch.trim() && !matchedAnimal ? (
              <p className="field__hint">
                Escribe el código PigTec exacto del porcino o selecciónalo de las
                sugerencias.
              </p>
            ) : null}
          </div>

          <div className="field toolbar__field">
            <label className="visually-hidden" htmlFor="movement-reason-filter">
              Filtrar por tipo de movimiento
            </label>
            <select
              id="movement-reason-filter"
              className="field__input"
              value={reasonFilter}
              onChange={(event) => {
                setReasonFilter(event.target.value as 'all' | MovementReason);
                resetPage();
              }}
            >
              <option value="all">Todos los tipos</option>
              {MOVEMENT_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {MOVEMENT_REASON_LABELS[reason]}
                </option>
              ))}
            </select>
          </div>

          <div className="field toolbar__field">
            <label className="visually-hidden" htmlFor="movement-pen-filter">
              Filtrar por corral
            </label>
            <select
              id="movement-pen-filter"
              className="field__input"
              value={penFilter}
              disabled={catalogsState !== 'ready'}
              onChange={(event) => {
                setPenFilter(event.target.value);
                resetPage();
              }}
            >
              <option value="all">Todos los corrales</option>
              {pens.map((pen) => (
                <option key={pen.id} value={pen.id}>
                  {penLabels.get(pen.id) ?? pen.code}
                </option>
              ))}
            </select>
          </div>

          <div className="field toolbar__field">
            <label className="field__label" htmlFor="movement-from-date">
              Desde
            </label>
            <input
              id="movement-from-date"
              className="field__input"
              type="date"
              value={fromDate}
              onChange={(event) => {
                setFromDate(event.target.value);
                resetPage();
              }}
            />
          </div>

          <div className="field toolbar__field">
            <label className="field__label" htmlFor="movement-to-date">
              Hasta
            </label>
            <input
              id="movement-to-date"
              className="field__input"
              type="date"
              value={toDate}
              onChange={(event) => {
                setToDate(event.target.value);
                resetPage();
              }}
            />
          </div>

          <Button variant="ghost" onClick={clearFilters} disabled={!filtersActive}>
            Limpiar
          </Button>
          <Button
            variant="secondary"
            icon={<Icon name="refresh" size={16} />}
            loading={listState === 'loading'}
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            Actualizar
          </Button>
        </div>

        {listState === 'loading' ? (
          <div className="dashboard-loading" role="status" aria-live="polite">
            <Spinner size={20} />
            <span>Cargando movimientos…</span>
          </div>
        ) : null}

        {listState === 'error' ? (
          <Alert
            variant="danger"
            title="No se pudieron cargar los movimientos"
            action={
              <Button
                variant="secondary"
                onClick={() => setRefreshKey((value) => value + 1)}
              >
                Reintentar
              </Button>
            }
          >
            {listError}
          </Alert>
        ) : null}

        {listState === 'ready' ? (
          <>
            <MovementsTable
              movements={movements}
              animalCodeOf={(id) => animalById.get(id)?.animal_code ?? null}
              penLabelOf={(id) => penLabels.get(id) ?? null}
              emptyMessage={
                filtersActive
                  ? 'No hay movimientos que coincidan con la búsqueda o los filtros.'
                  : 'Todavía no hay movimientos registrados.'
              }
            />

            {movements.length > 0 || page > 0 ? (
              <>
                <div className="pagination">
                  <Button
                    variant="secondary"
                    disabled={page === 0}
                    onClick={() => setPage((value) => Math.max(0, value - 1))}
                  >
                    Anterior
                  </Button>
                  <span className="pagination__status">Página {page + 1}</span>
                  <Button
                    variant="secondary"
                    disabled={!hasNext}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    Siguiente
                  </Button>
                </div>
                <p className="field__hint">
                  El servidor devuelve una página a la vez y no informa del total
                  de movimientos; «Siguiente» se habilita cuando la página se
                  completa.
                </p>
              </>
            ) : null}          </>
        ) : null}
      </section>

      {formOpen ? (
        <MovementFormModal
          role={profile?.role ?? 'operator'}
          animals={animals}
          pens={pens}
          areas={areas}
          onClose={() => setFormOpen(false)}
          onSubmit={handleCreate}
        />
      ) : null}
    </div>
  );
}
