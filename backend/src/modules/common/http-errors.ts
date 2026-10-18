import type { FastifyReply } from 'fastify';
import {
  ConflictError,
  ForeignKeyError,
  NotFoundError,
} from './data-errors.js';

/**
 * Traduce un error de dominio a una respuesta HTTP generica.
 *
 * Un error no reconocido se trata como 503 (no se concede la operacion y no se
 * filtra el detalle interno), en linea con el manejo fail-closed del proyecto.
 */
export function sendDomainError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof NotFoundError) {
    return reply.code(404).send({ error: 'not_found' });
  }
  if (error instanceof ConflictError) {
    return reply.code(409).send({ error: 'conflict' });
  }
  if (error instanceof ForeignKeyError) {
    return reply.code(422).send({ error: 'invalid_reference' });
  }

  return reply.code(503).send({ error: 'service_unavailable' });
}
