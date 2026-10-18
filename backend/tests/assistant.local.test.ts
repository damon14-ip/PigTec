import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import {
  type ProfileRepository,
  type UserProfile,
} from '../src/modules/auth/profile-repository.js';
import type {
  AuthenticatedUser,
  TokenVerifier,
} from '../src/modules/auth/token-verifier.js';
import type {
  AssistantCompletion,
  AssistantMessage,
  AssistantProvider,
} from '../src/modules/assistant/assistant.provider.js';
import {
  createInMemoryAssistantQuota,
  type AssistantQuota,
} from '../src/modules/assistant/assistant.quota.js';
import {
  LOCAL_ANSWER_RULES,
  findLocalAnswer,
  normalizeForMatch,
} from '../src/modules/assistant/assistant.local-answers.js';
import {
  PIGTEC_KNOWLEDGE,
  buildCapabilitySummary,
} from '../src/modules/assistant/assistant.knowledge.js';
import { PIGTEC_SYSTEM_PROMPT } from '../src/modules/assistant/assistant.prompt.js';

/**
 * Pruebas del manual inteligente y de las respuestas locales del asistente.
 *
 * Se cubre: respuestas locales correctas, normalizacion, prevencion de
 * respuestas ante preguntas ambiguas o desconocidas, consumo de cuota SOLO en
 * llamadas reales al proveedor, roles/autenticacion y compatibilidad del
 * contrato HTTP. NUNCA se llama a Groq: el proveedor es un doble.
 */

/* -------------------------------------------------------------------------- */
/* Respuestas locales (unitarias)                                             */
/* -------------------------------------------------------------------------- */

/** Preguntas de ejemplo que DEBEN resolverse localmente y una palabra clave. */
const LOCAL_CASES: Array<[string, string]> = [
  ['¿Qué es PigTec?', 'gestión porcina'],
  ['¿Qué es un área?', 'zona o sector'],
  ['¿Qué es un corral?', 'espacio físico'],
  ['¿Cómo se genera el código de un porcino?', 'PIG-000001'],
  ['¿Qué puede hacer cada rol?', 'operator'],
  ['¿PigTec controla inventarios de alimentos?', 'No.'],
  ['¿Qué módulos tiene PigTec?', 'Inicio de sesión'],
  ['¿Cuáles son los módulos del sistema?', 'Sanidad'],
  ['¿Qué puedo hacer en PigTec?', 'Dashboard'],
  ['¿Qué funcionalidades están disponibles?', 'Exportaciones Excel'],
];

describe('respuestas locales: preguntas frecuentes', () => {
  it.each(LOCAL_CASES)('responde localmente: %s', (question, keyword) => {
    const answer = findLocalAnswer(question);
    expect(answer).not.toBeNull();
    expect(answer).toContain(keyword);
  });

  it('normaliza mayusculas, acentos, signos y espacios sobrantes', () => {
    const variants = [
      '  ¿QUÉ ES PIGTEC?  ',
      'que es pigtec',
      'Que es PigTec???',
      '¿QUE ES PIGTEC!',
    ];

    const expected = findLocalAnswer('que es pigtec');
    for (const variant of variants) {
      expect(findLocalAnswer(variant)).toBe(expected);
    }
  });

  it('la normalizacion elimina acentos y signos de puntuacion', () => {
    expect(normalizeForMatch('¿Cómo se genera el código?')).toBe(
      'como se genera el codigo',
    );
  });

  it('cada regla tiene una respuesta no vacia y un tope de palabras', () => {
    for (const rule of LOCAL_ANSWER_RULES) {
      expect(rule.answer.trim().length).toBeGreaterThan(0);
      expect(rule.maxWords).toBeGreaterThan(0);
      expect(rule.groups.length).toBeGreaterThan(0);
    }
  });

  it('la respuesta de módulos distingue lo disponible de lo pendiente y no ofrece inventarios', () => {
    const answer = findLocalAnswer('¿Cuáles son los módulos del sistema?');

    expect(answer).not.toBeNull();
    expect(answer).toContain('Disponibles hoy');
    expect(answer).toContain('sin pantalla operativa');
    expect(answer).toContain('S5-B');
    expect(answer).toContain('S5-E');
    // El inventario de alimentos sigue fuera de alcance y se dice con claridad.
    expect(answer).toContain('Inventario de alimentos');
    expect(answer).toContain('no existe');
  });
});

describe('respuestas locales: prevencion de falsos positivos', () => {
  it.each([
    ['consulta operativa no cubierta', '¿Cómo registro un porcino?'],
    ['saludo', 'Hola'],
    ['tema general de manejo', '¿Qué comen los cerdos?'],
    ['tema fuera del sistema', '¿Cuál es el precio del maíz?'],
    ['palabra parecida (arete, no area)', '¿Qué es un arete?'],
  ])('%s -> null (va al proveedor)', (_label, question) => {
    expect(findLocalAnswer(question)).toBeNull();
  });

  it('una pregunta compuesta que toca dos temas -> null (ambigua)', () => {
    // Coincide con "que es pigtec" y con inventario de alimentos: ambigua.
    expect(
      findLocalAnswer('¿Qué es PigTec y su inventario de alimentos?'),
    ).toBeNull();
  });

  it('una pregunta demasiado larga -> null aunque contenga una frase clave', () => {
    expect(
      findLocalAnswer(
        '¿Qué es un corral dentro de la granja KolkaPig y cómo se usa en el día a día?',
      ),
    ).toBeNull();
  });

  it('un mensaje vacio o de solo signos -> null', () => {
    expect(findLocalAnswer('')).toBeNull();
    expect(findLocalAnswer('   ')).toBeNull();
    expect(findLocalAnswer('???')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Conocimiento y prompt                                                      */
/* -------------------------------------------------------------------------- */

describe('conocimiento: capacidades y limitaciones', () => {
  it('cubre las secciones acordadas', () => {
    const ids = PIGTEC_KNOWLEDGE.map((section) => section.id);
    expect(ids).toEqual([
      'introduccion',
      'interfaz_web',
      'usuarios_roles',
      'areas_corrales',
      'porcinos',
      'movimientos',
      'camadas',
      'eventos_sanitarios',
      'limitaciones',
    ]);
  });

  it('el resumen NO ofrece el inventario de alimentos como disponible', () => {
    const summary = buildCapabilitySummary();
    const [availablePart, unavailablePart] = summary.split('No disponible hoy');

    expect(unavailablePart).toBeDefined();
    // El inventario de insumos queda fuera de las capacidades disponibles.
    expect(availablePart).not.toContain('Inventario de alimentos');
    expect(unavailablePart).toContain('Inventario de alimentos');
  });

  it('el prompt de sistema incluye capacidades y limitaciones', () => {
    expect(PIGTEC_SYSTEM_PROMPT).toContain('Capacidades disponibles hoy');
    expect(PIGTEC_SYSTEM_PROMPT).toContain('No disponible hoy');
    // No debe quedar larguisimo: es un resumen, no documentacion completa.
    expect(PIGTEC_SYSTEM_PROMPT.length).toBeLessThan(4000);
  });

  it('presenta la aplicación web como disponible y no como inexistente', () => {
    const summary = buildCapabilitySummary();
    const [availablePart] = summary.split('No disponible hoy');

    expect(availablePart).toContain('Aplicación web de PigTec');
    expect(availablePart).toContain('Inicio de sesión web');
    expect(availablePart).toContain('Asistente integrado (chatbot)');
    // Ya no se afirma que el frontend no exista.
    expect(summary).not.toMatch(/frontend[^\n]*no est[áa] implementado/i);
  });

  it('marca las pantallas operativas como pendientes de interfaz', () => {
    const summary = buildCapabilitySummary();
    const pendingIndex = summary.indexOf('SIN pantalla web operativa');
    const unavailableIndex = summary.indexOf('No disponible hoy');

    expect(pendingIndex).toBeGreaterThan(-1);
    expect(unavailableIndex).toBeGreaterThan(pendingIndex);

    const pendingPart = summary.slice(pendingIndex, unavailableIndex);
    expect(pendingPart).toContain('Pantallas operativas de gestión');
    // Las exportaciones no son una pantalla pendiente: están planificadas.
    expect(pendingPart).not.toContain('Exportaciones Excel y PDF');

    const unavailablePart = summary.slice(unavailableIndex);
    expect(unavailablePart).toContain('Exportaciones Excel y PDF');
    expect(unavailablePart).toContain(
      'Indicadores reales y gráficos del dashboard',
    );
  });

  it('el prompt pide lenguaje claro y prohíbe decir que la web no existe', () => {
    expect(PIGTEC_SYSTEM_PROMPT).toContain('la web ya está disponible');
    expect(PIGTEC_SYSTEM_PROMPT).toMatch(/lenguaje comprensible/);
    expect(PIGTEC_SYSTEM_PROMPT).not.toMatch(
      /frontend[^\n]*no est[áa] implementado/i,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Integracion con POST /assistant/chat                                        */
/* -------------------------------------------------------------------------- */

const USERS: Record<string, AuthenticatedUser> = {
  'jwt-admin': { id: 'u-admin' },
  'jwt-manager': { id: 'u-manager' },
  'jwt-operator': { id: 'u-operator' },
  'jwt-vet': { id: 'u-vet' },
  'jwt-viewer': { id: 'u-viewer' },
  'jwt-inactive': { id: 'u-inactive' },
};

const PROFILES: Record<string, UserProfile> = {
  'u-admin': { id: 'u-admin', role: 'admin', isActive: true },
  'u-manager': { id: 'u-manager', role: 'manager', isActive: true },
  'u-operator': { id: 'u-operator', role: 'operator', isActive: true },
  'u-vet': { id: 'u-vet', role: 'veterinarian', isActive: true },
  'u-viewer': { id: 'u-viewer', role: 'viewer', isActive: true },
  'u-inactive': { id: 'u-inactive', role: 'manager', isActive: false },
};

const COMPLETION: AssistantCompletion = {
  reply: 'Respuesta del proveedor.',
  usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
};

function createVerifier(): TokenVerifier {
  return {
    verify: vi.fn(async (token: string): Promise<AuthenticatedUser> => {
      const user = USERS[token];
      if (!user) {
        throw new Error('invalid token');
      }
      return user;
    }),
  };
}

function createProfileRepository(): ProfileRepository {
  return {
    findProfileById: vi.fn(async (userId: string) => PROFILES[userId] ?? null),
  };
}

function spyProvider(
  impl: (messages: readonly AssistantMessage[]) => Promise<AssistantCompletion>,
): { provider: AssistantProvider; complete: ReturnType<typeof vi.fn> } {
  const complete = vi.fn(impl);
  return { provider: { complete } as AssistantProvider, complete };
}

function buildChatApp(
  options: { provider?: AssistantProvider; quota?: AssistantQuota } = {},
) {
  const provider = options.provider ?? spyProvider(async () => COMPLETION).provider;
  const quota = options.quota ?? createInMemoryAssistantQuota({ limit: 20 });

  const app = buildApp({
    logger: false,
    tokenVerifier: createVerifier(),
    profileRepository: createProfileRepository(),
    assistantProvider: provider,
    assistantQuota: quota,
  });

  return { app, provider, quota };
}

function callChat(
  app: ReturnType<typeof buildApp>,
  token?: string,
  payload?: unknown,
) {
  return app.inject({
    method: 'POST',
    url: '/assistant/chat',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload ? { payload } : {}),
  });
}

const LOCAL_QUESTION = '¿Qué es PigTec?';
const GROQ_QUESTION = '¿Cómo registro un porcino?';

describe('POST /assistant/chat: respuestas locales', () => {
  it('responde localmente con source local, usage null y sin llamar al proveedor', async () => {
    const { provider, complete } = spyProvider(async () => COMPLETION);
    const quota = createInMemoryAssistantQuota({ limit: 20 });
    const { app } = buildChatApp({ provider, quota });

    const response = await callChat(app, 'jwt-operator', {
      message: LOCAL_QUESTION,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.source).toBe('local');
    expect(body.usage).toBeNull();
    expect(typeof body.reply).toBe('string');
    expect(body.reply.length).toBeGreaterThan(0);
    // No se descuenta cuota y no se llama a Groq.
    expect(body.quotaRemaining).toBe(20);
    expect(quota.remaining()).toBe(20);
    expect(complete).not.toHaveBeenCalled();
  });

  it('responde localmente la pregunta de módulos sin consumir cuota ni llamar a Groq', async () => {
    const { provider, complete } = spyProvider(async () => COMPLETION);
    const quota = createInMemoryAssistantQuota({ limit: 20 });
    const { app } = buildChatApp({ provider, quota });

    const response = await callChat(app, 'jwt-operator', {
      message: '¿Qué módulos tiene PigTec?',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.source).toBe('local');
    expect(body.usage).toBeNull();
    expect(body.quotaRemaining).toBe(20);
    expect(body.reply).toContain('Inicio de sesión');
    expect(body.reply).toContain('pantalla');
    expect(complete).not.toHaveBeenCalled();
    expect(quota.remaining()).toBe(20);
  });

  it('el contrato HTTP conserva reply, usage, quotaRemaining y agrega source', async () => {
    const { app } = buildChatApp();
    const body = (await callChat(app, 'jwt-admin', { message: LOCAL_QUESTION }))
      .json() as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual([
      'quotaRemaining',
      'reply',
      'source',
      'usage',
    ]);
  });

  it('los cuatro roles operativos obtienen la respuesta local sin consumir cuota', async () => {
    for (const token of ['jwt-admin', 'jwt-manager', 'jwt-operator', 'jwt-vet']) {
      const { provider, complete } = spyProvider(async () => COMPLETION);
      const quota = createInMemoryAssistantQuota({ limit: 5 });
      const { app } = buildChatApp({ provider, quota });

      const response = await callChat(app, token, { message: LOCAL_QUESTION });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ source: 'local', usage: null });
      expect(complete).not.toHaveBeenCalled();
      expect(quota.remaining()).toBe(5);
    }
  });

  it('viewer e inactivo NO reciben la respuesta local (403)', async () => {
    const { provider, complete } = spyProvider(async () => COMPLETION);
    const quota = createInMemoryAssistantQuota({ limit: 5 });
    const { app } = buildChatApp({ provider, quota });

    for (const token of ['jwt-viewer', 'jwt-inactive']) {
      const response = await callChat(app, token, { message: LOCAL_QUESTION });
      expect(response.statusCode).toBe(403);
    }

    expect(complete).not.toHaveBeenCalled();
    expect(quota.remaining()).toBe(5);
  });

  it('sin token -> 401 y no resuelve localmente', async () => {
    const { provider, complete } = spyProvider(async () => COMPLETION);
    const { app } = buildChatApp({ provider });

    const response = await callChat(app, undefined, { message: LOCAL_QUESTION });
    expect(response.statusCode).toBe(401);
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('POST /assistant/chat: cuota', () => {
  it('una pregunta desconocida pasa a Groq, con source groq y consumo de cuota', async () => {
    const { provider, complete } = spyProvider(async () => COMPLETION);
    const quota = createInMemoryAssistantQuota({ limit: 20 });
    const { app } = buildChatApp({ provider, quota });

    const response = await callChat(app, 'jwt-operator', {
      message: GROQ_QUESTION,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      reply: COMPLETION.reply,
      usage: COMPLETION.usage,
      source: 'groq',
      quotaRemaining: 19,
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(quota.remaining()).toBe(19);
  });

  it('una pregunta ambigua tambien pasa a Groq', async () => {
    const { provider, complete } = spyProvider(async () => COMPLETION);
    const { app } = buildChatApp({ provider });

    const response = await callChat(app, 'jwt-operator', {
      message: '¿Qué es PigTec y su inventario de alimentos?',
    });

    expect(response.json()).toMatchObject({ source: 'groq' });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('las respuestas locales siguen funcionando aunque la cuota este agotada', async () => {
    const { provider, complete } = spyProvider(async () => COMPLETION);
    const quota = createInMemoryAssistantQuota({ limit: 1 });
    const { app } = buildChatApp({ provider, quota });

    // Agota la cuota con una pregunta que va al proveedor.
    expect(
      (await callChat(app, 'jwt-admin', { message: GROQ_QUESTION })).statusCode,
    ).toBe(200);
    expect(quota.remaining()).toBe(0);

    // La siguiente pregunta de Groq se rechaza...
    expect(
      (await callChat(app, 'jwt-admin', { message: GROQ_QUESTION })).statusCode,
    ).toBe(429);

    // ...pero la respuesta local no necesita cuota.
    const local = await callChat(app, 'jwt-admin', { message: LOCAL_QUESTION });
    expect(local.statusCode).toBe(200);
    expect(local.json()).toMatchObject({
      source: 'local',
      usage: null,
      quotaRemaining: 0,
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('un cuerpo invalido no gasta cuota ni resuelve localmente', async () => {
    const { provider, complete } = spyProvider(async () => COMPLETION);
    const quota = createInMemoryAssistantQuota({ limit: 1 });
    const { app } = buildChatApp({ provider, quota });

    expect(
      (await callChat(app, 'jwt-operator', { message: '' })).statusCode,
    ).toBe(400);
    expect(
      (await callChat(app, 'jwt-operator', { message: LOCAL_QUESTION, model: 'x' }))
        .statusCode,
    ).toBe(400);

    expect(complete).not.toHaveBeenCalled();
    expect(quota.remaining()).toBe(1);
  });
});
