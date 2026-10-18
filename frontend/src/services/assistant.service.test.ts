import { describe, expect, it } from 'vitest';
import { ApiError, type ApiClient } from '../lib/http';
import { sendAssistantMessage } from './assistant.service';

interface PostedCall {
  path: string;
  body: unknown;
}

/** Cliente falso que registra las llamadas POST. */
function recordingClient(result: unknown): {
  client: ApiClient;
  calls: PostedCall[];
} {
  const calls: PostedCall[] = [];
  return {
    calls,
    client: {
      get: <T,>() => Promise.reject<T>(new Error('GET no esperado')),
      post: <T,>(path: string, body: unknown) => {
        calls.push({ path, body });
        return Promise.resolve(result as T);
      },
      patch: <T,>() => Promise.reject<T>(new Error('PATCH no esperado')),
      delete: <T,>() => Promise.reject<T>(new Error('DELETE no esperado')),
    },
  };
}

describe('sendAssistantMessage', () => {
  it('envia solo el campo message a POST /assistant/chat', async () => {
    const response = {
      reply: 'Hola',
      usage: null,
      source: 'local',
      quotaRemaining: 4,
    };
    const { client, calls } = recordingClient(response);

    const result = await sendAssistantMessage(client, '¿Qué es PigTec?');

    expect(result).toEqual(response);
    expect(calls).toEqual([
      { path: '/assistant/chat', body: { message: '¿Qué es PigTec?' } },
    ]);
  });

  it('acepta una respuesta con origen "data" y consumo informado', async () => {
    const response = {
      reply: 'Resumen de la granja',
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      source: 'data',
      quotaRemaining: 0,
    };
    const { client } = recordingClient(response);

    await expect(sendAssistantMessage(client, 'resumen')).resolves.toEqual(
      response,
    );
  });

  it('rechaza una respuesta con reply vacio', async () => {
    const { client } = recordingClient({
      reply: '   ',
      usage: null,
      source: 'local',
      quotaRemaining: 1,
    });

    await expect(sendAssistantMessage(client, 'hola')).rejects.toThrow(
      'Respuesta no valida del asistente.',
    );
  });

  it('rechaza un origen desconocido', async () => {
    const { client } = recordingClient({
      reply: 'texto',
      usage: null,
      source: 'otro',
      quotaRemaining: 1,
    });

    await expect(sendAssistantMessage(client, 'hola')).rejects.toThrow(
      'Respuesta no valida del asistente.',
    );
  });

  it('propaga el ApiError del backend (p. ej. cuota agotada)', async () => {
    const client: ApiClient = {
      get: <T,>() => Promise.reject<T>(new Error('GET no esperado')),
      post: <T,>() =>
        Promise.reject<T>(new ApiError(429, 'ai_quota_exceeded', 'x')),
      patch: <T,>() => Promise.reject<T>(new Error('PATCH no esperado')),
      delete: <T,>() => Promise.reject<T>(new Error('DELETE no esperado')),
    };

    await expect(sendAssistantMessage(client, 'hola')).rejects.toMatchObject({
      code: 'ai_quota_exceeded',
    });
  });
});
