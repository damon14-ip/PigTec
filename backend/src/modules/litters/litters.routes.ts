import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createAuthenticate } from '../auth/authenticate.js';
import { createRequireRole } from '../auth/authorize.js';
import type { ProfileRepository } from '../auth/profile-repository.js';
import { OPERATIONAL_ROLES } from '../auth/roles.js';
import type { TokenVerifier } from '../auth/token-verifier.js';
import { sendDomainError } from '../common/http-errors.js';
import {
  createLitterSchema,
  listLittersQuerySchema,
  litterIdParamSchema,
  updateLitterSchema,
} from './litters.schemas.js';
import type { LitterRepository } from './litters.repository.js';
import { createLitterService } from './litters.service.js';

/**
 * Registro y edicion de camadas: admin, manager y operator activos. Es la misma
 * figura operativa que registra movimientos internos; el nacimiento se captura
 * en campo. El veterinario consulta pero no registra camadas.
 *
 * DECISION PENDIENTE (documentada): la especificacion maestra no fija la matriz
 * de permisos para camadas; se adopta la del trabajo operativo interno y queda
 * sujeta a confirmacion.
 */
const LITTER_WRITE_ROLES = ['admin', 'manager', 'operator'] as const;

export interface LitterRoutesOptions {
  verifier: TokenVerifier;
  profileRepository: ProfileRepository;
  litterRepository: LitterRepository;
}

/**
 * Rutas de camadas (reproduccion).
 *
 * Permisos:
 * - Lectura (GET listado, detalle y crias): roles operativos activos
 *   (admin, manager, operator, veterinarian).
 * - Escritura (POST y PATCH): admin, manager y operator activos.
 *
 * No hay DELETE: las camadas no se eliminan (decision D-09 y migracion 006 sin
 * privilegio ni politica de DELETE). La consulta de crias (GET
 * /litters/:id/offspring) lee `animals` por `litter_id`.
 */
export async function litterRoutes(
  app: FastifyInstance,
  options: LitterRoutesOptions,
): Promise<void> {
  const authenticate = createAuthenticate(options.verifier);
  const requireRead = createRequireRole({
    repository: options.profileRepository,
    allowedRoles: OPERATIONAL_ROLES,
  });
  const requireWrite = createRequireRole({
    repository: options.profileRepository,
    allowedRoles: LITTER_WRITE_ROLES,
  });
  const service = createLitterService(options.litterRepository);

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
    '/litters',
    { preHandler: [authenticate, requireRead] },
    async (request, reply) => {
      const parsed = listLittersQuerySchema.safeParse(request.query);
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
    '/litters/:id',
    { preHandler: [authenticate, requireRead] },
    async (request, reply) => {
      const parsed = litterIdParamSchema.safeParse(request.params);
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
    '/litters/:id/offspring',
    { preHandler: [authenticate, requireRead] },
    async (request, reply) => {
      const parsed = litterIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_params' });
      }

      const token = tokenOf(request, reply);
      if (!token) {
        return reply;
      }

      try {
        return await service.listOffspring(parsed.data.id, token);
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );

  app.post(
    '/litters',
    { preHandler: [authenticate, requireWrite] },
    async (request, reply) => {
      const parsed = createLitterSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body' });
      }

      const token = tokenOf(request, reply);
      if (!token) {
        return reply;
      }

      try {
        const litter = await service.create(parsed.data, token);
        return reply.code(201).send(litter);
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );

  app.patch(
    '/litters/:id',
    { preHandler: [authenticate, requireWrite] },
    async (request, reply) => {
      const params = litterIdParamSchema.safeParse(request.params);
      const body = updateLitterSchema.safeParse(request.body);
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
}
