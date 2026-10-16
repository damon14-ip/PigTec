import Fastify, { type FastifyInstance } from 'fastify';
import { healthRoutes } from './modules/health/health.routes.js';

export interface BuildAppOptions {
  logger?: boolean;
}

/**
 * Construye la instancia de Fastify con los plugins y rutas registrados.
 * No se conecta a la base de datos ni a Supabase.
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? true,
  });

  app.register(healthRoutes);

  return app;
}
