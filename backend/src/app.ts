import Fastify, { type FastifyInstance } from 'fastify';
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

export interface BuildAppOptions {
  logger?: boolean;
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

  return app;
}
