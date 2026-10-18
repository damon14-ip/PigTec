import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createAuthenticate } from '../auth/authenticate.js';
import { createRequireRole } from '../auth/authorize.js';
import type { ProfileRepository } from '../auth/profile-repository.js';
import { isOperationalRole, OPERATIONAL_ROLES } from '../auth/roles.js';
import type { TokenVerifier } from '../auth/token-verifier.js';
import { sendDomainError } from '../common/http-errors.js';
import {
  animalIdParamSchema,
  createMovementSchema,
  listAnimalMovementsQuerySchema,
  listMovementsQuerySchema,
  movementIdParamSchema,
} from './movements.schemas.js';
import type { MovementRepository } from './movements.repository.js';
import { createMovementService } from './movements.service.js';

export interface MovementRoutesOptions {
  verifier: TokenVerifier;
  profileRepository: ProfileRepository;
  movementRepository: MovementRepository;
}

/**
 * Rutas de movimientos de porcinos.
 *
 * Permisos generales (RBAC):
 * - Lectura (historial global, detalle e historial por porcino): roles
 *   operativos activos (admin, manager, operator, veterinarian).
 * - Escritura (POST): roles operativos activos, con una restriccion adicional
 *   por MOTIVO aplicada en el servicio (las salidas externas son solo de
 *   admin/manager; el aislamiento sanitario tambien lo registra el veterinario).
 *
 * No existen rutas de actualizacion ni de borrado: el historial es inmutable
 * (no hay PUT/PATCH/DELETE, ni privilegios UPDATE/DELETE en la base).
 */
export async function movementRoutes(
  app: FastifyInstance,
  options: MovementRoutesOptions,
): Promise<void> {
  const authenticate = createAuthenticate(options.verifier);
  const requireRead = createRequireRole({
    repository: options.profileRepository,
    allowedRoles: OPERATIONAL_ROLES,
  });
  const requireWrite = createRequireRole({
    repository: options.profileRepository,
    allowedRoles: OPERATIONAL_ROLES,
  });
  const service = createMovementService(options.movementRepository);

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
    '/movements',
    { preHandler: [authenticate, requireRead] },
    async (request, reply) => {
      const parsed = listMovementsQuerySchema.safeParse(request.query);
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
    '/movements/:id',
    { preHandler: [authenticate, requireRead] },
    async (request, reply) => {
      const parsed = movementIdParamSchema.safeParse(request.params);
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

  app.get(
    '/animals/:id/movements',
    { preHandler: [authenticate, requireRead] },
    async (request, reply) => {
      const params = animalIdParamSchema.safeParse(request.params);
      const query = listAnimalMovementsQuerySchema.safeParse(request.query);
      if (!params.success || !query.success) {
        return reply.code(400).send({ error: 'invalid_query' });
      }

      const token = tokenOf(request, reply);
      if (!token) {
        return reply;
      }

      try {
        return await service.listByAnimal(params.data.id, query.data, token);
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );

  app.post(
    '/movements',
    { preHandler: [authenticate, requireWrite] },
    async (request, reply) => {
      const parsed = createMovementSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body' });
      }

      const token = tokenOf(request, reply);
      const user = request.authUser;
      const profile = request.authProfile;
      if (!token || !user || !profile) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      // `requireWrite` ya lo garantiza; se vuelve a comprobar de forma
      // defensiva para no propagar un rol no operativo a la capa de negocio.
      if (!isOperationalRole(profile.role)) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      try {
        const movement = await service.create(
          parsed.data,
          { id: user.id, role: profile.role },
          token,
        );
        return reply.code(201).send(movement);
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );
}
