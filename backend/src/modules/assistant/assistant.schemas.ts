import { z } from 'zod';

/**
 * Esquemas de validacion de entrada del asistente.
 *
 * El cuerpo es estricto (`strictObject`): se rechazan propiedades inesperadas
 * (por ejemplo `model`, `temperature` o `role`), de modo que el cliente no pueda
 * alterar la peticion al proveedor. Solo se acepta `message`.
 */

/** Longitud maxima del mensaje del usuario (caracteres). */
export const MAX_MESSAGE_LENGTH = 2000;

export const chatRequestSchema = z.strictObject({
  // `trim()` primero: un mensaje de solo espacios se rechaza con `.min(1)`.
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});
