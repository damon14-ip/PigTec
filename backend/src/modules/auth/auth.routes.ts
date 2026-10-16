import type { FastifyInstance } from 'fastify';
import { createAuthenticate } from './authenticate.js';
import type { TokenVerifier } from './token-verifier.js';

export interface AuthRoutesOptions {
  verifier: TokenVerifier;
}

/**
 * Rutas de autenticacion.
 *
 * `GET /auth/me` responde unicamente con la identidad autenticada basica
 * (`id` y `email` cuando existe). El rol u otros datos no se incluyen y nunca
 * se aceptan desde el cuerpo, encabezados ni claims sin verificar.
 */
export async function authRoutes(
  app: FastifyInstance,
  options: AuthRoutesOptions,
): Promise<void> {
  const authenticate = createAuthenticate(options.verifier);

  app.get('/auth/me', { preHandler: authenticate }, async (request, reply) => {
    const user = request.authUser;

    if (!user) {
      // No deberia ocurrir: el preHandler ya habria respondido 401.
      return reply.code(401).send({ error: 'unauthorized' });
    }

    return user.email ? { id: user.id, email: user.email } : { id: user.id };
  });
}
