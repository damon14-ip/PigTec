import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createAuthenticate } from '../auth/authenticate.js';
import { createRequireRole } from '../auth/authorize.js';
import type { ProfileRepository } from '../auth/profile-repository.js';
import { OPERATIONAL_ROLES } from '../auth/roles.js';
import type { TokenVerifier } from '../auth/token-verifier.js';
import { sendDomainError } from '../common/http-errors.js';
import {
  areaIdParamSchema,
  createAreaSchema,
  listAreasQuerySchema,
  updateAreaSchema,
} from './areas.schemas.js';
import type { AreaRepository } from './areas.repository.js';
import { createAreaService } from './areas.service.js';

/** Solo admin y manager administran el catalogo de areas. */
const ADMIN_MANAGER = ['admin', 'manager'] as const;

export interface AreaRoutesOptions {
  verifier: TokenVerifier;
  profileRepository: ProfileRepository;
  areaRepository: AreaRepository;
}

/**
 * Rutas de areas.
 *
 * Permisos:
 * - Lectura (GET): roles operativos activos (admin, manager, operator,
 *   veterinarian). `viewer` e inactivos quedan fuera.
 * - Escritura (POST/PATCH/DELETE): solo admin y manager activos.
 *
 * DELETE es una Baja LOGICA (`status='inactive'`); no elimina la fila, para no
 * comprometer corrales ni registros historicos.
 */
export async function areaRoutes(
  app: FastifyInstance,
  options: AreaRoutesOptions,
): Promise<void> {
  const authenticate = createAuthenticate(options.verifier);
  const requireRead = createRequireRole({
    repository: options.profileRepository,
    allowedRoles: OPERATIONAL_ROLES,
  });
  const requireWrite = createRequireRole({
    repository: options.profileRepository,
    allowedRoles: ADMIN_MANAGER,
  });
  const service = createAreaService(options.areaRepository);

  /** El token ya fue verificado por `authenticate`; si falta, no es autenticado. */
  function tokenOf(request: FastifyRequest, reply: FastifyReply): string | null {
    const token = request.authToken;
    if (!token) {
      reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    return token;
  }

  app.get(
    '/areas',
    { preHandler: [authenticate, requireRead] },
    async (request, reply) => {
      const parsed = listAreasQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_query' });
      }

      const token = tokenOf(request, reply);
      if (!token) {
        return reply;
      }

      try {
        return await service.list(parsed.data, token);
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );

  app.get(
    '/areas/:id',
    { preHandler: [authenticate, requireRead] },
    async (request, reply) => {
      const parsed = areaIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_params' });
      }

      const token = tokenOf(request, reply);
      if (!token) {
        return reply;
      }

      try {
        return await service.getById(parsed.data.id, token);
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );

  app.post(
    '/areas',
    { preHandler: [authenticate, requireWrite] },
    async (request, reply) => {
      const parsed = createAreaSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body' });
      }

      const token = tokenOf(request, reply);
      if (!token) {
        return reply;
      }

      try {
        const area = await service.create(parsed.data, token);
        return reply.code(201).send(area);
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );

  app.patch(
    '/areas/:id',
    { preHandler: [authenticate, requireWrite] },
    async (request, reply) => {
      const params = areaIdParamSchema.safeParse(request.params);
      const body = updateAreaSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: 'invalid_body' });
      }

      const token = tokenOf(request, reply);
      if (!token) {
        return reply;
      }

      try {
        return await service.update(params.data.id, body.data, token);
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );

  app.delete(
    '/areas/:id',
    { preHandler: [authenticate, requireWrite] },
    async (request, reply) => {
      const parsed = areaIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_params' });
      }

      const token = tokenOf(request, reply);
      if (!token) {
        return reply;
      }

      try {
        return await service.deactivate(parsed.data.id, token);
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );
}
