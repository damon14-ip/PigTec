import type { FastifyInstance } from 'fastify';
import { createAuthenticate } from '../auth/authenticate.js';
import { createRequireRole } from '../auth/authorize.js';
import type { ProfileRepository } from '../auth/profile-repository.js';
import { OPERATIONAL_ROLES } from '../auth/roles.js';
import type { TokenVerifier } from '../auth/token-verifier.js';
import { sendDomainError } from '../common/http-errors.js';
import type { DashboardRepository } from './dashboard.repository.js';
import { createDashboardService } from './dashboard.service.js';

export interface DashboardRoutesOptions {
  verifier: TokenVerifier;
  profileRepository: ProfileRepository;
  dashboardRepository: DashboardRepository;
}

/**
 * Rutas del dashboard.
 *
 * `GET /dashboard/summary` es de SOLO LECTURA y devuelve todos los indicadores
 * del panel en una sola respuesta agregada, calculada en el backend con el JWT
 * del usuario (RLS). Exige un rol operativo ACTIVO (admin, manager, operator o
 * veterinarian); `viewer` y los usuarios inactivos reciben 403.
 *
 * No se expone ningun parametro: los rangos de fecha los determina el servidor,
 * de modo que el cliente no puede forzar consultas arbitrarias.
 */
export async function dashboardRoutes(
  app: FastifyInstance,
  options: DashboardRoutesOptions,
): Promise<void> {
  const authenticate = createAuthenticate(options.verifier);
  const requireRead = createRequireRole({
    repository: options.profileRepository,
    allowedRoles: OPERATIONAL_ROLES,
  });
  const service = createDashboardService(options.dashboardRepository);

  app.get(
    '/dashboard/summary',
    { preHandler: [authenticate, requireRead] },
    async (request, reply) => {
      // El token ya fue verificado por `authenticate`.
      const token = request.authToken;
      if (!token) {
        return reply.code(401).send({ error: 'unauthorized' });
      }

      try {
        return await service.getSummary(token);
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );
}
