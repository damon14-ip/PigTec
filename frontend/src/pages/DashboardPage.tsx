import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { NAV_ITEMS } from '../config/navigation';
import { roleLabel } from '../config/roles';
import { useAuth } from '../context/auth-context';
import { describeApiError } from '../lib/http';
import {
  getDashboardSummary,
  type DashboardSummary,
} from '../services/dashboard.service';
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
import { formatMonthLabel, formatPercent } from '../components/dashboard/chart-utils';

type LoadStatus = 'loading' | 'ready' | 'error';

/**
 * Dashboard con indicadores y graficos REALES.
 *
 * Todos los calculos se realizan en el backend (`GET /dashboard/summary`) con el
 * JWT del usuario y RLS. El navegador NO descarga los registros: solo recibe el
 * resumen agregado. No se muestran cifras ficticias: un `0` es un conteo
 * confirmado y una metrica no calculable se muestra como "Sin datos suficientes".
 */
export function DashboardPage() {
  const { profile, apiClient } = useAuth();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const data = await getDashboardSummary(
          apiClient,
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
    [apiClient],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  const modules = NAV_ITEMS.filter(
    (item) =>
      item.key !== 'dashboard' &&
      profile !== null &&
      item.roles.includes(profile.role),
  );

  return (
    <div className="page">
      <PageHeader
        title="Bienvenido a KolkaPig"
        description={
          profile
            ? `Panel de gestión porcina · ${roleLabel(profile.role)}`
            : 'Panel de gestión porcina'
        }
        action={
          <Button
            variant="secondary"
            icon={<Icon name="refresh" size={16} />}
            loading={refreshing}
            onClick={handleRefresh}
            disabled={status === 'loading'}
          >
            Actualizar
          </Button>
        }
      />

      {status === 'loading' ? (
        <Card>
          <div className="dashboard-loading" role="status" aria-live="polite">
            <Spinner size={22} />
            <span>Calculando indicadores…</span>
          </div>
        </Card>
      ) : null}

      {status === 'error' ? (
        <Alert
          variant="danger"
          title="No se pudieron cargar los indicadores"
          action={
            <Button variant="secondary" onClick={handleRefresh}>
              Reintentar
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}

      {status === 'ready' && summary ? (
        <>
          {summary.animals.total === 0 &&
          summary.pens.total === 0 &&
          summary.litters.total === 0 &&
          summary.movements.month === 0 ? (
            <Alert variant="info" title="Base de datos sin registros">
              Todavía no hay porcinos, corrales ni camadas registrados. Los
              valores en <strong>0</strong> son conteos reales, no estimaciones.
            </Alert>
          ) : null}

          <section aria-labelledby="indicadores-title" className="section">
            <div className="section__head">
              <h2 id="indicadores-title" className="section__title">
                Indicadores
              </h2>
              {refreshing ? (
                <span className="section__status" role="status">
                  <Spinner size={12} /> Actualizando…
                </span>
              ) : (
                <span className="section__status section__status--muted">
                  Actualizado: {formatDateTime(summary.generatedAt)}
                </span>
              )}
            </div>

            <div className="stat-grid">
              <StatCard
                label="Porcinos activos"
                icon="pig"
                value={String(summary.animals.active)}
                hint={`Total registrados: ${summary.animals.total}`}
              />
              <StatCard
                label="Ocupación de corrales"
                icon="areas"
                value={formatOccupancy(summary)}
                emptyLabel={pensEmptyLabel(summary)}
                hint={pensHint(summary)}
              />
              <StatCard
                label="Movimientos del mes"
                icon="movements"
                value={String(summary.movements.month)}
                hint={`Mes: ${formatMonthLabel(summary.period.month)}`}
              />
              <StatCard
                label="Eventos sanitarios del mes"
                icon="health"
                value={String(summary.healthEvents.month)}
                hint={`Mes: ${formatMonthLabel(summary.period.month)}`}
              />
              <StatCard
                label="Camadas registradas"
                icon="litters"
                value={String(summary.litters.total)}
                hint={`Este mes: ${summary.litters.month}`}
              />
            </div>
          </section>

          <section aria-labelledby="graficos-title" className="section">
            <h2 id="graficos-title" className="section__title">
              Gráficos
            </h2>
            <div className="chart-grid">
              <AnimalStatusChart
                byStatus={summary.animals.byStatus}
                total={summary.animals.total}
              />
              <PensOccupancyChart pens={summary.pens} />
              <MovementsByMonthChart byMonth={summary.movements.byMonth} />
            </div>
          </section>
        </>
      ) : null}

      <section aria-labelledby="modulos-title" className="section">
        <h2 id="modulos-title" className="section__title">
          Módulos
        </h2>
        <div className="module-grid">
          {modules.map((item) => (
            <Link
              key={item.key}
              to={item.path}
              className="module-link"
              aria-label={`Ir a ${item.label}`}
            >
              <span className="module-link__icon" aria-hidden="true">
                <Icon name={item.icon} size={22} />
              </span>
              <span className="module-link__text">
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
              <Icon name="send" size={16} className="module-link__arrow" />
            </Link>
          ))}
        </div>
      </section>

      <Card>
        <CardHeader
          title="Reportes y análisis"
          description="Módulo planificado para exportaciones y documentos."
        />
        <div className="dashboard-report">
          <p>
            Incluirá un <strong>Excel integral</strong> con hojas para resumen,
            porcinos, movimientos, camadas, sanidad, áreas y corrales, y
            estadísticas, además de <strong>documentos PDF</strong> que modernizan
            los formatos originales de KolkaPig (códigos KPG-RG).
          </p>
          <Link className="btn btn--secondary" to="/reports">
            Ver alcance del módulo
          </Link>
        </div>
      </Card>
    </div>
  );
}

/** Texto del indicador de ocupacion; `null` cuando no es calculable. */
function formatOccupancy(summary: DashboardSummary): string | null {
  const { occupied, total, occupancyRate } = summary.pens;
  if (total === 0 || occupied === null) {
    return null;
  }
  const percent = formatPercent(occupancyRate);
  return percent
    ? `${occupied} de ${total} (${percent})`
    : `${occupied} de ${total}`;
}

/** Etiqueta del estado no calculable de la ocupacion. */
function pensEmptyLabel(summary: DashboardSummary): string {
  return summary.pens.total === 0
    ? 'Sin corrales registrados'
    : 'Sin datos suficientes';
}

/** Texto de apoyo: capacidad registrada y utilizacion, si son calculables. */
function pensHint(summary: DashboardSummary): string {
  const { total, occupied } = summary.pens;
  const {
    registered,
    total: capacity,
    housedAnimals,
    usageRate,
    partial,
  } = summary.pens.capacity;

  if (total === 0) {
    return 'Registra corrales para calcular la ocupación.';
  }
  if (occupied === null) {
    return `Corrales activos: ${total}. La ocupación no es calculable con los datos actuales.`;
  }
  if (registered && partial) {
    // Capacidad incompleta: se informa la suma parcial, SIN porcentaje.
    return `Capacidad parcial: ${capacity ?? 0} porcinos en corrales con capacidad registrada; faltan datos en otros corrales, así que no se calcula el porcentaje.`;
  }
  if (registered && !partial && capacity !== null && housedAnimals !== null) {
    const percent = formatPercent(usageRate);
    return `Alojados: ${housedAnimals} de ${capacity} de capacidad${percent ? ` (${percent})` : ''}.`;
  }
  return `Corrales activos: ${total}. Sin capacidad registrada.`;
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
