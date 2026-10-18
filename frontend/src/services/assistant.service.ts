import type { ApiClient } from '../lib/http';

/**
 * Origen de una respuesta del asistente, tal como lo informa el backend:
 * - `local`: respuesta determinista de la base de conocimiento propia,
 * - `data`: consulta de solo lectura a datos reales del sistema,
 * - `groq`: respuesta generada por el proveedor de IA externo.
 */
export type AssistantSource = 'local' | 'data' | 'groq';

/** Consumo de tokens informado por el proveedor (coincide con el backend). */
export interface AssistantUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number | null;
}

/** Respuesta de `POST /assistant/chat` (contrato exacto del backend). */
export interface AssistantChatResponse {
  reply: string;
  usage: AssistantUsage | null;
  source: AssistantSource;
  quotaRemaining: number;
}

const SOURCES: readonly AssistantSource[] = ['local', 'data', 'groq'];

function isSource(value: unknown): value is AssistantSource {
  return (
    typeof value === 'string' && (SOURCES as readonly string[]).includes(value)
  );
}

/**
 * Comprueba que la respuesta del asistente tiene la forma esperada.
 * Evita mostrar como valida una respuesta inesperada del servidor.
 */
function isChatResponse(value: unknown): value is AssistantChatResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.reply === 'string' &&
    candidate.reply.trim() !== '' &&
    isSource(candidate.source) &&
    typeof candidate.quotaRemaining === 'number'
  );
}

/**
 * Envia un mensaje al asistente con el JWT de la sesion.
 *
 * El asistente es de SOLO LECTURA: este cliente unicamente llama a
 * `POST /assistant/chat`; no ejecuta escrituras ni permite que la interfaz
 * modifique registros de la base de datos.
 */
export async function sendAssistantMessage(
  client: ApiClient,
  message: string,
  options?: { signal?: AbortSignal },
): Promise<AssistantChatResponse> {
  const response = await client.post<unknown>(
    '/assistant/chat',
    { message },
    options,
  );

  if (!isChatResponse(response)) {
    throw new Error('Respuesta no valida del asistente.');
  }

  return response;
}
