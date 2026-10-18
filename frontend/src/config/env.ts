/**
 * Lectura y validacion de las variables de entorno del frontend.
 *
 * Reglas de seguridad:
 * - SOLO se leen variables con prefijo `VITE_` (Vite ignora las demas: no se
 *   pueden filtrar secretos del servidor por accidente).
 * - Nunca se incluye el VALOR de una variable en los mensajes de error, para no
 *   filtrar credenciales en la consola del navegador.
 * - El frontend solo necesita la clave publica `anon` de Supabase. La clave
 *   `service_role` y `GROQ_API_KEY` viven exclusivamente en el backend.
 */

/** Variables de entorno requeridas por la aplicacion. */
export interface AppEnv {
  /** URL base de la API del backend, sin barra final. */
  apiBaseUrl: string;
  /** URL del proyecto Supabase (Auth). */
  supabaseUrl: string;
  /** Clave publica `anon` de Supabase. */
  supabaseAnonKey: string;
}

/** Error de configuracion del entorno del frontend. */
export class EnvError extends Error {
  override readonly name = 'EnvError';
}

const ENV_KEYS = [
  'VITE_API_BASE_URL',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
] as const;

type EnvKey = (typeof ENV_KEYS)[number];

/** Devuelve el valor recortado de una variable, o cadena vacia si falta. */
function readString(source: Record<string, unknown>, key: EnvKey): string {
  const value = source[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** Valida que un valor sea una URL absoluta con protocolo http o https. */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Valida y normaliza las variables de entorno.
 *
 * Recibe la fuente por parametro para poder probarla sin depender de
 * `import.meta.env`. Lanza `EnvError` con un mensaje accionable (sin valores)
 * cuando falta alguna variable o su formato no es valido.
 */
export function readEnv(
  source: Record<string, unknown> = import.meta.env as unknown as Record<
    string,
    unknown
  >,
): AppEnv {
  const apiBaseUrl = readString(source, 'VITE_API_BASE_URL').replace(/\/+$/, '');
  const supabaseUrl = readString(source, 'VITE_SUPABASE_URL').replace(/\/+$/, '');
  const supabaseAnonKey = readString(source, 'VITE_SUPABASE_ANON_KEY');

  const missing = ENV_KEYS.filter((key) => readString(source, key) === '');
  if (missing.length > 0) {
    throw new EnvError(
      'Faltan variables de entorno del frontend: ' +
        `${missing.join(', ')}. ` +
        'Copia frontend/.env.example a frontend/.env.local y completa los valores.',
    );
  }

  if (!isHttpUrl(apiBaseUrl)) {
    throw new EnvError(
      'VITE_API_BASE_URL no es una URL valida (se esperaba http o https).',
    );
  }

  if (!isHttpUrl(supabaseUrl)) {
    throw new EnvError(
      'VITE_SUPABASE_URL no es una URL valida (se esperaba http o https).',
    );
  }

  return { apiBaseUrl, supabaseUrl, supabaseAnonKey };
}
