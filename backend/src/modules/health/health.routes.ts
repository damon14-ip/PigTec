import type { FastifyInstance } from 'fastify';

/**
 * Rutas de diagnostico del backend.
 * GET /health no depende de la base de datos ni de Supabase.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    return { status: 'ok' };
  });
}
