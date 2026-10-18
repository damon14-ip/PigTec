import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/auth-context';
import { endOfLocalDayIso, startOfLocalDayIso } from '../lib/dates';
import { describeApiError } from '../lib/http';
import { listAnimals, type Animal } from '../services/animals.service';
import {
  HEALTH_EVENT_TYPES,
  HEALTH_EVENT_TYPE_LABELS,
  createHealthEvent,
  healthEventTypeOptionsFor,
  listHealthEvents,
  type CreateHealthEventInput,
  type HealthEvent,
  type HealthEventType,
} from '../services/health-events.service';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/icons';
import { PageHeader } from '../components/ui/PageHeader';
import { Spinner } from '../components/ui/Spinner';
import { AnimalHealthEventsModal } from '../components/health/AnimalHealthEventsModal';
import { HealthEventDetailModal } from '../components/health/HealthEventDetailModal';
import { HealthEventFormModal } from '../components/health/HealthEventFormModal';
import { HealthEventsTable } from '../components/health/HealthEventsTable';

type LoadState = 'loading' | 'ready' | 'error';
type Notice = { variant: 'success' | 'danger'; message: string };

/**
 * Tamaño de página. El backend acepta `limit` 1..500 (100 por defecto) y
 * devuelve una página ordenada por `occurred_at` descendente; NO informa del
 * total de registros, así que la interfaz no muestra un contador completo.
 */
const PAGE_SIZE = 20;

/**
 * Sección "Sanidad".
 *
 * Consume exclusivamente los endpoints REALES del backend con el JWT de la
 * sesión: `GET /health-events`, `GET /health-events/:id`,
 * `GET /animals/:id/health-events` y `POST /health-events`, más la lectura de
 * apoyo `GET /animals` para identificar a los porcinos por su código PigTec.
 *
 * Reglas y honestidad respetadas:
 * - el historial sanitario es INMUTABLE: no hay edición ni eliminación (el
 *   backend no las expone); no se ofrecen botones de borrado;
 * - los tipos de evento ofrecidos dependen del rol (matriz 5.1);
 * - solo se ofrecen porcinos que admiten eventos (`active`/`missing`);
 * - la mortalidad la deriva el trigger de la base; el frontend solo advierte y
 *   nunca fija el estado del porcino;
 * - la paginación es por `limit`/`offset`, sin total.
 */
export function HealthPage() {
  const { profile, apiClient } = useAuth();
  const canRegister = profile
    ? healthEventTypeOptionsFor(profile.role).length > 0
    : false;

  const [animals, setAnimals] = useState<Animal[]>([]);
  const [catalogsState, setCatalogsState] = useState<LoadState>('loading');
  const [catalogsError, setCatalogsError] = useState<string | null>(null);
  const [catalogsKey, setCatalogsKey] = useState(0);

  const [events, setEvents] = useState<HealthEvent[]>([]);
  const [listState, setListState] = useState<LoadState>('loading');
  const [listError, setListError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [animalSearch, setAnimalSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | HealthEventType>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(0);

  const [notice, setNotice] = useState<Notice | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [historyAnimal, setHistoryAnimal] = useState<Animal | null>(null);

  const loadCatalogs = useCallback(
    async (signal?: AbortSignal) => {
      setCatalogsState('loading');
      try {
        const animalList = await listAnimals(
          apiClient,
          undefined,
          signal ? { signal } : undefined,
        );
        if (signal?.aborted) {
          return;
        }
        setAnimals(animalList);
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

  /**
   * El backend no ofrece búsqueda por texto en eventos: la búsqueda por porcino
   * se resuelve contra el catálogo (`animal_code`/`ear_tag_code`) y se envía el
   * `animal_id` real del filtro `GET /health-events?animal_id=`.
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
  const fromIso = fromDate ? startOfLocalDayIso(fromDate) : undefined;
  const toIso = toDate ? endOfLocalDayIso(toDate) : undefined;

  const loadEvents = useCallback(
    async (signal?: AbortSignal) => {
      setListState('loading');
      try {
        const result = await listHealthEvents(
          apiClient,
          {
            ...(animalFilterId ? { animal_id: animalFilterId } : {}),
            ...(typeFilter !== 'all' ? { event_type: typeFilter } : {}),
            ...(fromIso ? { occurred_from: fromIso } : {}),
            ...(toIso ? { occurred_to: toIso } : {}),
            limit: PAGE_SIZE,
            offset: page * PAGE_SIZE,
          },
          signal ? { signal } : undefined,
        );
        if (signal?.aborted) {
          return;
        }
        setEvents(result);
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
    [apiClient, animalFilterId, typeFilter, fromIso, toIso, page],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadEvents(controller.signal);
    return () => controller.abort();
  }, [loadEvents, refreshKey]);

  const hasNext = events.length >= PAGE_SIZE;
  const filtersActive =
    animalFilterId !== null ||
    typeFilter !== 'all' ||
    fromDate !== '' ||
    toDate !== '';

  function resetPage(): void {
    setPage(0);
  }

  function clearFilters(): void {
    setAnimalSearch('');
    setTypeFilter('all');
    setFromDate('');
    setToDate('');
    resetPage();
  }

  const handleCreate = useCallback(
    async (input: CreateHealthEventInput): Promise<void> => {
      const animal = animals.find((item) => item.id === input.animal_id);
      try {
        await createHealthEvent(apiClient, input);
        setNotice({
          variant: 'success',
          message: animal
            ? `Evento registrado para el porcino ${animal.animal_code}.`
            : 'Evento sanitario registrado.',
        });
        setFormOpen(false);
        setPage(0);
        setRefreshKey((value) => value + 1);
        // El estado del porcino puede haber cambiado (p. ej. mortalidad): se
        // vuelve a leer del servidor en lugar de calcularlo en el cliente.
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
        title="Sanidad"
        description="Historial sanitario con eventos tipificados por porcino."
        action={
          canRegister && catalogsState === 'ready' ? (
            <Button
              icon={<Icon name="health" size={16} />}
              onClick={() => setFormOpen(true)}
            >
              Registrar evento
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
          Tu rol permite consultar el historial sanitario, pero no registrar
          eventos.
        </Alert>
      ) : null}

      {catalogsState === 'error' ? (
        <Alert
          variant="warning"
          title="No se pudieron cargar los porcinos"
          action={
            <Button
              variant="secondary"
              onClick={() => setCatalogsKey((value) => value + 1)}
            >
              Reintentar
            </Button>
          }
        >
          {catalogsError} Los códigos de porcino pueden aparecer como «no
          disponible» y no se podrán registrar eventos hasta recargar el catálogo.
        </Alert>
      ) : null}

      <section className="card">
        <div className="toolbar">
          <div className="field toolbar__search">
            <label className="visually-hidden" htmlFor="health-animal-search">
              Buscar porcino
            </label>
            <input
              id="health-animal-search"
              className="field__input"
              type="search"
              list="health-animal-options"
              placeholder="Buscar porcino por código o arete…"
              value={animalSearch}
              disabled={catalogsState !== 'ready'}
              onChange={(event) => {
                setAnimalSearch(event.target.value);
                resetPage();
              }}
            />
            <datalist id="health-animal-options">
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
            <label className="visually-hidden" htmlFor="health-type-filter">
              Filtrar por tipo de evento
            </label>
            <select
              id="health-type-filter"
              className="field__input"
              value={typeFilter}
              onChange={(event) => {
                setTypeFilter(event.target.value as 'all' | HealthEventType);
                resetPage();
              }}
            >
              <option value="all">Todos los tipos</option>
              {HEALTH_EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {HEALTH_EVENT_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>

          <div className="field toolbar__field">
            <label className="field__label" htmlFor="health-from-date">
              Desde
            </label>
            <input
              id="health-from-date"
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
            <label className="field__label" htmlFor="health-to-date">
              Hasta
            </label>
            <input
              id="health-to-date"
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
            <span>Cargando eventos sanitarios…</span>
          </div>
        ) : null}

        {listState === 'error' ? (
          <Alert
            variant="danger"
            title="No se pudieron cargar los eventos sanitarios"
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
            <HealthEventsTable
              events={events}
              animalCodeOf={(id) => animalById.get(id)?.animal_code ?? null}
              onView={(event) => setDetailId(event.id)}
              onAnimalHistory={(event) => {
                const animal = animalById.get(event.animal_id);
                if (animal) {
                  setHistoryAnimal(animal);
                }
              }}
              emptyMessage={
                filtersActive
                  ? 'No hay eventos que coincidan con la búsqueda o los filtros.'
                  : 'Todavía no hay eventos sanitarios registrados.'
              }
            />

            {events.length > 0 || page > 0 ? (
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
                  de eventos; «Siguiente» se habilita cuando la página se completa.
                </p>
              </>
            ) : null}
          </>
        ) : null}
      </section>

      {formOpen ? (
        <HealthEventFormModal
          role={profile?.role ?? 'operator'}
          animals={animals}
          onClose={() => setFormOpen(false)}
          onSubmit={handleCreate}
        />
      ) : null}

      {detailId ? (
        <HealthEventDetailModal
          eventId={detailId}
          animalCodeOf={(id) => animalById.get(id)?.animal_code ?? null}
          onClose={() => setDetailId(null)}
        />
      ) : null}

      {historyAnimal ? (
        <AnimalHealthEventsModal
          animal={historyAnimal}
          onClose={() => setHistoryAnimal(null)}
        />
      ) : null}
    </div>
  );
}
