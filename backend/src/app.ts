import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { healthRoutes } from './modules/health/health.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import {
  createRejectingTokenVerifier,
  type TokenVerifier,
} from './modules/auth/token-verifier.js';
import {
  createRejectingProfileRepository,
  type ProfileRepository,
} from './modules/auth/profile-repository.js';
import {
  createRejectingAreaRepository,
  type AreaRepository,
} from './modules/areas/areas.repository.js';
import { areaRoutes } from './modules/areas/areas.routes.js';
import {
  createRejectingPenRepository,
  type PenRepository,
} from './modules/pens/pens.repository.js';
import { penRoutes } from './modules/pens/pens.routes.js';
import {
  createRejectingAnimalRepository,
  type AnimalRepository,
} from './modules/animals/animals.repository.js';
import { animalRoutes } from './modules/animals/animals.routes.js';
import {
  createRejectingMovementRepository,
  type MovementRepository,
} from './modules/movements/movements.repository.js';
import { movementRoutes } from './modules/movements/movements.routes.js';
import {
  createRejectingLitterRepository,
  type LitterRepository,
} from './modules/litters/litters.repository.js';
import { litterRoutes } from './modules/litters/litters.routes.js';
import {
  createRejectingHealthEventRepository,
  type HealthEventRepository,
} from './modules/health/health-events.repository.js';
import { healthEventRoutes } from './modules/health/health-events.routes.js';
import {
  createRejectingDashboardRepository,
  type DashboardRepository,
} from './modules/dashboard/dashboard.repository.js';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js';
import {
  createRejectingReportsRepository,
  type ReportsRepository,
} from './modules/reports/reports.repository.js';
import { reportsRoutes } from './modules/reports/reports.routes.js';
import {
  createRejectingReportsExportRepository,
  type ReportsExportRepository,
} from './modules/reports/export/export.repository.js';
import { reportsExportRoutes } from './modules/reports/export/export.routes.js';
import {
  createRejectingAssistantProvider,
  type AssistantProvider,
} from './modules/assistant/assistant.provider.js';
import {
  createInMemoryAssistantQuota,
  type AssistantQuota,
} from './modules/assistant/assistant.quota.js';
import { DEFAULT_DAILY_REQUEST_LIMIT } from './modules/assistant/assistant.config.js';
import { assistantRoutes } from './modules/assistant/assistant.routes.js';

export interface BuildAppOptions {
  logger?: boolean;
  /**
   * Origenes permitidos para CORS (lista blanca). Si se omite o queda vacia, no
   * se habilita CORS (fail-closed): ninguna peticion de navegador cross-origin
   * queda autorizada. Nunca se usa el comodin `*`.
   */
  corsAllowedOrigins?: readonly string[];
  /**
   * Verificador de JWT para las rutas protegidas. Si se omite, se usa un
   * verificador que rechaza todo (fail-closed): ninguna peticion queda
   * autenticada sin un verificador real inyectado.
   */
  tokenVerifier?: TokenVerifier;
  /**
   * Repositorio de perfiles para la autorizacion por rol. Si se omite, se usa
   * uno que no puede comprobar ningun perfil (fail-closed): las rutas que
   * requieren rol responden 503 en lugar de autorizar.
   */
  profileRepository?: ProfileRepository;
  /**
   * Repositorio de areas. Si se omite, se usa uno fail-closed (responde 503).
   * Inyectable para pruebas sin red.
   */
  areaRepository?: AreaRepository;
  /**
   * Repositorio de corrales. Si se omite, se usa uno fail-closed (503).
   * Inyectable para pruebas sin red.
   */
  penRepository?: PenRepository;
  /**
   * Repositorio de porcinos. Si se omite, se usa uno fail-closed (503).
   * Inyectable para pruebas sin red.
   */
  animalRepository?: AnimalRepository;
  /**
   * Repositorio de movimientos. Si se omite, se usa uno fail-closed (503).
   * Inyectable para pruebas sin red.
   */
  movementRepository?: MovementRepository;
  /**
   * Repositorio de camadas. Si se omite, se usa uno fail-closed (503).
   * Inyectable para pruebas sin red.
   */
  litterRepository?: LitterRepository;
  /**
   * Repositorio de eventos sanitarios. Si se omite, se usa uno fail-closed (503).
   * Inyectable para pruebas sin red.
   */
  healthEventRepository?: HealthEventRepository;
  /**
   * Repositorio de lectura agregado del dashboard. Si se omite, se usa uno
   * fail-closed (503). Inyectable para pruebas sin red.
   */
  dashboardRepository?: DashboardRepository;
  /**
   * Repositorio de lectura agregado de reportes. Si se omite, se usa uno
   * fail-closed (503). Inyectable para pruebas sin red.
   */
  reportsRepository?: ReportsRepository;
  /**
   * Repositorio de lectura detallado de exportaciones (Excel/PDF). Si se omite,
   * se usa uno fail-closed (503). Inyectable para pruebas sin red.
   */
  reportsExportRepository?: ReportsExportRepository;
  /**
   * Proveedor de IA del asistente. Si se omite, se usa uno fail-closed que
   * responde 502 (proveedor no disponible). Inyectable para pruebas sin red.
   */
  assistantProvider?: AssistantProvider;
  /**
   * Contador del limite diario de solicitudes de IA. Si se omite, se usa un
   * contador en memoria con el limite por defecto. Inyectable para pruebas.
   */
  assistantQuota?: AssistantQuota;
}

/**
 * Construye la instancia de Fastify con los plugins y rutas registrados.
 * No se conecta a la base de datos ni a Supabase.
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? true,
  });

  const tokenVerifier = options.tokenVerifier ?? createRejectingTokenVerifier();
  const profileRepository =
    options.profileRepository ?? createRejectingProfileRepository();
  const areaRepository =
    options.areaRepository ?? createRejectingAreaRepository();
  const penRepository = options.penRepository ?? createRejectingPenRepository();
  const animalRepository =
    options.animalRepository ?? createRejectingAnimalRepository();
  const movementRepository =
    options.movementRepository ?? createRejectingMovementRepository();
  const litterRepository =
    options.litterRepository ?? createRejectingLitterRepository();
  const healthEventRepository =
    options.healthEventRepository ?? createRejectingHealthEventRepository();
  const dashboardRepository =
    options.dashboardRepository ?? createRejectingDashboardRepository();
  const reportsRepository =
    options.reportsRepository ?? createRejectingReportsRepository();
  const reportsExportRepository =
    options.reportsExportRepository ?? createRejectingReportsExportRepository();
  const assistantProvider =
    options.assistantProvider ?? createRejectingAssistantProvider();
  const assistantQuota =
    options.assistantQuota ??
    createInMemoryAssistantQuota({ limit: DEFAULT_DAILY_REQUEST_LIMIT });

  // CORS: solo se habilita si hay una lista blanca no vacia. Nunca `*`.
  const corsAllowedOrigins = options.corsAllowedOrigins ?? [];
  if (corsAllowedOrigins.length > 0) {
    app.register(cors, {
      origin: [...corsAllowedOrigins],
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Accept', 'Authorization', 'Content-Type'],
      credentials: false,
      maxAge: 600,
    });
  }

  app.register(healthRoutes);
  app.register(authRoutes, { verifier: tokenVerifier, profileRepository });
  app.register(areaRoutes, {
    verifier: tokenVerifier,
    profileRepository,
    areaRepository,
  });
  app.register(penRoutes, {
    verifier: tokenVerifier,
    profileRepository,
    penRepository,
  });
  app.register(animalRoutes, {
    verifier: tokenVerifier,
    profileRepository,
    animalRepository,
  });
  app.register(movementRoutes, {
    verifier: tokenVerifier,
    profileRepository,
    movementRepository,
  });
  app.register(litterRoutes, {
    verifier: tokenVerifier,
    profileRepository,
    litterRepository,
  });
  app.register(healthEventRoutes, {
    verifier: tokenVerifier,
    profileRepository,
    healthEventRepository,
  });
  app.register(dashboardRoutes, {
    verifier: tokenVerifier,
    profileRepository,
    dashboardRepository,
  });
  app.register(reportsRoutes, {
    verifier: tokenVerifier,
    profileRepository,
    reportsRepository,
  });
  app.register(reportsExportRoutes, {
    verifier: tokenVerifier,
    profileRepository,
    reportsRepository,
    reportsExportRepository,
  });
  app.register(assistantRoutes, {
    verifier: tokenVerifier,
    profileRepository,
    provider: assistantProvider,
    quota: assistantQuota,
    animalRepository,
    movementRepository,
    penRepository,
  });

  return app;
}
