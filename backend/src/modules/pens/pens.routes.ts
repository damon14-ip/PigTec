import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createAuthenticate } from '../auth/authenticate.js';
import { createRequireRole } from '../auth/authorize.js';
import type { ProfileRepository } from '../auth/profile-repository.js';
import { OPERATIONAL_ROLES } from '../auth/roles.js';
import type { TokenVerifier } from '../auth/token-verifier.js';
import { sendDomainError } from '../common/http-errors.js';
import {
  createPenSchema,
  listPensQuerySchema,
  penIdParamSchema,
  updatePenSchema,
} from './pens.schemas.js';
import type { PenRepository } from './pens.repository.js';
import { createPenService } from './pens.service.js';

/** Solo admin y manager administran el catalogo de corrales. */
const ADMIN_MANAGER = ['admin', 'manager'] as const;

export interface PenRoutesOptions {
  verifier: TokenVerifier;
  profileRepository: ProfileRepository;
  penRepository: PenRepository;
}

/**
 * Rutas de corrales.
 *
 * Permisos:
 * - Lectura (GET): roles operativos activos (admin, manager, operator,
 *   veterinarian). `viewer` e inactivos quedan fuera.
 * - Escritura (POST/PATCH/DELETE): solo admin y manager activos.
 *
 * DELETE es una Baja LOGICA (`status='inactive'`); no elimina la fila, para no
 * comprometer animales ni movimientos historicos. La relacion area-corral se
 * respeta con la FK `pens.area_id -> areas(id)` y el unico `(area_id, code)`.
 */
export async function penRoutes(
  app: FastifyInstance,
  options: PenRoutesOptions,
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
  const service = createPenService(options.penRepository);

  function tokenOf(request: FastifyRequest, reply: FastifyReply): string | null {
    const token = request.authToken;
    if (!token) {
      reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    return token;
  }

  app.get(
    '/pens',
    { preHandler: [authenticate, requireRead] },
    async (request, reply) => {
      const parsed = listPensQuerySchema.safeParse(request.query);
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
    '/pens/:id',
    { preHandler: [authenticate, requireRead] },
    async (request, reply) => {
      const parsed = penIdParamSchema.safeParse(request.params);
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
    '/pens',
    { preHandler: [authenticate, requireWrite] },
    async (request, reply) => {
      const parsed = createPenSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body' });
      }

      const token = tokenOf(request, reply);
      if (!token) {
        return reply;
      }

      try {
        const pen = await service.create(parsed.data, token);
        return reply.code(201).send(pen);
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );

  app.patch(
    '/pens/:id',
    { preHandler: [authenticate, requireWrite] },
    async (request, reply) => {
      const params = penIdParamSchema.safeParse(request.params);
      const body = updatePenSchema.safeParse(request.body);
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
    '/pens/:id',
    { preHandler: [authenticate, requireWrite] },
    async (request, reply) => {
      const parsed = penIdParamSchema.safeParse(request.params);
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
