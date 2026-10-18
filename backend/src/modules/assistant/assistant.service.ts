import { PIGTEC_SYSTEM_PROMPT } from './assistant.prompt.js';
import { findLocalAnswer } from './assistant.local-answers.js';
import type {
  AssistantCompletion,
  AssistantProvider,
} from './assistant.provider.js';

/**
 * Servicio del asistente.
 *
 * Resuelve primero una respuesta LOCAL determinista (sin costo ni cuota) para
 * preguntas frecuentes; si no la hay, delega en el proveedor (Groq). NO consulta
 * Supabase, no ejecuta SQL, no invoca herramientas ni modifica registros.
 */
export interface AssistantService {
  /**
   * Respuesta local para la pregunta, o `null` si debe consultarse al
   * proveedor. Es determinista y no consume cuota.
   */
  findLocalAnswer(message: string): string | null;
  /** Responde con el proveedor de IA una pregunta ya validada del usuario. */
  ask(message: string): Promise<AssistantCompletion>;
}

export function createAssistantService(
  provider: AssistantProvider,
): AssistantService {
  return {
    findLocalAnswer(message: string): string | null {
      return findLocalAnswer(message);
    },

    ask(message: string): Promise<AssistantCompletion> {
      return provider.complete([
        { role: 'system', content: PIGTEC_SYSTEM_PROMPT },
        { role: 'user', content: message },
      ]);
    },
  };
}
