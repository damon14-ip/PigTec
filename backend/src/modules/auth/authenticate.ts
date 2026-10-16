import type {
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import type { AuthenticatedUser, TokenVerifier } from './token-verifier.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Identidad autenticada; la define el preHandler `createAuthenticate`. */
    authUser?: AuthenticatedUser;
  }
}

/**
 * Encabezado `Bearer <token>`: esquema sin distinguir mayusculas/minusculas,
 * separado por espacios o tabuladores y seguido de un UNICO token sin espacios.
 * Se ancla al final (`$`) para no aceptar contenido adicional tras el token.
 */
const BEARER_HEADER = /^Bearer[ \t]+(\S+)$/i;

/** Caracteres de control (incluye NUL, saltos de linea y DEL). */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Extrae el token de un encabezado `Authorization: Bearer <token>`.
 * Devuelve `null` si el encabezado falta o esta mal formado.
 *
 * Se exige un unico token no vacio: no admite espacios internos, saltos de
 * linea ni caracteres de control. El esquema `Bearer` no distingue
 * mayusculas/minusculas.
 */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  const match = BEARER_HEADER.exec(header.trim());
  if (!match) {
    return null;
  }

  const token = match[1];
  if (!token || CONTROL_CHARACTERS.test(token)) {
    return null;
  }

  return token;
}

/**
 * Crea un preHandler reutilizable de autenticacion que:
 * 1. extrae el JWT de `Authorization: Bearer`,
 * 2. lo verifica con el `TokenVerifier` inyectado,
 * 3. guarda la identidad verificada en `request.authUser`.
 *
 * Si falta el token, esta mal formado, es invalido o ha expirado, responde
 * HTTP 401 con un cuerpo generico, sin detalles sensibles.
 */
export function createAuthenticate(
  verifier: TokenVerifier,
): preHandlerHookHandler {
  return async function authenticate(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const token = extractBearerToken(request.headers.authorization);

    if (token) {
      try {
        request.authUser = await verifier.verify(token);
        return;
      } catch {
        // Cualquier fallo de verificacion se trata como no autenticado.
      }
    }

    await reply.code(401).send({ error: 'unauthorized' });
  };
}
