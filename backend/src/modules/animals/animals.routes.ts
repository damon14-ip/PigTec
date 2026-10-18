import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createAuthenticate } from '../auth/authenticate.js';
import { createRequireRole } from '../auth/authorize.js';
import type { ProfileRepository } from '../auth/profile-repository.js';
import { OPERATIONAL_ROLES } from '../auth/roles.js';
import type { TokenVerifier } from '../auth/token-verifier.js';
import { sendDomainError } from '../common/http-errors.js';
import {
  animalIdParamSchema,
  createAnimalSchema,
  listAnimalsQuerySchema,
  updateAnimalSchema,
  updateAnimalStatusSchema,
} from './animals.schemas.js';
import type { AnimalRepository } from './animals.repository.js';
import { createAnimalService } from './animals.service.js';

/**
 * Solo admin y manager realizan el alta oficial directa y la edicion de
 * animales (especificacion maestra, 5.1: el rol `operator` envia solicitudes
 * de alta, que corresponden al flujo pendiente de `animal_registration_requests`).
 */
const ADMIN_MANAGER = ['admin', 'manager'] as const;

export interface AnimalRoutesOptions {
  verifier: TokenVerifier;
  profileRepository: ProfileRepository;
  animalRepository: AnimalRepository;
}

/**
 * Rutas de porcinos.
 *
 * Permisos:
 * - Lectura (GET listado, detalle y ubicacion): roles operativos activos
 *   (admin, manager, operator, veterinarian).
 * - Escritura (POST, PATCH y PATCH de estado): solo admin y manager activos.
 *
 * No hay DELETE: la baja es el estado `inactive` (PATCH /animals/:id/status) y
 * el historial de movimientos no se altera desde este modulo.
 */
export async function animalRoutes(
  app: FastifyInstance,
  options: AnimalRoutesOptions,
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
  const service = createAnimalService(options.animalRepository);

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
    '/animals',
    { preHandler: [authenticate, requireRead] },
    async (request, reply) => {
      const parsed = listAnimalsQuerySchema.safeParse(request.query);
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
    '/animals/:id',
    { preHandler: [authenticate, requireRead] },
    async (request, reply) => {
      const parsed = animalIdParamSchema.safeParse(request.params);
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
    '/animals/:id/location',
    { preHandler: [authenticate, requireRead] },
    async (request, reply) => {
      const parsed = animalIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_params' });
      }

      const token = tokenOf(request, reply);
      if (!token) {
        return reply;
      }

      try {
        return await service.getLocation(parsed.data.id, token);
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );

  app.post(
    '/animals',
    { preHandler: [authenticate, requireWrite] },
    async (request, reply) => {
      const parsed = createAnimalSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body' });
      }

      const token = tokenOf(request, reply);
      const createdBy = request.authUser?.id;
      if (!token || !createdBy) {
        return reply.code(401).send({ error: 'unauthorized' });
      }

      try {
        const animal = await service.create(parsed.data, createdBy, token);
        return reply.code(201).send(animal);
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );

  app.patch(
    '/animals/:id',
    { preHandler: [authenticate, requireWrite] },
    async (request, reply) => {
      const params = animalIdParamSchema.safeParse(request.params);
      const body = updateAnimalSchema.safeParse(request.body);
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

  app.patch(
    '/animals/:id/status',
    { preHandler: [authenticate, requireWrite] },
    async (request, reply) => {
      const params = animalIdParamSchema.safeParse(request.params);
      const body = updateAnimalStatusSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: 'invalid_body' });
      }

      const token = tokenOf(request, reply);
      if (!token) {
        return reply;
      }

      try {
        return await service.updateStatus(params.data.id, body.data.status, token);
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );
}
