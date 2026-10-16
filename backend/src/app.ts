import Fastify, { type FastifyInstance } from 'fastify';
import { healthRoutes } from './modules/health/health.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import {
  createRejectingTokenVerifier,
  type TokenVerifier,
} from './modules/auth/token-verifier.js';

export interface BuildAppOptions {
  logger?: boolean;
  /**
   * Verificador de JWT para las rutas protegidas. Si se omite, se usa un
   * verificador que rechaza todo (fail-closed): ninguna peticion queda
   * autenticada sin un verificador real inyectado.
   */
  tokenVerifier?: TokenVerifier;
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

  app.register(healthRoutes);
  app.register(authRoutes, { verifier: tokenVerifier });

  return app;
}
