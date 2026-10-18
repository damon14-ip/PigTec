import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createAuthenticate } from '../auth/authenticate.js';
import { createRequireRole } from '../auth/authorize.js';
import type { ProfileRepository } from '../auth/profile-repository.js';
import { isOperationalRole, OPERATIONAL_ROLES } from '../auth/roles.js';
import type { TokenVerifier } from '../auth/token-verifier.js';
import { sendDomainError } from '../common/http-errors.js';
import {
  animalIdParamSchema,
  createHealthEventSchema,
  healthEventIdParamSchema,
  listAnimalHealthEventsQuerySchema,
  listHealthEventsQuerySchema,
} from './health-events.schemas.js';
import type { HealthEventRepository } from './health-events.repository.js';
import { createHealthEventService } from './health-events.service.js';

export interface HealthEventRoutesOptions {
  verifier: TokenVerifier;
  profileRepository: ProfileRepository;
  healthEventRepository: HealthEventRepository;
}

/**
 * Rutas de eventos sanitarios (modulo S4-C: sanidad).
 *
 * Permisos generales (RBAC):
 * - Lectura (historial global, detalle e historial por porcino): roles
 *   operativos activos (admin, manager, operator, veterinarian).
 * - Escritura (POST): roles operativos activos, con una restriccion adicional
 *   por TIPO de evento aplicada en el servicio: las observaciones/sintomas los
 *   registra cualquier rol operativo; los eventos clinicos, solo el veterinario;
 *   la mortalidad, admin/manager/veterinarian (especificacion 5.1).
 *
 * No existen rutas de actualizacion ni de borrado: el historial sanitario es
 * inmutable (especificacion 5.2 y decision D-09; la migracion 007 no concede
 * privilegio UPDATE ni DELETE). La correccion auditable queda como decision
 * pendiente.
 */
export async function healthEventRoutes(
  app: FastifyInstance,
  options: HealthEventRoutesOptions,
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
  const service = createHealthEventService(options.healthEventRepository);

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
    '/health-events',
    { preHandler: [authenticate, requireRead] },
    async (request, reply) => {
      const parsed = listHealthEventsQuerySchema.safeParse(request.query);
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
    '/health-events/:id',
    { preHandler: [authenticate, requireRead] },
    async (request, reply) => {
      const parsed = healthEventIdParamSchema.safeParse(request.params);
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
    '/animals/:id/health-events',
    { preHandler: [authenticate, requireRead] },
    async (request, reply) => {
      const params = animalIdParamSchema.safeParse(request.params);
      const query = listAnimalHealthEventsQuerySchema.safeParse(request.query);
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
    '/health-events',
    { preHandler: [authenticate, requireWrite] },
    async (request, reply) => {
      const parsed = createHealthEventSchema.safeParse(request.body);
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
        const event = await service.create(
          parsed.data,
          { id: user.id, role: profile.role },
          token,
        );
        return reply.code(201).send(event);
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );
}
