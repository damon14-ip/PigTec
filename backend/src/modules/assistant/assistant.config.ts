/**
 * Configuracion del modulo `assistant` (integracion con Groq).
 *
 * La clave y el modelo se leen EXCLUSIVAMENTE de variables de entorno
 * (`GROQ_API_KEY` y `GROQ_MODEL`); nunca se codifican en el fuente, ni se
 * registran, ni se devuelven en respuestas HTTP.
 *
 * Si falta la clave o el modelo, `readAssistantConfig` devuelve `null` y el
 * modulo queda DESHABILITADO (fail-closed): las rutas responden 502 en lugar de
 * llamar al proveedor. Asi no se arranca jamas con una clave vacia ni se inventa
 * un modelo por defecto distinto del configurado.
 */

/** Limite diario por defecto de solicitudes a Groq para todo PigTec. */
export const DEFAULT_DAILY_REQUEST_LIMIT = 20;

/**
 * Tiempo maximo de espera de una respuesta del proveedor (ms).
 * Se aplica con `AbortSignal.timeout`; al superarlo la peticion se aborta y la
 * ruta responde 504, sin reintentos indefinidos.
 */
export const DEFAULT_TIMEOUT_MS = 20_000;

export interface AssistantConfig {
  /** Clave de Groq. SECRETO: nunca se registra ni se devuelve. */
  apiKey: string;
  /** Modelo compatible con la API de OpenAI (p. ej. `openai/gpt-oss-20b`). */
  model: string;
  /** Limite interno de solicitudes diarias (contador en memoria por proceso). */
  dailyRequestLimit: number;
  /** Tiempo maximo de espera de una respuesta del proveedor en milisegundos. */
  timeoutMs: number;
}

/** Recorta y devuelve `null` si el valor falta o queda vacio. */
function trimmed(value: string | undefined): string | null {
  const result = value?.trim();
  return result ? result : null;
}

/**
 * Interpreta `AI_DAILY_REQUEST_LIMIT`. Si falta o no es un entero positivo, se
 * usa el limite por defecto: un valor invalido nunca debe desactivar el limite.
 */
function parseDailyLimit(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_DAILY_REQUEST_LIMIT;
  }

  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_DAILY_REQUEST_LIMIT;
  }

  return parsed;
}

/**
 * Lee la configuracion del asistente desde el entorno.
 *
 * Devuelve `null` (asistente deshabilitado) cuando falta `GROQ_API_KEY` o
 * `GROQ_MODEL`. El objeto devuelto contiene la clave en claro: debe permanecer
 * solo en el servidor y no incluirse en respuestas ni registros.
 */
export function readAssistantConfig(
  source: NodeJS.ProcessEnv = process.env,
): AssistantConfig | null {
  const apiKey = trimmed(source.GROQ_API_KEY);
  const model = trimmed(source.GROQ_MODEL);

  if (!apiKey || !model) {
    return null;
  }

  return {
    apiKey,
    model,
    dailyRequestLimit: parseDailyLimit(source.AI_DAILY_REQUEST_LIMIT),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}
