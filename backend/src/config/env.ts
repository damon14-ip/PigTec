import { z } from 'zod';

/**
 * Reglas de un hostname valido (RFC 1123, simplificado):
 * etiquetas alfanumericas de 1 a 63 caracteres, que pueden contener guiones
 * pero no empezar ni terminar con ellos, separadas por puntos.
 */
const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
const HOSTNAME_MAX_LENGTH = 253;
const LABEL_MAX_LENGTH = 63;

function hasValidHostname(hostname: string): boolean {
  if (hostname.length === 0 || hostname.length > HOSTNAME_MAX_LENGTH) {
    return false;
  }

  return hostname
    .split('.')
    .every(
      (label) =>
        label.length >= 1 &&
        label.length <= LABEL_MAX_LENGTH &&
        HOSTNAME_LABEL.test(label),
    );
}

/**
 * Comprueba que un valor sea una URL absoluta con protocolo HTTPS y hostname
 * valido. `z.url()` por si solo acepta otros protocolos (http, ftp) y URLs con
 * hostname vacio, por lo que no basta para datos de Supabase.
 */
export function isHttpsUrlWithHostname(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  return url.protocol === 'https:' && hasValidHostname(url.hostname);
}

/**
 * Esquema de variables de entorno del backend.
 * Solo describe reglas de validacion; no contiene valores reales.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('127.0.0.1'),
  SUPABASE_URL: z
    .string()
    .min(1)
    .refine(isHttpsUrlWithHostname, {
      message: 'debe ser una URL HTTPS con un hostname valido',
    }),
  SUPABASE_ANON_KEY: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Convierte los errores de Zod en un mensaje legible.
 *
 * Importante: solo se usan el nombre del campo y la descripcion del error.
 * Nunca se incluye el valor introducido, para no filtrar claves ni secretos
 * en los registros del servidor.
 */
export function formatEnvError(error: z.ZodError): string {
  const details = error.issues.map((issue) => {
    const field = issue.path.length > 0 ? issue.path.join('.') : '(raiz)';
    return `  - ${field}: ${issue.message}`;
  });

  return `Configuracion de entorno invalida:\n${details.join('\n')}`;
}

/**
 * Valida un objeto de entorno.
 * Recibe la fuente por parametro para poder probarla sin depender de
 * `process.env` global.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    throw new Error(formatEnvError(result.error));
  }

  return result.data;
}

/**
 * Indica si un error es el de "archivo no encontrado" (ENOENT).
 */
function isEnoentError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

/**
 * Carga un archivo .env local si existe, usando la API nativa de Node.js 22.
 *
 * La ausencia del archivo (ENOENT) no es un error: las variables pueden venir
 * del entorno real del proceso. Cualquier otro fallo de lectura (permisos,
 * contenido invalido, etc.) si se propaga, pero con un mensaje propio y
 * saneado: nunca se reenvia el mensaje original, que podria contener valores
 * del archivo (incluidas credenciales).
 */
export function loadDotEnv(path = '.env'): void {
  try {
    process.loadEnvFile(path);
  } catch (error) {
    if (isEnoentError(error)) {
      return;
    }

    throw new Error(
      `No se pudo leer el archivo de entorno "${path}". ` +
        'Revisa que sea accesible y tenga formato valido.',
    );
  }
}
