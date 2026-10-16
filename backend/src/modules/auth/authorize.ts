import type {
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { isOperationalRole, type OperationalRole } from './roles.js';
import type { ProfileRepository, UserProfile } from './profile-repository.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Perfil autorizado de la peticion; lo define `createRequireRole`. */
    authProfile?: UserProfile;
  }
}

export interface RequireRoleOptions {
  /** Acceso de solo lectura a `profiles` (inyectable para pruebas). */
  repository: ProfileRepository;
  /**
   * Roles operativos autorizados para la operacion concreta.
   *
   * Solo admite roles operativos: `viewer` jamas puede autorizarse por error.
   */
  allowedRoles: readonly OperationalRole[];
}

/**
 * Crea un preHandler de autorizacion reutilizable.
 *
 * Debe ejecutarse DESPUES de `createAuthenticate`: depende de que existan
 * `request.authUser` (identidad verificada) y `request.authToken` (JWT).
 *
 * Comprueba, en orden:
 * 1. Autenticacion previa: sin identidad o sin token -> HTTP 401.
 * 2. Perfil asociado, activo y con rol autorizado -> si no, HTTP 403.
 * 3. Fallo de infraestructura al comprobar el perfil -> HTTP 503 (denegado).
 *
 * Es de SOLO LECTURA y fail-closed: nunca escribe en `profiles` ni acepta el rol
 * desde el cliente. El rol se lee de la base con el JWT del usuario (RLS). Ante
 * cualquier incertidumbre (perfil ausente, inactivo, rol desconocido o error de
 * consulta) NUNCA se concede permiso.
 */
export function createRequireRole(
  options: RequireRoleOptions,
): preHandlerHookHandler {
  const allowed = new Set<string>(options.allowedRoles);

  return async function requireRole(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const user = request.authUser;
    const accessToken = request.authToken;

    // La autenticacion previa es obligatoria.
    if (!user || !accessToken) {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }

    let profile: UserProfile | null;
    try {
      profile = await options.repository.findProfileById(user.id, accessToken);
    } catch {
      // Fallo de infraestructura (p. ej. Supabase no responde): no se puede
      // comprobar el perfil. Se deniega con un mensaje generico, sin detalles.
      await reply.code(503).send({ error: 'service_unavailable' });
      return;
    }

    if (
      !profile ||
      !profile.isActive ||
      !isOperationalRole(profile.role) ||
      !allowed.has(profile.role)
    ) {
      await reply.code(403).send({ error: 'forbidden' });
      return;
    }

    request.authProfile = profile;
  };
}
