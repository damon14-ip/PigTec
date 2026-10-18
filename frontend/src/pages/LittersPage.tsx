import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/auth-context';
import { describeApiError } from '../lib/http';
import { listAnimals, type Animal } from '../services/animals.service';
import {
  canWriteLitters,
  createLitter,
  listLitters,
  updateLitter,
  type CreateLitterInput,
  type Litter,
  type UpdateLitterInput,
} from '../services/litters.service';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/icons';
import { PageHeader } from '../components/ui/PageHeader';
import { Spinner } from '../components/ui/Spinner';
import { LitterDetailModal } from '../components/litters/LitterDetailModal';
import { LitterFormModal } from '../components/litters/LitterFormModal';
import { LittersTable } from '../components/litters/LittersTable';

type LoadState = 'loading' | 'ready' | 'error';
type Notice = { variant: 'success' | 'danger'; message: string };
type LitterFormState = { mode: 'create' } | { mode: 'edit'; litter: Litter };

/**
 * Tamaño de página. El backend acepta `limit` 1..500 (100 por defecto) y
 * devuelve una página ordenada por `birth_date` descendente; NO informa del
 * total de registros, así que la interfaz no muestra un contador completo.
 */
const PAGE_SIZE = 20;

/**
 * Sección "Camadas".
 *
 * Consume exclusivamente los endpoints REALES del backend con el JWT de la
 * sesión: `GET /litters`, `GET /litters/:id`, `GET /litters/:id/offspring`,
 * `POST /litters` y `PATCH /litters/:id`, más la lectura de apoyo `GET /animals`
 * para identificar a la madre y al padre por su código PigTec.
 *
 * Reglas y honestidad respetadas:
 * - la camada NO se elimina (el backend no expone `DELETE`); no hay botón de
 *   borrado;
 * - la interfaz NO crea porcinos individuales a partir de una camada;
 * - solo admin, manager y operator registran o editan camadas (el veterinario
 *   consulta);
 * - la paginación es por `limit`/`offset`, sin total (la API no lo devuelve).
 */
export function LittersPage() {
  const { profile, apiClient } = useAuth();
  const canWrite = profile ? canWriteLitters(profile.role) : false;

  const [animals, setAnimals] = useState<Animal[]>([]);
  const [catalogsState, setCatalogsState] = useState<LoadState>('loading');
  const [catalogsError, setCatalogsError] = useState<string | null>(null);
  const [catalogsKey, setCatalogsKey] = useState(0);

  const [litters, setLitters] = useState<Litter[]>([]);
  const [listState, setListState] = useState<LoadState>('loading');
  const [listError, setListError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [motherSearch, setMotherSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(0);

  const [notice, setNotice] = useState<Notice | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [formState, setFormState] = useState<LitterFormState | null>(null);

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
   * El backend no ofrece búsqueda por texto en camadas: la búsqueda por madre se
   * resuelve contra el catálogo (`animal_code`/`ear_tag_code`) y se envía el
   * `mother_id` real del filtro `GET /litters?mother_id=`.
   */
  const matchedMother = useMemo(() => {
    const text = motherSearch.trim().toLowerCase();
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
  }, [motherSearch, animals]);

  const motherFilterId = matchedMother?.id ?? null;

  const loadLitters = useCallback(
    async (signal?: AbortSignal) => {
      setListState('loading');
      try {
        const result = await listLitters(
          apiClient,
          {
            ...(motherFilterId ? { mother_id: motherFilterId } : {}),
            ...(fromDate ? { birth_from: fromDate } : {}),
            ...(toDate ? { birth_to: toDate } : {}),
            limit: PAGE_SIZE,
            offset: page * PAGE_SIZE,
          },
          signal ? { signal } : undefined,
        );
        if (signal?.aborted) {
          return;
        }
        setLitters(result);
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
    [apiClient, motherFilterId, fromDate, toDate, page],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadLitters(controller.signal);
    return () => controller.abort();
  }, [loadLitters, refreshKey]);

  const hasNext = litters.length >= PAGE_SIZE;
  const filtersActive =
    motherFilterId !== null || fromDate !== '' || toDate !== '';

  function resetPage(): void {
    setPage(0);
  }

  function clearFilters(): void {
    setMotherSearch('');
    setFromDate('');
    setToDate('');
    resetPage();
  }

  const handleSubmit = useCallback(
    async (input: CreateLitterInput | UpdateLitterInput): Promise<void> => {
      if (!formState) {
        return;
      }
      try {
        if (formState.mode === 'create') {
          const created = await createLitter(
            apiClient,
            input as CreateLitterInput,
          );
          setNotice({
            variant: 'success',
            message: `Camada registrada${
              created.litter_code ? ` (${created.litter_code})` : ''
            }.`,
          });
        } else {
          await updateLitter(apiClient, formState.litter.id, input);
          setNotice({
            variant: 'success',
            message: 'Camada actualizada correctamente.',
          });
        }
        setFormState(null);
        setPage(0);
        setRefreshKey((value) => value + 1);
        setCatalogsKey((value) => value + 1);
      } catch (caught) {
        setNotice({ variant: 'danger', message: describeApiError(caught) });
      }
    },
    [apiClient, formState],
  );

  return (
    <div className="page">
      <PageHeader
        title="Camadas"
        description="Registro de nacimientos y descendencia por camada."
        action={
          canWrite && catalogsState === 'ready' ? (
            <Button
              icon={<Icon name="litters" size={16} />}
              onClick={() => setFormState({ mode: 'create' })}
            >
              Registrar camada
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
          Tu rol permite consultar las camadas y su descendencia, pero no
          registrarlas ni editarlas. Esas acciones están reservadas a
          administradores, encargados y trabajadores.
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
          {catalogsError} El código de la madre y del padre puede aparecer como «no
          disponible», y no se podrán registrar camadas hasta recargar el catálogo.
        </Alert>
      ) : null}

      <section className="card">
        <div className="toolbar">
          <div className="field toolbar__search">
            <label className="visually-hidden" htmlFor="litter-mother-search">
              Buscar por madre
            </label>
            <input
              id="litter-mother-search"
              className="field__input"
              type="search"
              list="litter-mother-options"
              placeholder="Buscar madre por código o arete…"
              value={motherSearch}
              disabled={catalogsState !== 'ready'}
              onChange={(event) => {
                setMotherSearch(event.target.value);
                resetPage();
              }}
            />
            <datalist id="litter-mother-options">
              {animals
                .filter((animal) => animal.sex === 'female')
                .map((animal) => (
                  <option key={animal.id} value={animal.animal_code}>
                    {animal.ear_tag_code ?? ''}
                  </option>
                ))}
            </datalist>
            {motherSearch.trim() && !matchedMother ? (
              <p className="field__hint">
                Escribe el código PigTec exacto de la madre o selecciónala de las
                sugerencias.
              </p>
            ) : null}
          </div>

          <div className="field toolbar__field">
            <label className="field__label" htmlFor="litter-from-date">
              Parto desde
            </label>
            <input
              id="litter-from-date"
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
            <label className="field__label" htmlFor="litter-to-date">
              Parto hasta
            </label>
            <input
              id="litter-to-date"
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
            <span>Cargando camadas…</span>
          </div>
        ) : null}

        {listState === 'error' ? (
          <Alert
            variant="danger"
            title="No se pudieron cargar las camadas"
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
            <LittersTable
              litters={litters}
              animalCodeOf={(id) => animalById.get(id)?.animal_code ?? null}
              canWrite={canWrite}
              onView={(litter) => setDetailId(litter.id)}
              onEdit={(litter) => setFormState({ mode: 'edit', litter })}
              emptyMessage={
                filtersActive
                  ? 'No hay camadas que coincidan con la búsqueda o los filtros.'
                  : 'Todavía no hay camadas registradas.'
              }
            />

            {litters.length > 0 || page > 0 ? (
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
                  de camadas; «Siguiente» se habilita cuando la página se completa.
                </p>
              </>
            ) : null}
          </>
        ) : null}
      </section>

      {formState ? (
        <LitterFormModal
          mode={formState.mode}
          litter={formState.mode === 'edit' ? formState.litter : undefined}
          animals={animals}
          onClose={() => setFormState(null)}
          onSubmit={handleSubmit}
        />
      ) : null}

      {detailId ? (
        <LitterDetailModal
          litterId={detailId}
          animalCodeOf={(id) => animalById.get(id)?.animal_code ?? null}
          canWrite={canWrite}
          onEdit={(litter) => {
            setDetailId(null);
            setFormState({ mode: 'edit', litter });
          }}
          onClose={() => setDetailId(null)}
        />
      ) : null}
    </div>
  );
}
