import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import {
  ProfileLookupError,
  type ProfileRepository,
  type UserProfile,
} from '../src/modules/auth/profile-repository.js';
import type { Role } from '../src/modules/auth/roles.js';
import type {
  AuthenticatedUser,
  TokenVerifier,
} from '../src/modules/auth/token-verifier.js';

/** Token falso -> identidad verificada. */
const USERS: Record<string, AuthenticatedUser> = {
  'jwt-admin': { id: 'u-admin' },
  'jwt-manager': { id: 'u-manager' },
  'jwt-operator': { id: 'u-operator' },
  'jwt-vet': { id: 'u-vet' },
  'jwt-viewer': { id: 'u-viewer' },
  'jwt-inactive': { id: 'u-inactive' },
  'jwt-unknown-role': { id: 'u-unknown-role' },
  'jwt-noprofile': { id: 'u-noprofile' },
};

/** Perfiles tal como los devolveria `profiles` (rol y estado de la base). */
const PROFILES: Record<string, UserProfile> = {
  'u-admin': { id: 'u-admin', role: 'admin', isActive: true },
  'u-manager': { id: 'u-manager', role: 'manager', isActive: true },
  'u-operator': { id: 'u-operator', role: 'operator', isActive: true },
  'u-vet': { id: 'u-vet', role: 'veterinarian', isActive: true },
  'u-viewer': { id: 'u-viewer', role: 'viewer', isActive: true },
  'u-inactive': { id: 'u-inactive', role: 'manager', isActive: false },
  // Rol no definido en el sistema: debe denegarse.
  'u-unknown-role': {
    id: 'u-unknown-role',
    role: 'superadmin' as Role,
    isActive: true,
  },
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

function createRepository(
  options: {
    fail?: boolean;
    delayMs?: number;
    profiles?: Record<string, UserProfile>;
  } = {},
): ProfileRepository {
  const profiles = options.profiles ?? PROFILES;

  return {
    findProfileById: vi.fn(async (userId: string, _accessToken: string) => {
      if (options.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
      if (options.fail) {
        throw new ProfileLookupError();
      }
      return profiles[userId] ?? null;
    }),
  };
}

/** App real de produccion con dependencias simuladas (sin red). */
function buildProfileApp(repository: ProfileRepository = createRepository()) {
  return buildApp({
    logger: false,
    tokenVerifier: createVerifier(),
    profileRepository: repository,
  });
}

function getProfile(
  app: ReturnType<typeof buildProfileApp>,
  token?: string,
  extraHeaders: Record<string, string> = {},
  payload?: unknown,
) {
  return app.inject({
    method: 'GET',
    url: '/auth/profile',
    headers: token
      ? { authorization: `Bearer ${token}`, ...extraHeaders }
      : extraHeaders,
    ...(payload ? { payload } : {}),
  });
}

describe('GET /auth/profile: perfil autorizado', () => {
  for (const [token, id, role] of [
    ['jwt-admin', 'u-admin', 'admin'],
    ['jwt-manager', 'u-manager', 'manager'],
    ['jwt-operator', 'u-operator', 'operator'],
    ['jwt-vet', 'u-vet', 'veterinarian'],
  ] as const) {
    it(`devuelve 200 y solo {id, role, is_active} para ${role}`, async () => {
      const app = buildProfileApp();
      const response = await getProfile(app, token);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ id, role, is_active: true });
      // No filtra campos internos.
      expect(response.body).not.toContain('token');
      expect(response.body).not.toContain('email');

      await app.close();
    });
  }
});

describe('GET /auth/profile: autenticacion (401)', () => {
  it('responde 401 sin encabezado Authorization', async () => {
    const app = buildProfileApp();
    const response = await getProfile(app);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthorized' });
    await app.close();
  });

  it('responde 401 con un encabezado mal formado', async () => {
    const app = buildProfileApp();
    const response = await getProfile(app, undefined, {
      authorization: 'Basic abc',
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('responde 401 con un token invalido', async () => {
    const app = buildProfileApp();
    const response = await getProfile(app, 'jwt-inexistente');

    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe('GET /auth/profile: autorizacion (403)', () => {
  it('responde 403 si el usuario no tiene perfil', async () => {
    const app = buildProfileApp();
    const response = await getProfile(app, 'jwt-noprofile');

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'forbidden' });
    await app.close();
  });

  it('responde 403 si el usuario esta inactivo', async () => {
    const app = buildProfileApp();
    const response = await getProfile(app, 'jwt-inactive');

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('responde 403 si el rol es viewer (sin permisos operativos)', async () => {
    const app = buildProfileApp();
    const response = await getProfile(app, 'jwt-viewer');

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('responde 403 si el rol no esta autorizado (desconocido)', async () => {
    const app = buildProfileApp();
    const response = await getProfile(app, 'jwt-unknown-role');

    expect(response.statusCode).toBe(403);
    await app.close();
  });
});

describe('GET /auth/profile: infraestructura (503)', () => {
  it('responde 503 si el repositorio falla y no filtra el detalle', async () => {
    const app = buildProfileApp(createRepository({ fail: true }));
    const response = await getProfile(app, 'jwt-admin');

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'service_unavailable' });
    expect(response.body).not.toContain('perfil');

    await app.close();
  });
});

describe('GET /auth/profile: no acepta rol del cliente', () => {
  it('ignora x-role y el cuerpo: manda el rol de la base', async () => {
    const app = buildProfileApp();

    const forged = await getProfile(
      app,
      'jwt-operator',
      { 'x-role': 'admin' },
      { role: 'admin' },
    );
    const honest = await getProfile(app, 'jwt-admin', { 'x-role': 'viewer' });

    expect(forged.statusCode).toBe(200);
    expect(forged.json()).toEqual({
      id: 'u-operator',
      role: 'operator',
      is_active: true,
    });
    expect(honest.json()).toEqual({
      id: 'u-admin',
      role: 'admin',
      is_active: true,
    });

    await app.close();
  });
});

describe('GET /auth/profile: aislamiento entre solicitudes', () => {
  it('mantiene el perfil correcto bajo solicitudes concurrentes', async () => {
    const app = buildProfileApp(createRepository({ delayMs: 5 }));

    const [admin, manager, operator] = await Promise.all([
      getProfile(app, 'jwt-admin'),
      getProfile(app, 'jwt-manager'),
      getProfile(app, 'jwt-operator'),
    ]);

    expect(admin.json()).toEqual({
      id: 'u-admin',
      role: 'admin',
      is_active: true,
    });
    expect(manager.json()).toEqual({
      id: 'u-manager',
      role: 'manager',
      is_active: true,
    });
    expect(operator.json()).toEqual({
      id: 'u-operator',
      role: 'operator',
      is_active: true,
    });

    await app.close();
  });
});

describe('GET /auth/profile: compatibilidad con las rutas existentes', () => {
  it('mantiene GET /health y GET /auth/me sin cambios', async () => {
    const app = buildProfileApp();

    const health = await app.inject({ method: 'GET', url: '/health' });
    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: 'Bearer jwt-admin' },
    });
    const meNoToken = await app.inject({ method: 'GET', url: '/auth/me' });

    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ id: 'u-admin' });
    expect(meNoToken.statusCode).toBe(401);

    await app.close();
  });
});
