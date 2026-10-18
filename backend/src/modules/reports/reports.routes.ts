import type { FastifyInstance } from 'fastify';
import { createAuthenticate } from '../auth/authenticate.js';
import { createRequireRole } from '../auth/authorize.js';
import type { ProfileRepository } from '../auth/profile-repository.js';
import { OPERATIONAL_ROLES } from '../auth/roles.js';
import type { TokenVerifier } from '../auth/token-verifier.js';
import { sendDomainError } from '../common/http-errors.js';
import type { ReportsRepository } from './reports.repository.js';
import { reportsQuerySchema } from './reports.schemas.js';
import { createReportsService } from './reports.service.js';

export interface ReportsRoutesOptions {
  verifier: TokenVerifier;
  profileRepository: ProfileRepository;
  reportsRepository: ReportsRepository;
}

/**
 * Rutas de reportes y analisis.
 *
 * `GET /reports/summary` es de SOLO LECTURA y devuelve todas las estadisticas en
 * una sola respuesta agregada, calculada en el backend con el JWT del usuario
 * (RLS). Exige un rol operativo ACTIVO (admin, manager, operator o
 * veterinarian); `viewer`, usuarios inactivos y peticiones sin token reciben
 * 401/403.
 *
 * Los parametros de filtro son los mismos que admite el backend en sus endpoints
 * operativos (rango de fechas y categorias reales); el esquema los valida y un
 * valor no previsto se rechaza con 400.
 */
export async function reportsRoutes(
  app: FastifyInstance,
  options: ReportsRoutesOptions,
): Promise<void> {
  const authenticate = createAuthenticate(options.verifier);
  const requireRead = createRequireRole({
    repository: options.profileRepository,
    allowedRoles: OPERATIONAL_ROLES,
  });
  const service = createReportsService(options.reportsRepository);

  app.get(
    '/reports/summary',
    { preHandler: [authenticate, requireRead] },
    async (request, reply) => {
      const parsed = reportsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_query' });
      }

      // El token ya fue verificado por `authenticate`.
      const token = request.authToken;
      if (!token) {
        return reply.code(401).send({ error: 'unauthorized' });
      }

      try {
        return await service.getSummary(parsed.data, token);
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );
}
