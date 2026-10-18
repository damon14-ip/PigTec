import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/auth-context';
import { describeApiError } from '../lib/http';
import { formatCalendarDate } from '../lib/dates';
import {
  ANIMAL_ORIGINS,
  ANIMAL_ORIGIN_LABELS,
  ANIMAL_SEXES,
  ANIMAL_SEX_LABELS,
  type AnimalOrigin,
  type AnimalSex,
} from '../services/animals.service';
import {
  MOVEMENT_REASONS,
  MOVEMENT_REASON_LABELS,
  type MovementReason,
} from '../services/movements.service';
import {
  HEALTH_EVENT_TYPES,
  HEALTH_EVENT_TYPE_LABELS,
  type HealthEventType,
} from '../services/health-events.service';
import {
  getReportsSummary,
  type ReportsQuery,
  type ReportsSummary,
} from '../services/reports.service';
import {
  PDF_DOCUMENT_LABELS,
  PDF_DOCUMENT_TYPES,
  exportReportsExcel,
  exportReportsPdf,
  triggerDownload,
  type PdfDocumentType,
} from '../services/reports-export.service';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { Icon } from '../components/icons';
import { PageHeader } from '../components/ui/PageHeader';
import { Spinner } from '../components/ui/Spinner';
import { StatCard } from '../components/ui/StatCard';
import { AnimalStatusChart } from '../components/dashboard/AnimalStatusChart';
import { MovementsByMonthChart } from '../components/dashboard/MovementsByMonthChart';
import { PensOccupancyChart } from '../components/dashboard/PensOccupancyChart';
import { formatPercent } from '../components/dashboard/chart-utils';
import { CategoryBarChart } from '../components/reports/CategoryBarChart';
import { PensOccupancyTable } from '../components/reports/PensOccupancyTable';
import { ReportLittersTable } from '../components/reports/ReportLittersTable';

type LoadStatus = 'loading' | 'ready' | 'error';

/** Estado local de los filtros (cadena vacia = sin filtro). */
interface FiltersState {
  from: string;
  to: string;
  movement_reason: MovementReason | '';
  health_event_type: HealthEventType | '';
  sex: AnimalSex | '';
  origin: AnimalOrigin | '';
}

const EMPTY_FILTERS: FiltersState = {
  from: '',
  to: '',
  movement_reason: '',
  health_event_type: '',
  sex: '',
  origin: '',
};

/** Colores de apoyo para las distribuciones por sexo y origen. */
const SEX_COLORS: Record<AnimalSex, string> = {
  male: '#1c5fb0',
  female: '#b7791f',
  unknown: '#8a9a92',
};

const ORIGIN_COLORS: Record<AnimalOrigin | 'null', string> = {
  born_on_farm: '#1f7a4d',
  purchased: '#4c9a76',
  transferred_in: '#1c5fb0',
  unknown: '#b7791f',
  null: '#8a9a92',
};

/** Construye el objeto de consulta con solo los filtros con valor. */
function buildQuery(filters: FiltersState): ReportsQuery {
  const query: ReportsQuery = {};
  if (filters.from) {
    query.from = filters.from;
  }
  if (filters.to) {
    query.to = filters.to;
  }
  if (filters.movement_reason) {
    query.movement_reason = filters.movement_reason;
  }
  if (filters.health_event_type) {
    query.health_event_type = filters.health_event_type;
  }
  if (filters.sex) {
    query.sex = filters.sex;
  }
  if (filters.origin) {
    query.origin = filters.origin;
  }
  return query;
}

/**
 * Sección "Reportes y análisis".
 *
 * Consulta `GET /reports/summary`, que calcula TODAS las estadísticas en el
 * backend con el JWT de la sesión y RLS: el navegador solo recibe el resumen
 * agregado. No se muestran cifras ficticias: un `0` es un conteo confirmado y
 * una métrica no calculable se muestra como «Sin datos suficientes».
 *
 * Los filtros son los reales del backend (rango de fechas y categorías de los
 * enums) y se aplican al cambiar, además del botón «Actualizar». Las fechas se
 * interpretan en UTC, igual que la API.
 *
 * La sección de exportaciones (S5-E2) solicita al backend el Excel integral o un
 * PDF con los filtros aplicados; el archivo se genera en el servidor con el JWT
 * de la sesión (RLS) y el navegador solo inicia la descarga.
 */
export function ReportsPage() {
  const { apiClient } = useAuth();

  const [filters, setFilters] = useState<FiltersState>(EMPTY_FILTERS);
  const [summary, setSummary] = useState<ReportsSummary | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Estado de las exportaciones (S5-E2): tipo de PDF elegido, que archivo se
  // esta generando y los avisos de exito o error.
  const [pdfType, setPdfType] = useState<PdfDocumentType>('general');
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportDone, setExportDone] = useState<string | null>(null);

  const query = useMemo(() => buildQuery(filters), [filters]);
  const invalidRange =
    filters.from !== '' && filters.to !== '' && filters.from > filters.to;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (invalidRange) {
        // No se consulta un rango invertido: el backend lo rechazaria (400).
        setRefreshing(false);
        return;
      }
      try {
        const data = await getReportsSummary(
          apiClient,
          query,
          signal ? { signal } : undefined,
        );
        if (signal?.aborted) {
          return;
        }
        setSummary(data);
        setError(null);
        setStatus('ready');
      } catch (caught) {
        if (signal?.aborted) {
          return;
        }
        setError(describeApiError(caught));
        setStatus('error');
      } finally {
        if (!signal?.aborted) {
          setRefreshing(false);
        }
      }
    },
    [apiClient, query, invalidRange],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refreshKey]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshKey((value) => value + 1);
  }, []);

  /**
   * Genera y descarga una exportacion en el backend con los filtros actuales.
   * Nunca se construye el documento en el cliente: solo se inicia la descarga.
   */
  const runExport = useCallback(
    async (kind: 'excel' | 'pdf') => {
      setExporting(kind);
      setExportError(null);
      setExportDone(null);
      try {
        const file =
          kind === 'excel'
            ? await exportReportsExcel(apiClient, query)
            : await exportReportsPdf(apiClient, pdfType, query);
        triggerDownload(file);
        setExportDone(`Se descargó ${file.filename}.`);
      } catch (caught) {
        setExportError(describeApiError(caught));
      } finally {
        setExporting(null);
      }
    },
    [apiClient, pdfType, query],
  );

  const filtersActive = useMemo(
    () => Object.values(filters).some((value) => value !== ''),
    [filters],
  );

  function update<K extends keyof FiltersState>(
    key: K,
    value: FiltersState[K],
  ): void {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  const showLoading = status === 'loading' && summary === null;
  const showError = status === 'error' && summary === null;

  return (
    <div className="page">
      <PageHeader
        title="Reportes y análisis"
        description="Indicadores, distribuciones y series calculados con los datos reales de la granja."
        action={
          <Button
            variant="secondary"
            icon={<Icon name="refresh" size={16} />}
            loading={refreshing}
            onClick={handleRefresh}
            disabled={invalidRange}
          >
            Actualizar
          </Button>
        }
      />

      <Card>
        <CardHeader
          title="Filtros del periodo y las categorías"
          description="Se aplican al cambiar. Todas las fechas se interpretan en UTC."
        />
        <div className="toolbar">
          <div className="field toolbar__field">
            <label className="field__label" htmlFor="reports-from">
              Desde
            </label>
            <input
              id="reports-from"
              className="field__input"
              type="date"
              value={filters.from}
              onChange={(event) => update('from', event.target.value)}
            />
          </div>

          <div className="field toolbar__field">
            <label className="field__label" htmlFor="reports-to">
              Hasta
            </label>
            <input
              id="reports-to"
              className="field__input"
              type="date"
              value={filters.to}
              onChange={(event) => update('to', event.target.value)}
            />
          </div>

          <div className="field toolbar__field">
            <label className="field__label" htmlFor="reports-reason">
              Motivo de movimiento
            </label>
            <select
              id="reports-reason"
              className="field__input"
              value={filters.movement_reason}
              onChange={(event) =>
                update('movement_reason', event.target.value as MovementReason | '')
              }
            >
              <option value="">Todos</option>
              {MOVEMENT_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {MOVEMENT_REASON_LABELS[reason]}
                </option>
              ))}
            </select>
          </div>

          <div className="field toolbar__field">
            <label className="field__label" htmlFor="reports-event-type">
              Tipo de evento sanitario
            </label>
            <select
              id="reports-event-type"
              className="field__input"
              value={filters.health_event_type}
              onChange={(event) =>
                update(
                  'health_event_type',
                  event.target.value as HealthEventType | '',
                )
              }
            >
              <option value="">Todos</option>
              {HEALTH_EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {HEALTH_EVENT_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>

          <div className="field toolbar__field">
            <label className="field__label" htmlFor="reports-sex">
              Sexo
            </label>
            <select
              id="reports-sex"
              className="field__input"
              value={filters.sex}
              onChange={(event) =>
                update('sex', event.target.value as AnimalSex | '')
              }
            >
              <option value="">Todos</option>
              {ANIMAL_SEXES.map((sex) => (
                <option key={sex} value={sex}>
                  {ANIMAL_SEX_LABELS[sex]}
                </option>
              ))}
            </select>
          </div>

          <div className="field toolbar__field">
            <label className="field__label" htmlFor="reports-origin">
              Origen
            </label>
            <select
              id="reports-origin"
              className="field__input"
              value={filters.origin}
              onChange={(event) =>
                update('origin', event.target.value as AnimalOrigin | '')
              }
            >
              <option value="">Todos</option>
              {ANIMAL_ORIGINS.map((origin) => (
                <option key={origin} value={origin}>
                  {ANIMAL_ORIGIN_LABELS[origin]}
                </option>
              ))}
            </select>
          </div>

          <Button
            variant="ghost"
            onClick={() => setFilters(EMPTY_FILTERS)}
            disabled={!filtersActive}
          >
            Limpiar
          </Button>
        </div>
        <p className="field__hint">
          El motivo acota la sección de movimientos; el tipo de evento acota la de
          sanidad; el sexo y el origen acotan el inventario de porcinos.
        </p>
      </Card>

      {invalidRange ? (
        <Alert variant="warning" title="Rango de fechas no válido">
          La fecha «Desde» no puede ser posterior a la fecha «Hasta».
        </Alert>
      ) : null}

      {showLoading ? (
        <Card>
          <div className="dashboard-loading" role="status" aria-live="polite">
            <Spinner size={22} />
            <span>Calculando reportes…</span>
          </div>
        </Card>
      ) : null}

      {showError ? (
        <Alert
          variant="danger"
          title="No se pudieron calcular los reportes"
          action={
            <Button variant="secondary" onClick={handleRefresh}>
              Reintentar
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}

      {status === 'error' && summary !== null ? (
        <Alert
          variant="warning"
          title="No se pudo actualizar el resumen"
          action={
            <Button variant="secondary" onClick={handleRefresh}>
              Reintentar
            </Button>
          }
        >
          {error} Se muestran los últimos datos calculados.
        </Alert>
      ) : null}

      {summary ? (
        <>
          {isEmptyFarm(summary) ? (
            <Alert variant="info" title="Base de datos sin registros">
              Todavía no hay porcinos, corrales, movimientos, camadas ni eventos
              sanitarios en el periodo. Los valores en <strong>0</strong> son
              conteos reales, no estimaciones.
            </Alert>
          ) : null}

          <section aria-labelledby="reports-kpi-title" className="section">
            <div className="section__head">
              <h2 id="reports-kpi-title" className="section__title">
                Indicadores
              </h2>
              {status === 'loading' || refreshing ? (
                <span className="section__status" role="status">
                  <Spinner size={12} /> Actualizando…
                </span>
              ) : (
                <span className="section__status section__status--muted">
                  Periodo: {formatCalendarDate(summary.period.from)} –{' '}
                  {formatCalendarDate(summary.period.to)} · Actualizado:{' '}
                  {formatDateTime(summary.generatedAt)}
                </span>
              )}
            </div>

            <div className="stat-grid">
              <StatCard
                label="Porcinos registrados"
                icon="pig"
                value={String(summary.animals.total)}
                hint={`Activos: ${
                  summary.animals.byStatus.find(
                    (item) => item.value === 'active',
                  )?.count ?? 0
                }`}
              />
              <StatCard
                label="Corrales activos"
                icon="areas"
                value={String(summary.pens.total)}
                hint={pensHint(summary)}
              />
              <StatCard
                label="Movimientos del periodo"
                icon="movements"
                value={String(summary.movements.total)}
                hint={`Meses: ${summary.period.months.length}`}
              />
              <StatCard
                label="Eventos sanitarios"
                icon="health"
                value={String(summary.healthEvents.total)}
                hint="Eventos registrados en el periodo."
              />
              <StatCard
                label="Camadas del periodo"
                icon="litters"
                value={String(summary.litters.total)}
                hint={littersHint(summary)}
              />
            </div>
          </section>

          {summary.pens.truncated || summary.litters.truncated ? (
            <Alert variant="warning" title="Datos parciales">
              {summary.pens.truncated
                ? 'La ocupación de corrales alcanzó el límite de exploración: sus cifras y el detalle por corral no son exactos. '
                : ''}
              {summary.litters.truncated
                ? 'Las sumas de nacimientos son parciales porque se alcanzó el límite de camadas exploradas.'
                : ''}
            </Alert>
          ) : null}

          <section aria-labelledby="reports-charts-title" className="section">
            <h2 id="reports-charts-title" className="section__title">
              Gráficos
            </h2>
            <div className="chart-grid">
              <AnimalStatusChart
                byStatus={summary.animals.byStatus.map((item) => ({
                  status: item.value,
                  count: item.count,
                }))}
                total={summary.animals.total}
              />
              <CategoryBarChart
                title="Distribución por sexo"
                description="Inventario de porcinos agrupado por el sexo registrado."
                unit="Porcinos"
                total={summary.animals.total}
                items={summary.animals.bySex.map((item) => ({
                  key: item.value,
                  label: ANIMAL_SEX_LABELS[item.value],
                  count: item.count,
                  color: SEX_COLORS[item.value],
                }))}
                emptyMessage="Aún no hay porcinos registrados."
              />
              <CategoryBarChart
                title="Distribución por origen"
                description="Procedencia registrada de cada porcino (incluye los no registrados)."
                unit="Porcinos"
                total={summary.animals.total}
                items={summary.animals.byOrigin.map((item) => ({
                  key: item.value ?? 'null',
                  label:
                    item.value === null
                      ? 'Sin registrar'
                      : ANIMAL_ORIGIN_LABELS[item.value],
                  count: item.count,
                  color: ORIGIN_COLORS[item.value ?? 'null'],
                }))}
                emptyMessage="Aún no hay porcinos registrados."
              />
              <PensOccupancyChart pens={summary.pens} />
              <MovementsByMonthChart byMonth={summary.movements.byMonth} />
              <CategoryBarChart
                title="Movimientos por motivo"
                description="Conteo de movimientos del periodo según el motivo registrado."
                unit="Movimientos"
                total={summary.movements.total}
                items={summary.movements.byReason.map((item) => ({
                  key: item.value,
                  label: MOVEMENT_REASON_LABELS[item.value],
                  count: item.count,
                }))}
                emptyMessage="No hay movimientos registrados en el periodo."
              />
              <CategoryBarChart
                title="Eventos sanitarios por tipo"
                description="Conteo de eventos sanitarios del periodo según su tipo."
                unit="Eventos"
                total={summary.healthEvents.total}
                items={summary.healthEvents.byType.map((item) => ({
                  key: item.value,
                  label: HEALTH_EVENT_TYPE_LABELS[item.value],
                  count: item.count,
                }))}
                emptyMessage="No hay eventos sanitarios registrados en el periodo."
              />
            </div>
          </section>

          <section aria-labelledby="reports-tables-title" className="section">
            <h2 id="reports-tables-title" className="section__title">
              Detalle
            </h2>
            {summary.litters.total > 0 && !summary.litters.complete ? (
              <p className="chart-note" role="status">
                Algunas camadas no tienen todos los conteos registrados; el
                promedio de nacidos vivos por camada no se calcula.
              </p>
            ) : null}
            <div className="report-grid">
              <PensOccupancyTable pens={summary.pens} />
              <ReportLittersTable litters={summary.litters} />
            </div>
          </section>
        </>
      ) : null}

      <Card>
        <CardHeader
          title="Exportaciones"
          description="El archivo se genera en el servidor con tus permisos y los filtros aplicados; la descarga se inicia al terminar."
        />
        <div className="toolbar">
          <Button
            variant="primary"
            icon={<Icon name="reports" size={16} />}
            loading={exporting === 'excel'}
            disabled={invalidRange || exporting !== null}
            onClick={() => void runExport('excel')}
          >
            Descargar Excel
          </Button>

          <div className="field toolbar__field">
            <label className="field__label" htmlFor="reports-pdf-type">
              Tipo de documento PDF
            </label>
            <select
              id="reports-pdf-type"
              className="field__input"
              value={pdfType}
              onChange={(event) =>
                setPdfType(event.target.value as PdfDocumentType)
              }
              disabled={exporting !== null}
            >
              {PDF_DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {PDF_DOCUMENT_LABELS[type]}
                </option>
              ))}
            </select>
          </div>

          <Button
            variant="secondary"
            icon={<Icon name="reports" size={16} />}
            loading={exporting === 'pdf'}
            disabled={invalidRange || exporting !== null}
            onClick={() => void runExport('pdf')}
          >
            Descargar PDF
          </Button>
        </div>

        {exporting ? (
          <p className="field__hint" role="status" aria-live="polite">
            Generando el archivo… puede tardar unos segundos con muchos datos.
          </p>
        ) : null}

        {exportDone ? (
          <Alert variant="success" title="Descarga iniciada">
            {exportDone}
          </Alert>
        ) : null}

        {exportError ? (
          <Alert variant="danger" title="No se pudo generar la exportación">
            {exportError}
          </Alert>
        ) : null}

        <ul className="placeholder__list">
          <li className="placeholder__item">
            <span className="placeholder__bullet" aria-hidden="true" />
            <span>
              El <strong>Excel integral</strong> reúne hojas de resumen, porcinos,
              movimientos, camadas, sanidad, áreas y corrales, y estadísticas.
            </span>
          </li>
          <li className="placeholder__item">
            <span className="placeholder__bullet" aria-hidden="true" />
            <span>
              Los <strong>documentos PDF</strong> retoman los formatos originales
              de KolkaPig conservando su identidad y su código.
            </span>
          </li>
        </ul>
        <p className="card__footnote">
          <Icon name="info" size={16} /> Respetan los permisos del rol y los
          filtros aplicados, y no exportan datos no autorizados. Cuando el modelo
          de datos no cubre todos los campos de un formato, el documento lo
          indica como «versión adaptada de PigTec».
        </p>
      </Card>

      <Card>
        <CardHeader
          title="Referencia documental de KolkaPig"
          description="Formatos del sistema formal de registros (versión 01) y su relación con PigTec."
        />
        <div className="table-wrapper">
          <table className="data-table">
            <caption className="visually-hidden">
              Formatos de referencia KolkaPig y su estado en PigTec
            </caption>
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Formato de referencia</th>
                <th scope="col">Módulo PigTec</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {REFERENCE_ROWS.map((row) => (
                <tr key={row.code}>
                  <td>
                    <span className="code-chip">{row.code}</span>
                  </td>
                  <td>{row.name}</td>
                  <td>{row.module}</td>
                  <td>
                    <span className={`coverage coverage--${row.coverage}`}>
                      {COVERAGE_LABEL[row.coverage]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="card__footnote">
          <Icon name="info" size={16} /> Los alimentos, medicamentos e insumos
          (KPG-RG-09 y KPG-RG-10) quedan fuera del alcance actual.
        </p>
      </Card>
    </div>
  );
}

/** `true` cuando ninguna seccion tiene registros en el periodo. */
function isEmptyFarm(summary: ReportsSummary): boolean {
  return (
    summary.animals.total === 0 &&
    summary.pens.total === 0 &&
    summary.movements.total === 0 &&
    summary.litters.total === 0 &&
    summary.healthEvents.total === 0
  );
}

/** Texto de apoyo de la ocupacion/capacidad de corrales. */
function pensHint(summary: ReportsSummary): string {
  const { total, occupied, capacity, truncated } = summary.pens;
  if (total === 0) {
    return 'Registra corrales para calcular la ocupación.';
  }
  if (truncated || occupied === null) {
    return `Corrales activos: ${total}. La ocupación no es calculable con los datos actuales.`;
  }
  const occupancy = formatPercent(summary.pens.occupancyRate);
  const base = `Ocupados: ${occupied} de ${total}${occupancy ? ` (${occupancy})` : ''}.`;
  if (capacity.partial) {
    return `${base} Capacidad parcial: no se calcula la utilización.`;
  }
  const usage = formatPercent(capacity.usageRate);
  if (capacity.registered && capacity.total !== null && usage) {
    return `${base} Alojados: ${capacity.housedAnimals ?? 0} de ${capacity.total} de capacidad (${usage}).`;
  }
  return `${base} Sin capacidad registrada.`;
}

/** Texto de apoyo de las camadas del periodo. */
function littersHint(summary: ReportsSummary): string {
  const { total, complete, averageBornAlive, truncated } = summary.litters;
  if (total === 0) {
    return 'Sin camadas en el periodo.';
  }
  if (truncated || !complete) {
    return 'Sumas parciales: faltan conteos en algunas camadas.';
  }
  if (averageBornAlive !== null) {
    return `Promedio: ${averageBornAlive.toFixed(1)} nacidos vivos por camada.`;
  }
  return 'Sin conteos suficientes para el promedio.';
}

/** Marca de tiempo legible (fecha y hora locales) del ultimo calculo. */
function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Estado de cada formato de referencia de KolkaPig frente al modelo de datos
 * actual de PigTec. Es una guia de diseno, NO una funcionalidad implementada.
 */
type Coverage = 'previsto' | 'parcial' | 'fuera-alcance' | 'no-modelo';

const COVERAGE_LABEL: Record<Coverage, string> = {
  previsto: 'Previsto',
  parcial: 'Parcial (según modelo)',
  'fuera-alcance': 'Fuera de alcance',
  'no-modelo': 'No contemplado en el modelo',
};

interface ReferenceRow {
  code: string;
  name: string;
  module: string;
  coverage: Coverage;
}

/**
 * Formatos de referencia del documento KolkaPig "Sistema formal de registros de
 * producción porcina" (versión 01), revisado antes de diseñar el módulo.
 */
const REFERENCE_ROWS: readonly ReferenceRow[] = [
  { code: 'KPG-RG-01', name: 'Identificación individual de reproductores y reemplazos', module: 'Porcinos', coverage: 'previsto' },
  { code: 'KPG-RG-02', name: 'Celo, servicio y gestación', module: 'Reproducción', coverage: 'parcial' },
  { code: 'KPG-RG-03', name: 'Parto, camada e identificación de lechones', module: 'Camadas', coverage: 'previsto' },
  { code: 'KPG-RG-04', name: 'Destete', module: 'Camadas', coverage: 'parcial' },
  { code: 'KPG-RG-05', name: 'Crecimiento y engorde', module: 'Porcinos', coverage: 'parcial' },
  { code: 'KPG-RG-06', name: 'Verraco reproductor', module: 'Porcinos', coverage: 'previsto' },
  { code: 'KPG-RG-07', name: 'Sanidad y tratamientos', module: 'Sanidad', coverage: 'previsto' },
  { code: 'KPG-RG-08', name: 'Vacunación y desparasitación', module: 'Sanidad', coverage: 'previsto' },
  { code: 'KPG-RG-09', name: 'Alimentación diaria por área', module: 'Alimentos', coverage: 'fuera-alcance' },
  { code: 'KPG-RG-10', name: 'Kardex de alimentos e insumos', module: 'Insumos', coverage: 'fuera-alcance' },
  { code: 'KPG-RG-11', name: 'Mortalidad y bajas', module: 'Movimientos', coverage: 'previsto' },
  { code: 'KPG-RG-12', name: 'Ingreso de personas y vehículos', module: 'Bioseguridad', coverage: 'no-modelo' },
  { code: 'KPG-RG-13', name: 'Limpieza y desinfección', module: 'Bioseguridad', coverage: 'no-modelo' },
  { code: 'KPG-RG-14', name: 'Inventario general de animales', module: 'Porcinos', coverage: 'previsto' },
  { code: 'KPG-RG-15', name: 'Ventas, compras y movimientos', module: 'Movimientos', coverage: 'previsto' },
];
