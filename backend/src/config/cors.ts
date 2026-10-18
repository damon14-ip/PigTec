/**
 * Configuracion de CORS (lista blanca de origenes).
 *
 * El navegador solo puede llamar al backend si el origen del frontend esta en la
 * lista blanca. Reglas:
 * - NUNCA se usa el comodin `*` ni se refleja cualquier origen: permitir
 *   cualquier origen expondria la API a sitios de terceros.
 * - Cada entrada debe ser un origen valido (`esquema://host:puerto`), con
 *   protocolo http o https, sin ruta, consulta ni fragmento.
 *
 * Se configura con la variable de entorno `CORS_ALLOWED_ORIGINS` (lista separada
 * por comas). Los mensajes de error nunca incluyen el valor introducido.
 */

/** Error de configuracion de CORS. */
export class CorsConfigError extends Error {
  override readonly name = 'CorsConfigError';
}

/** Origen de desarrollo por defecto del frontend (servidor Vite). */
export const DEFAULT_CORS_ALLOWED_ORIGINS = 'http://127.0.0.1:5173';

/** Mensaje unico de error, sin valores, reutilizado por el esquema de entorno. */
export const CORS_ALLOWED_ORIGINS_MESSAGE =
  'debe ser una lista separada por comas de origenes http/https validos ' +
  '(sin comodin "*", sin ruta ni barra final)';

/**
 * Normaliza un origen.
 *
 * Devuelve la forma canonica `esquema://host:puerto` (o `esquema://host`), o
 * `null` si el valor no es un origen valido. Se rechaza explicitamente el
 * comodin `*` y cualquier URL con ruta, consulta, fragmento o credenciales.
 */
export function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '*') {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }
  if (url.username !== '' || url.password !== '') {
    return null;
  }
  if (url.search !== '' || url.hash !== '') {
    return null;
  }
  // `new URL('http://host')` produce pathname '/'; se acepta '/' y nada mas.
  if (url.pathname !== '' && url.pathname !== '/') {
    return null;
  }

  return url.origin;
}

/**
 * Divide, valida y normaliza `CORS_ALLOWED_ORIGINS`.
 *
 * Lanza `CorsConfigError` (con un mensaje saneado, sin valores) si alguna
 * entrada no es un origen valido o si la lista queda vacia. Elimina duplicados
 * conservando el orden.
 */
export function parseAllowedOrigins(raw: string): string[] {
  const origins: string[] = [];

  for (const entry of raw.split(',')) {
    const origin = normalizeOrigin(entry);
    if (origin === null) {
      throw new CorsConfigError(
        `CORS_ALLOWED_ORIGINS ${CORS_ALLOWED_ORIGINS_MESSAGE}.`,
      );
    }
    if (!origins.includes(origin)) {
      origins.push(origin);
    }
  }

  if (origins.length === 0) {
    throw new CorsConfigError(
      `CORS_ALLOWED_ORIGINS ${CORS_ALLOWED_ORIGINS_MESSAGE}.`,
    );
  }

  return origins;
}

/** Valida una lista de origenes sin lanzar (para el esquema de entorno). */
export function isValidOriginList(raw: string): boolean {
  try {
    parseAllowedOrigins(raw);
    return true;
  } catch {
    return false;
  }
}
