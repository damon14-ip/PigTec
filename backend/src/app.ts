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

  app.register(healthRoutes);
  app.register(authRoutes, { verifier: tokenVerifier, profileRepository });

  return app;
}
