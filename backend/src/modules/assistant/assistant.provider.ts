/**
 * Contrato del proveedor de IA del asistente.
 *
 * Se define como interfaz para inyectarlo (inyeccion de dependencias) y poder
 * probar la capa de rutas y servicios con dobles, SIN solicitudes de red. La
 * implementacion real (Groq) vive en `groq.provider.ts`.
 *
 * En esta fase el proveedor SOLO conversa: no consulta Supabase, no ejecuta SQL,
 * no invoca herramientas ni modifica registros.
 */

/** Roles de mensaje aceptados por el proveedor (subconjunto de OpenAI). */
export type AssistantMessageRole = 'system' | 'user';

export interface AssistantMessage {
  role: AssistantMessageRole;
  content: string;
}

/**
 * Consumo de tokens informado por el proveedor.
 * Se expone tal cual al cliente, sin mas detalle del proveedor.
 */
export interface AssistantUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number | null;
}

export interface AssistantCompletion {
  /** Texto del asistente, ya recortado. Nunca vacio. */
  reply: string;
  /** Consumo de tokens, o `null` si el proveedor no lo informo. */
  usage: AssistantUsage | null;
}

/**
 * Categorias de fallo del proveedor. Son las unicas que la capa de rutas
 * traduce a HTTP; el detalle original del proveedor NUNCA se propaga.
 */
export type AssistantFailureKind =
  // El proveedor respondio HTTP 429 (limite de tasa de Groq).
  | 'rate_limited'
  // Se agoto el tiempo de espera o la peticion fue abortada.
  | 'timeout'
  // Respuesta con forma inesperada (JSON invalido o sin texto util).
  | 'invalid_response'
  // Error de red o respuesta HTTP no satisfactoria distinta de 429.
  | 'unavailable';

/**
 * Error controlado del proveedor. El mensaje es generico a proposito: nunca
 * incluye la clave, el cuerpo de la respuesta ni detalles internos.
 */
export class AssistantProviderError extends Error {
  readonly kind: AssistantFailureKind;

  constructor(kind: AssistantFailureKind) {
    super('No se pudo obtener respuesta del proveedor de IA');
    this.name = 'AssistantProviderError';
    this.kind = kind;
  }
}

export interface AssistantProvider {
  /**
   * Envia la conversacion y devuelve la respuesta del asistente.
   * Resuelve un `AssistantCompletion` o lanza `AssistantProviderError`.
   */
  complete(
    messages: readonly AssistantMessage[],
  ): Promise<AssistantCompletion>;
}

/**
 * Proveedor por defecto: siempre falla como no disponible (fail-closed).
 *
 * Evita que un backend sin proveedor real cableado intente conversar. Se usa
 * cuando el asistente esta deshabilitado (falta la clave o el modelo); la ruta
 * responde 502 sin llamar a ningun servicio externo.
 */
export function createRejectingAssistantProvider(): AssistantProvider {
  return {
    async complete(): Promise<AssistantCompletion> {
      throw new AssistantProviderError('unavailable');
    },
  };
}
