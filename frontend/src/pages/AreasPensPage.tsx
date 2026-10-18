import { useCallback, useEffect, useMemo, useState } from 'react';
import { canManageCatalog } from '../config/roles';
import { useAuth } from '../context/auth-context';
import { describeApiError } from '../lib/http';
import {
  createArea,
  deactivateArea,
  listAreas,
  updateArea,
  type Area,
  type CreateAreaInput,
  type UpdateAreaInput,
} from '../services/areas.service';
import {
  createPen,
  deactivatePen,
  listPens,
  updatePen,
  type CreatePenInput,
  type Pen,
  type UpdatePenInput,
} from '../services/pens.service';
import type { LocationStatus } from '../services/location-status';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Icon } from '../components/icons';
import { PageHeader } from '../components/ui/PageHeader';
import { Spinner } from '../components/ui/Spinner';
import { AreaFormModal } from '../components/locations/AreaFormModal';
import { PenFormModal } from '../components/locations/PenFormModal';
import { StatusBadge } from '../components/locations/StatusBadge';

type Tab = 'areas' | 'pens';
type LoadState = 'loading' | 'ready' | 'error';
type StatusFilter = 'all' | LocationStatus;
type Notice = { variant: 'success' | 'danger'; message: string };

type AreaFormState = { mode: 'create' } | { mode: 'edit'; area: Area };
type PenFormState = { mode: 'create' } | { mode: 'edit'; pen: Pen };
type ConfirmState =
  | { kind: 'area'; area: Area }
  | { kind: 'pen'; pen: Pen };

/**
 * Sección "Áreas y corrales".
 *
 * Permite CONSULTAR, REGISTRAR y EDITAR áreas y corrales usando los endpoints
 * reales del backend con el JWT de la sesión. Respeta los permisos por rol:
 * - lectura: cualquier rol operativo activo (admin, manager, operator, vet),
 * - escritura (alta, edición y baja lógica): solo admin y manager.
 *
 * Reglas del backend respetadas al pie de la letra:
 * - el "borrado" es una baja LÓGICA (`status='inactive'`), nunca un DELETE físico,
 * - un corral no se reasigna de área en esta etapa,
 * - la capacidad es opcional (puede quedar sin registrar).
 *
 * El catálogo de una granja es pequeño, por lo que se carga completo y los
 * filtros (estado, área y texto) se aplican en memoria sobre las filas ya
 * cargadas; son los mismos filtros que ofrece el backend (`?status=`,
 * `?area_id=`), no se inventan criterios nuevos.
 */
export function AreasPensPage() {
  const { profile, apiClient } = useAuth();
  const canWrite = profile ? canManageCatalog(profile.role) : false;

  const [tab, setTab] = useState<Tab>('areas');

  const [areas, setAreas] = useState<Area[]>([]);
  const [areasState, setAreasState] = useState<LoadState>('loading');
  const [areasError, setAreasError] = useState<string | null>(null);

  const [pens, setPens] = useState<Pen[]>([]);
  const [pensState, setPensState] = useState<LoadState>('loading');
  const [pensError, setPensError] = useState<string | null>(null);

  const [areaStatus, setAreaStatus] = useState<StatusFilter>('all');
  const [areaQuery, setAreaQuery] = useState('');
  const [penAreaId, setPenAreaId] = useState<string>('all');
  const [penStatus, setPenStatus] = useState<StatusFilter>('all');
  const [penQuery, setPenQuery] = useState('');

  const [notice, setNotice] = useState<Notice | null>(null);
  const [areaForm, setAreaForm] = useState<AreaFormState | null>(null);
  const [penForm, setPenForm] = useState<PenFormState | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const loadAreas = useCallback(
    async (signal?: AbortSignal) => {
      setAreasState('loading');
      try {
        const data = await listAreas(
          apiClient,
          undefined,
          signal ? { signal } : undefined,
        );
        if (signal?.aborted) {
          return;
        }
        setAreas(data);
        setAreasError(null);
        setAreasState('ready');
      } catch (caught) {
        if (signal?.aborted) {
          return;
        }
        setAreasError(describeApiError(caught));
        setAreasState('error');
      }
    },
    [apiClient],
  );

  const loadPens = useCallback(
    async (signal?: AbortSignal) => {
      setPensState('loading');
      try {
        const data = await listPens(
          apiClient,
          undefined,
          signal ? { signal } : undefined,
        );
        if (signal?.aborted) {
          return;
        }
        setPens(data);
        setPensError(null);
        setPensState('ready');
      } catch (caught) {
        if (signal?.aborted) {
          return;
        }
        setPensError(describeApiError(caught));
        setPensState('error');
      }
    },
    [apiClient],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadAreas(controller.signal);
    return () => controller.abort();
  }, [loadAreas]);

  useEffect(() => {
    const controller = new AbortController();
    void loadPens(controller.signal);
    return () => controller.abort();
  }, [loadPens]);

  const areaNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const area of areas) {
      map.set(area.id, area.name);
    }
    return map;
  }, [areas]);

  const activeAreas = useMemo(
    () => areas.filter((area) => area.status === 'active'),
    [areas],
  );

  const visibleAreas = useMemo(() => {
    const query = areaQuery.trim().toLowerCase();
    return areas.filter((area) => {
      if (areaStatus !== 'all' && area.status !== areaStatus) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        area.name.toLowerCase().includes(query) ||
        (area.description ?? '').toLowerCase().includes(query)
      );
    });
  }, [areas, areaStatus, areaQuery]);

  const visiblePens = useMemo(() => {
    const query = penQuery.trim().toLowerCase();
    return pens.filter((pen) => {
      if (penAreaId !== 'all' && pen.area_id !== penAreaId) {
        return false;
      }
      if (penStatus !== 'all' && pen.status !== penStatus) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        pen.code.toLowerCase().includes(query) ||
        (pen.name ?? '').toLowerCase().includes(query)
      );
    });
  }, [pens, penAreaId, penStatus, penQuery]);

  const handleAreaSubmit = useCallback(
    async (input: CreateAreaInput | UpdateAreaInput): Promise<void> => {
      if (!areaForm) {
        return;
      }
      try {
        if (areaForm.mode === 'create') {
          await createArea(apiClient, input as CreateAreaInput);
          setNotice({
            variant: 'success',
            message: 'Área registrada correctamente.',
          });
        } else {
          await updateArea(apiClient, areaForm.area.id, input as UpdateAreaInput);
          setNotice({
            variant: 'success',
            message: 'Área actualizada correctamente.',
          });
        }
        setAreaForm(null);
        await loadAreas();
      } catch (caught) {
        setNotice({ variant: 'danger', message: describeApiError(caught) });
      }
    },
    [apiClient, areaForm, loadAreas],
  );

  const handlePenSubmit = useCallback(
    async (input: CreatePenInput | UpdatePenInput): Promise<void> => {
      if (!penForm) {
        return;
      }
      try {
        if (penForm.mode === 'create') {
          await createPen(apiClient, input as CreatePenInput);
          setNotice({
            variant: 'success',
            message: 'Corral registrado correctamente.',
          });
        } else {
          await updatePen(apiClient, penForm.pen.id, input as UpdatePenInput);
          setNotice({
            variant: 'success',
            message: 'Corral actualizado correctamente.',
          });
        }
        setPenForm(null);
        await loadPens();
      } catch (caught) {
        setNotice({ variant: 'danger', message: describeApiError(caught) });
      }
    },
    [apiClient, penForm, loadPens],
  );

  const handleConfirm = useCallback(async () => {
    if (!confirmTarget) {
      return;
    }
    setConfirmBusy(true);
    try {
      if (confirmTarget.kind === 'area') {
        await deactivateArea(apiClient, confirmTarget.area.id);
        setNotice({
          variant: 'success',
          message: 'Área desactivada (baja lógica). Su historial se conserva.',
        });
        await loadAreas();
      } else {
        await deactivatePen(apiClient, confirmTarget.pen.id);
        setNotice({
          variant: 'success',
          message: 'Corral desactivado (baja lógica). Su historial se conserva.',
        });
        await loadPens();
      }
    } catch (caught) {
      setNotice({ variant: 'danger', message: describeApiError(caught) });
    } finally {
      setConfirmTarget(null);
      setConfirmBusy(false);
    }
  }, [apiClient, confirmTarget, loadAreas, loadPens]);

  return (
    <div className="page">
      <PageHeader
        title="Áreas y corrales"
        description="Zonas de la granja y los corrales asociados a cada área."
        action={
          canWrite ? (
            tab === 'areas' ? (
              <Button
                icon={<Icon name="areas" size={16} />}
                onClick={() => setAreaForm({ mode: 'create' })}
              >
                Nueva área
              </Button>
            ) : (
              <Button
                icon={<Icon name="areas" size={16} />}
                onClick={() => setPenForm({ mode: 'create' })}
                disabled={activeAreas.length === 0}
              >
                Nuevo corral
              </Button>
            )
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
          Tu rol permite consultar áreas y corrales, pero no registrarlos ni
          editarlos. Esas acciones están reservadas a administradores y
          encargados.
        </Alert>
      ) : null}

      <div className="tabs" role="tablist" aria-label="Áreas y corrales">
        <button
          type="button"
          role="tab"
          id="tab-areas"
          aria-selected={tab === 'areas'}
          aria-controls="panel-areas"
          className={`tab${tab === 'areas' ? ' is-active' : ''}`}
          onClick={() => setTab('areas')}
        >
          Áreas
          <span className="tab__count">{areas.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          id="tab-pens"
          aria-selected={tab === 'pens'}
          aria-controls="panel-pens"
          className={`tab${tab === 'pens' ? ' is-active' : ''}`}
          onClick={() => setTab('pens')}
        >
          Corrales
          <span className="tab__count">{pens.length}</span>
        </button>
      </div>

      {tab === 'areas' ? (
        <section
          id="panel-areas"
          role="tabpanel"
          aria-labelledby="tab-areas"
          className="card"
        >
          <div className="toolbar">
            <div className="field toolbar__search">
              <label className="visually-hidden" htmlFor="area-search">
                Buscar área
              </label>
              <input
                id="area-search"
                className="field__input"
                type="search"
                placeholder="Buscar por nombre o descripción…"
                value={areaQuery}
                onChange={(event) => setAreaQuery(event.target.value)}
              />
            </div>
            <div className="field toolbar__field">
              <label className="visually-hidden" htmlFor="area-status">
                Filtrar por estado
              </label>
              <select
                id="area-status"
                className="field__input"
                value={areaStatus}
                onChange={(event) =>
                  setAreaStatus(event.target.value as StatusFilter)
                }
              >
                <option value="all">Todos los estados</option>
                <option value="active">Solo activas</option>
                <option value="inactive">Solo inactivas</option>
              </select>
            </div>
            <Button
              variant="secondary"
              icon={<Icon name="refresh" size={16} />}
              loading={areasState === 'loading'}
              onClick={() => void loadAreas()}
            >
              Actualizar
            </Button>
          </div>

          {areasState === 'loading' ? (
            <div className="dashboard-loading" role="status" aria-live="polite">
              <Spinner size={20} />
              <span>Cargando áreas…</span>
            </div>
          ) : null}

          {areasState === 'error' ? (
            <Alert
              variant="danger"
              title="No se pudieron cargar las áreas"
              action={
                <Button variant="secondary" onClick={() => void loadAreas()}>
                  Reintentar
                </Button>
              }
            >
              {areasError}
            </Alert>
          ) : null}

          {areasState === 'ready' && visibleAreas.length === 0 ? (
            <p className="table-empty">
              {areas.length === 0
                ? 'Todavía no hay áreas registradas.'
                : 'No hay áreas que coincidan con la búsqueda o el filtro.'}
            </p>
          ) : null}

          {areasState === 'ready' && visibleAreas.length > 0 ? (
            <div className="table-wrapper">
              <table className="data-table">
                <caption className="visually-hidden">
                  Áreas de la granja
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Nombre</th>
                    <th scope="col">Descripción</th>
                    <th scope="col">Estado</th>
                    {canWrite ? <th scope="col">Acciones</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {visibleAreas.map((area) => (
                    <tr key={area.id}>
                      <td>{area.name}</td>
                      <td>{area.description ?? '—'}</td>
                      <td>
                        <StatusBadge status={area.status} />
                      </td>
                      {canWrite ? (
                        <td>
                          <div className="row-actions">
                            <Button
                              variant="secondary"
                              onClick={() =>
                                setAreaForm({ mode: 'edit', area })
                              }
                            >
                              Editar
                            </Button>
                            {area.status === 'active' ? (
                              <Button
                                variant="danger"
                                onClick={() =>
                                  setConfirmTarget({ kind: 'area', area })
                                }
                              >
                                Desactivar
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : (
        <section
          id="panel-pens"
          role="tabpanel"
          aria-labelledby="tab-pens"
          className="card"
        >
          <div className="toolbar">
            <div className="field toolbar__search">
              <label className="visually-hidden" htmlFor="pen-search">
                Buscar corral
              </label>
              <input
                id="pen-search"
                className="field__input"
                type="search"
                placeholder="Buscar por código o nombre…"
                value={penQuery}
                onChange={(event) => setPenQuery(event.target.value)}
              />
            </div>
            <div className="field toolbar__field">
              <label className="visually-hidden" htmlFor="pen-area">
                Filtrar por área
              </label>
              <select
                id="pen-area"
                className="field__input"
                value={penAreaId}
                onChange={(event) => setPenAreaId(event.target.value)}
              >
                <option value="all">Todas las áreas</option>
                {areas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field toolbar__field">
              <label className="visually-hidden" htmlFor="pen-status">
                Filtrar por estado
              </label>
              <select
                id="pen-status"
                className="field__input"
                value={penStatus}
                onChange={(event) =>
                  setPenStatus(event.target.value as StatusFilter)
                }
              >
                <option value="all">Todos los estados</option>
                <option value="active">Solo activos</option>
                <option value="inactive">Solo inactivos</option>
              </select>
            </div>
            <Button
              variant="secondary"
              icon={<Icon name="refresh" size={16} />}
              loading={pensState === 'loading'}
              onClick={() => void loadPens()}
            >
              Actualizar
            </Button>
          </div>

          {pensState === 'loading' ? (
            <div className="dashboard-loading" role="status" aria-live="polite">
              <Spinner size={20} />
              <span>Cargando corrales…</span>
            </div>
          ) : null}

          {pensState === 'error' ? (
            <Alert
              variant="danger"
              title="No se pudieron cargar los corrales"
              action={
                <Button variant="secondary" onClick={() => void loadPens()}>
                  Reintentar
                </Button>
              }
            >
              {pensError}
            </Alert>
          ) : null}

          {pensState === 'ready' && visiblePens.length === 0 ? (
            <p className="table-empty">
              {pens.length === 0
                ? 'Todavía no hay corrales registrados.'
                : 'No hay corrales que coincidan con la búsqueda o los filtros.'}
            </p>
          ) : null}

          {pensState === 'ready' && visiblePens.length > 0 ? (
            <div className="table-wrapper">
              <table className="data-table">
                <caption className="visually-hidden">
                  Corrales de la granja
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Código</th>
                    <th scope="col">Nombre</th>
                    <th scope="col">Área</th>
                    <th scope="col">Capacidad</th>
                    <th scope="col">Estado</th>
                    {canWrite ? <th scope="col">Acciones</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {visiblePens.map((pen) => (
                    <tr key={pen.id}>
                      <td>
                        <span className="code-chip">{pen.code}</span>
                      </td>
                      <td>{pen.name ?? '—'}</td>
                      <td>{areaNameById.get(pen.area_id) ?? 'Área no disponible'}</td>
                      <td>
                        {pen.capacity === null
                          ? 'Sin registrar'
                          : String(pen.capacity)}
                      </td>
                      <td>
                        <StatusBadge status={pen.status} />
                      </td>
                      {canWrite ? (
                        <td>
                          <div className="row-actions">
                            <Button
                              variant="secondary"
                              onClick={() => setPenForm({ mode: 'edit', pen })}
                            >
                              Editar
                            </Button>
                            {pen.status === 'active' ? (
                              <Button
                                variant="danger"
                                onClick={() =>
                                  setConfirmTarget({ kind: 'pen', pen })
                                }
                              >
                                Desactivar
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      )}

      {areaForm ? (
        <AreaFormModal
          mode={areaForm.mode}
          area={areaForm.mode === 'edit' ? areaForm.area : undefined}
          onClose={() => setAreaForm(null)}
          onSubmit={handleAreaSubmit}
        />
      ) : null}

      {penForm ? (
        <PenFormModal
          mode={penForm.mode}
          pen={penForm.mode === 'edit' ? penForm.pen : undefined}
          areas={areas}
          onClose={() => setPenForm(null)}
          onSubmit={handlePenSubmit}
        />
      ) : null}

      {confirmTarget ? (
        <ConfirmDialog
          title={
            confirmTarget.kind === 'area'
              ? 'Desactivar área'
              : 'Desactivar corral'
          }
          message={
            confirmTarget.kind === 'area'
              ? `¿Desactivar el área “${confirmTarget.area.name}”? Se marcará como inactiva; no se borra ni pierde su historial.`
              : `¿Desactivar el corral “${confirmTarget.pen.code}”? Se marcará como inactivo; no se borra ni pierde su historial.`
          }
          confirmLabel="Desactivar"
          busy={confirmBusy}
          onConfirm={() => void handleConfirm()}
          onCancel={() => setConfirmTarget(null)}
        />
      ) : null}
    </div>
  );
}
