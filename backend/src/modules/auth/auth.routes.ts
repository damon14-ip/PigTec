import type { FastifyInstance } from 'fastify';
import { createAuthenticate } from './authenticate.js';
import { createRequireRole } from './authorize.js';
import { OPERATIONAL_ROLES } from './roles.js';
import type { ProfileRepository } from './profile-repository.js';
import type { TokenVerifier } from './token-verifier.js';

export interface AuthRoutesOptions {
  verifier: TokenVerifier;
  /** Acceso de solo lectura a `profiles` (inyectable para pruebas). */
  profileRepository: ProfileRepository;
}

/**
 * Rutas de autenticacion y perfil.
 *
 * - `GET /auth/me`: identidad autenticada basica (`id` y `email` cuando existe).
 *   No incluye rol ni otros datos, y nunca acepta datos desde el cuerpo,
 *   encabezados ni claims sin verificar.
 * - `GET /auth/profile`: perfil propio ya autorizado (`id`, `role`, `is_active`).
 *   Exige autenticacion (S4) y autorizacion (S5) con un rol operativo y perfil
 *   activo. No devuelve el JWT ni datos sensibles.
 */
export async function authRoutes(
  app: FastifyInstance,
  options: AuthRoutesOptions,
): Promise<void> {
  const authenticate = createAuthenticate(options.verifier);
  const requireOperationalRole = createRequireRole({
    repository: options.profileRepository,
    allowedRoles: OPERATIONAL_ROLES,
  });

  app.get('/auth/me', { preHandler: authenticate }, async (request, reply) => {
    const user = request.authUser;

    if (!user) {
      // No deberia ocurrir: el preHandler ya habria respondido 401.
      return reply.code(401).send({ error: 'unauthorized' });
    }

    return user.email ? { id: user.id, email: user.email } : { id: user.id };
  });

  app.get(
    '/auth/profile',
    { preHandler: [authenticate, requireOperationalRole] },
    async (request, reply) => {
      const profile = request.authProfile;

      if (!profile) {
        // No deberia ocurrir: requireOperationalRole ya habria respondido.
        return reply.code(403).send({ error: 'forbidden' });
      }

      // Solo campos seguros: sin JWT, credenciales ni datos internos.
      return { id: profile.id, role: profile.role, is_active: profile.isActive };
    },
  );
}
