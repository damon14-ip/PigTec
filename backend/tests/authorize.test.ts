import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { createAuthenticate } from '../src/modules/auth/authenticate.js';
import { createRequireRole } from '../src/modules/auth/authorize.js';
import {
  OPERATIONAL_ROLES,
  ROLES,
  isOperationalRole,
  isRole,
  type OperationalRole,
  type Role,
} from '../src/modules/auth/roles.js';
import {
  ProfileLookupError,
  type ProfileRepository,
  type UserProfile,
} from '../src/modules/auth/profile-repository.js';
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
  'jwt-unknown': { id: 'u-unknown' },
};

/** Perfiles tal como los devolveria `profiles` (rol/estado reales de la base). */
const PROFILES: Record<string, UserProfile> = {
  'u-admin': { id: 'u-admin', role: 'admin', isActive: true },
  'u-manager': { id: 'u-manager', role: 'manager', isActive: true },
  'u-operator': { id: 'u-operator', role: 'operator', isActive: true },
  'u-vet': { id: 'u-vet', role: 'veterinarian', isActive: true },
  'u-viewer': { id: 'u-viewer', role: 'viewer', isActive: true },
  'u-inactive': { id: 'u-inactive', role: 'manager', isActive: false },
  // Rol no definido en el sistema (dato corrupto): debe denegarse.
  'u-unknown': { id: 'u-unknown', role: 'superadmin' as Role, isActive: true },
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
  profiles: Record<string, UserProfile> = PROFILES,
  options: { fail?: boolean | Error; delayMs?: number } = {},
): ProfileRepository {
  return {
    findProfileById: vi.fn(async (userId: string, _accessToken: string) => {
      if (options.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
      if (options.fail) {
        throw options.fail === true ? new ProfileLookupError() : options.fail;
      }
      return profiles[userId] ?? null;
    }),
  };
}

/**
 * App de prueba claramente identificada (`/_test/protected`). Compone el
 * preHandler real de autenticacion de S4 con el de autorizacion de S5 y devuelve
 * el perfil autorizado. No forma parte de las rutas de produccion.
 */
function buildProtectedApp(
  allowedRoles: readonly OperationalRole[],
  repository: ProfileRepository = createRepository(),
) {
  const app = Fastify({ logger: false });

  app.get(
    '/_test/protected',
    {
      preHandler: [
        createAuthenticate(createVerifier()),
        createRequireRole({ repository, allowedRoles }),
      ],
    },
    async (request) => ({
      id: request.authProfile?.id,
      role: request.authProfile?.role,
    }),
  );

  return app;
}

function callProtected(
  app: ReturnType<typeof buildProtectedApp>,
  token?: string,
  extraHeaders: Record<string, string> = {},
  payload?: unknown,
) {
  return app.inject({
    method: 'GET',
    url: '/_test/protected',
    headers: token
      ? { authorization: `Bearer ${token}`, ...extraHeaders }
      : extraHeaders,
    ...(payload ? { payload } : {}),
  });
}

/**
 * App de prueba que simula una autenticacion previa que NO guardo el token
 * verificado (situacion anomala). El preHandler de autorizacion debe responder
 * 401: sin token no hay identidad utilizable.
 */
function buildAppWithUserButNoToken(
  repository: ProfileRepository = createRepository(),
) {
  const app = Fastify({ logger: false });

  app.get(
    '/_test/protected',
    {
      preHandler: [
        async (request) => {
          request.authUser = { id: 'u-admin' };
        },
        createRequireRole({ repository, allowedRoles: ['admin'] }),
      ],
    },
    async (request) => ({ id: request.authProfile?.id }),
  );

  return app;
}

describe('roles', () => {
  it('define los cuatro roles funcionales mas el visor heredado', () => {
    expect([...ROLES].sort()).toEqual([
      'admin',
      'manager',
      'operator',
      'veterinarian',
      'viewer',
    ]);
  });

  it('reconoce viewer pero lo excluye de los roles operativos', () => {
    expect(isRole('viewer')).toBe(true);
    expect(isOperationalRole('viewer')).toBe(false);
    expect(OPERATIONAL_ROLES).not.toContain('viewer');
  });

  it('no reconoce roles fuera de la lista', () => {
    expect(isRole('superadmin')).toBe(false);
    expect(isOperationalRole('superadmin')).toBe(false);
  });
});

describe('createRequireRole: permisos por rol', () => {
  it('autoriza a un administrador', async () => {
    const app = buildProtectedApp(['admin']);
    const response = await callProtected(app, 'jwt-admin');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: 'u-admin', role: 'admin' });
    await app.close();
  });

  it('autoriza a un manager cuando la operacion lo admite', async () => {
    const app = buildProtectedApp(['manager', 'admin']);
    const response = await callProtected(app, 'jwt-manager');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: 'u-manager', role: 'manager' });
    await app.close();
  });

  it('autoriza a un operator solo en las operaciones que lo incluyen', async () => {
    const allowed = buildProtectedApp(['operator', 'manager', 'admin']);
    const denied = buildProtectedApp(['manager', 'admin']);

    const ok = await callProtected(allowed, 'jwt-operator');
    const forbidden = await callProtected(denied, 'jwt-operator');

    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ id: 'u-operator', role: 'operator' });
    expect(forbidden.statusCode).toBe(403);

    await allowed.close();
    await denied.close();
  });

  it('autoriza a un veterinarian solo en operaciones clinicas', async () => {
    const clinical = buildProtectedApp(['veterinarian', 'admin']);
    const operational = buildProtectedApp(['operator', 'manager', 'admin']);

    const ok = await callProtected(clinical, 'jwt-vet');
    const forbidden = await callProtected(operational, 'jwt-vet');

    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ id: 'u-vet', role: 'veterinarian' });
    expect(forbidden.statusCode).toBe(403);

    await clinical.close();
    await operational.close();
  });

  it('deniega a viewer aunque se autoricen todos los roles operativos', async () => {
    const app = buildProtectedApp(OPERATIONAL_ROLES);
    const response = await callProtected(app, 'jwt-viewer');

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'forbidden' });
    await app.close();
  });
});

describe('createRequireRole: estado y perfil', () => {
  it('deniega a un usuario inactivo aunque su rol este permitido', async () => {
    const app = buildProtectedApp(['manager', 'admin']);
    const response = await callProtected(app, 'jwt-inactive');

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('deniega a un usuario sin perfil asociado', async () => {
    const app = buildProtectedApp(['admin'], createRepository({}));
    const response = await callProtected(app, 'jwt-admin');

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'forbidden' });
    await app.close();
  });

  it('deniega un rol desconocido devuelto por la base', async () => {
    const app = buildProtectedApp(OPERATIONAL_ROLES);
    const response = await callProtected(app, 'jwt-unknown');

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'forbidden' });
    await app.close();
  });
});

describe('createRequireRole: autenticacion previa (401)', () => {
  it('responde 401 sin encabezado Authorization', async () => {
    const app = buildProtectedApp(['admin']);
    const response = await callProtected(app);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthorized' });
    await app.close();
  });

  it('responde 401 con un encabezado mal formado', async () => {
    const app = buildProtectedApp(['admin']);
    const response = await callProtected(app, undefined, {
      authorization: 'Basic abc',
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('responde 401 con un token invalido', async () => {
    const app = buildProtectedApp(['admin']);
    const response = await callProtected(app, 'jwt-inexistente');

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('responde 401 si una autenticacion previa no dejo token verificado', async () => {
    const app = buildAppWithUserButNoToken();
    const response = await app.inject({
      method: 'GET',
      url: '/_test/protected',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthorized' });
    await app.close();
  });
});

describe('createRequireRole: no acepta el rol desde el cliente', () => {
  it('ignora x-role y el cuerpo: manda el rol de la base', async () => {
    const app = buildProtectedApp(['admin']);

    const forged = await callProtected(
      app,
      'jwt-operator',
      { 'x-role': 'admin' },
      { role: 'admin' },
    );
    const honest = await callProtected(app, 'jwt-admin', { 'x-role': 'operator' });

    expect(forged.statusCode).toBe(403);
    expect(forged.json()).toEqual({ error: 'forbidden' });
    expect(honest.statusCode).toBe(200);
    expect(honest.json()).toEqual({ id: 'u-admin', role: 'admin' });

    await app.close();
  });
});

describe('createRequireRole: aislamiento entre solicitudes', () => {
  it('cada peticion obtiene su propio perfil', async () => {
    const app = buildProtectedApp(OPERATIONAL_ROLES);

    const admin = await callProtected(app, 'jwt-admin');
    const manager = await callProtected(app, 'jwt-manager');
    const operator = await callProtected(app, 'jwt-operator');

    expect(admin.json()).toEqual({ id: 'u-admin', role: 'admin' });
    expect(manager.json()).toEqual({ id: 'u-manager', role: 'manager' });
    expect(operator.json()).toEqual({ id: 'u-operator', role: 'operator' });

    await app.close();
  });

  it('mantiene el perfil correcto bajo solicitudes concurrentes', async () => {
    // Un pequeño retardo fuerza el solapamiento entre peticiones.
    const app = buildProtectedApp(
      OPERATIONAL_ROLES,
      createRepository(PROFILES, { delayMs: 5 }),
    );

    const [admin, manager, operator] = await Promise.all([
      callProtected(app, 'jwt-admin'),
      callProtected(app, 'jwt-manager'),
      callProtected(app, 'jwt-operator'),
    ]);

    expect(admin.json()).toEqual({ id: 'u-admin', role: 'admin' });
    expect(manager.json()).toEqual({ id: 'u-manager', role: 'manager' });
    expect(operator.json()).toEqual({ id: 'u-operator', role: 'operator' });

    await app.close();
  });
});

describe('createRequireRole: diferenciacion de denegaciones', () => {
  it('responde 403 cuando el usuario autenticado no tiene perfil', async () => {
    const app = buildProtectedApp(['admin'], createRepository({}));
    const response = await callProtected(app, 'jwt-admin');

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'forbidden' });
    await app.close();
  });

  it('responde 403 cuando el usuario esta inactivo', async () => {
    const app = buildProtectedApp(['manager', 'admin']);
    const response = await callProtected(app, 'jwt-inactive');

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'forbidden' });
    await app.close();
  });

  it('responde 503 cuando falla la consulta (ProfileLookupError)', async () => {
    const app = buildProtectedApp(
      ['admin'],
      createRepository(PROFILES, { fail: true }),
    );
    const response = await callProtected(app, 'jwt-admin');

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'service_unavailable' });
    await app.close();
  });

  it('responde 503 ante cualquier error del repositorio, sin filtrar el detalle', async () => {
    const app = buildProtectedApp(
      ['admin'],
      createRepository(PROFILES, {
        fail: new Error('detalle interno sensible token=secreto'),
      }),
    );
    const response = await callProtected(app, 'jwt-admin');

    // Fail-closed: no se concede acceso y no se revela el motivo interno.
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'service_unavailable' });
    expect(response.body).not.toContain('detalle interno');
    expect(response.body).not.toContain('secreto');

    await app.close();
  });
});
