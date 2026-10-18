/**
 * Implementacion del proveedor sobre la API de Groq.
 *
 * Groq expone una interfaz compatible con OpenAI (`/openai/v1/chat/completions`).
 * Se usa `fetch` nativo (Node >= 20) en lugar de un SDK: menos dependencias y
 * una unica llamada HTTP que es facil de auditar y de sustituir por un doble en
 * las pruebas.
 *
 * Decisiones de seguridad:
 * - La URL es una constante: nunca se toma del entorno (no hay SSRF).
 * - La clave viaja solo en el encabezado `Authorization`. No se registra, no se
 *   incluye en el cuerpo y no se propaga en los errores.
 * - Los errores se traducen a `AssistantProviderError` con una categoria: nunca
 *   se reenvia el cuerpo ni el mensaje original del proveedor.
 * - Se limita el numero de tokens de salida para acotar costo y latencia.
 */

import {
  AssistantProviderError,
  type AssistantCompletion,
  type AssistantMessage,
  type AssistantProvider,
  type AssistantUsage,
} from './assistant.provider.js';

/** Endpoint compatible con OpenAI de Groq. Constante (no configurable). */
const GROQ_CHAT_COMPLETIONS_URL =
  'https://api.groq.com/openai/v1/chat/completions';

/**
 * Limite de tokens de SALIDA por respuesta. Acota el costo (objetivo: costo de
 * IA en cero) y evita respuestas desproporcionadas.
 */
export const MAX_COMPLETION_TOKENS = 512;

export interface GroqProviderOptions {
  /** Clave de Groq. SECRETO: no se registra ni se devuelve. */
  apiKey: string;
  /** Modelo compatible con OpenAI (p. ej. `openai/gpt-oss-20b`). */
  model: string;
  /** Tiempo maximo de espera de la respuesta (ms). */
  timeoutMs: number;
  /**
   * Implementacion de `fetch`, inyectable para pruebas.
   * Por defecto, la `fetch` global de Node. Las pruebas nunca salen a la red.
   */
  fetchImpl?: typeof fetch;
}

/** Forma (parcial) de la respuesta de Groq que se necesita leer. */
interface GroqResponseBody {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
}

/** Devuelve el entero no negativo o `null` si el valor no es utilizable. */
function readNonNegativeInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

/** Normaliza el bloque `usage` (opcional) de la respuesta. */
function parseUsage(raw: GroqResponseBody['usage']): AssistantUsage | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const promptTokens = readNonNegativeInt(raw.prompt_tokens);
  const completionTokens = readNonNegativeInt(raw.completion_tokens);

  if (promptTokens === null || completionTokens === null) {
    return null;
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens: readNonNegativeInt(raw.total_tokens),
  };
}

/**
 * Indica si el fallo de `fetch` fue por tiempo de espera.
 * `AbortSignal.timeout` lanza un `DOMException` con `name` `TimeoutError` (o
 * `AbortError` en algunos entornos).
 */
function isTimeoutError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('name' in error)) {
    return false;
  }

  const name = (error as { name?: unknown }).name;
  return name === 'TimeoutError' || name === 'AbortError';
}

/**
 * Crea el proveedor de Groq. No realiza ninguna llamada al construirse.
 *
 * Contrato de errores (categoria -> causa):
 * - `rate_limited`: HTTP 429 del proveedor. NO se reintenta.
 * - `timeout`: se agoto `timeoutMs` o la peticion fue abortada.
 * - `invalid_response`: JSON invalido o sin texto util en `choices[0]`.
 * - `unavailable`: error de red o HTTP no satisfactorio distinto de 429.
 */
export function createGroqProvider(
  options: GroqProviderOptions,
): AssistantProvider {
  const doFetch = options.fetchImpl ?? fetch;

  return {
    async complete(
      messages: readonly AssistantMessage[],
    ): Promise<AssistantCompletion> {
      let response: Awaited<ReturnType<typeof fetch>>;

      try {
        response = await doFetch(GROQ_CHAT_COMPLETIONS_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            model: options.model,
            messages,
            max_completion_tokens: MAX_COMPLETION_TOKENS,
          }),
          // Aborta la peticion al superar el tiempo maximo: no se espera
          // indefinidamente a un proveedor que no responde.
          signal: AbortSignal.timeout(options.timeoutMs),
        });
      } catch (error) {
        throw new AssistantProviderError(
          isTimeoutError(error) ? 'timeout' : 'unavailable',
        );
      }

      if (response.status === 429) {
        throw new AssistantProviderError('rate_limited');
      }

      if (!response.ok) {
        throw new AssistantProviderError('unavailable');
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new AssistantProviderError('invalid_response');
      }

      const parsed = body as GroqResponseBody;
      const content = parsed?.choices?.[0]?.message?.content;

      if (typeof content !== 'string' || content.trim() === '') {
        throw new AssistantProviderError('invalid_response');
      }

      return { reply: content.trim(), usage: parseUsage(parsed?.usage) };
    },
  };
}
