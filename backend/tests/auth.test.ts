import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { extractBearerToken } from '../src/modules/auth/authenticate.js';
import {
  createSupabaseTokenVerifier,
  type AuthenticatedUser,
  type SupabaseAuthReader,
  type TokenVerifier,
} from '../src/modules/auth/token-verifier.js';

const USERS: Record<string, AuthenticatedUser> = {
  'token-alice': { id: 'uuid-alice', email: 'alice@example.test' },
  'token-bob': { id: 'uuid-bob', email: 'bob@example.test' },
  'token-sin-correo': { id: 'uuid-sin-correo' },
};

/**
 * Verificador falso inyectado. Simula el contrato real: resuelve la identidad
 * para tokens conocidos y lanza para ausentes/invalidos/expirados.
 */
function createFakeVerifier(): TokenVerifier {
  return {
    verify: vi.fn(async (token: string): Promise<AuthenticatedUser> => {
      if (token === 'token-expirado') {
        throw new Error('JWT expired');
      }

      const user = USERS[token];
      if (!user) {
        throw new Error('invalid JWT');
      }

      return user;
    }),
  };
}

function buildAuthApp(verifier: TokenVerifier) {
  return buildApp({ logger: false, tokenVerifier: verifier });
}

async function getMe(
  app: ReturnType<typeof buildApp>,
  authorization?: string,
) {
  return app.inject({
    method: 'GET',
    url: '/auth/me',
    headers: authorization ? { authorization } : {},
  });
}

describe('extractBearerToken', () => {
  it('extrae el token de un encabezado Bearer valido', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('acepta el esquema sin distinguir mayusculas y recorta espacios', () => {
    expect(extractBearerToken('bearer   abc.def.ghi   ')).toBe('abc.def.ghi');
  });

  it('devuelve null si falta el encabezado o esta mal formado', () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken('')).toBeNull();
    expect(extractBearerToken('Basic abc.def.ghi')).toBeNull();
    expect(extractBearerToken('Token abc.def.ghi')).toBeNull();
    expect(extractBearerToken('Bearer')).toBeNull();
    expect(extractBearerToken('Bearer    ')).toBeNull();
    expect(extractBearerToken('abc.def.ghi')).toBeNull();
  });

  it('acepta tabuladores como separador entre esquema y token', () => {
    expect(extractBearerToken('bearer\tabc.def.ghi')).toBe('abc.def.ghi');
  });

  it('rechaza un encabezado con mas de un token (espacios internos)', () => {
    expect(extractBearerToken('Bearer abc def')).toBeNull();
    expect(extractBearerToken('Bearer abc.def.ghi sobrante')).toBeNull();
  });

  it('rechaza saltos de linea dentro del encabezado', () => {
    expect(extractBearerToken('Bearer abc\ndef')).toBeNull();
    expect(extractBearerToken('Bearer\nabc.def.ghi')).toBeNull();
  });

  it('recorta el espacio en blanco alrededor del encabezado', () => {
    expect(extractBearerToken('  Bearer abc.def.ghi\r\n')).toBe('abc.def.ghi');
  });

  it('rechaza caracteres de control en el token', () => {
    expect(extractBearerToken('Bearer abc\u0000def')).toBeNull();
    expect(extractBearerToken('Bearer abc\u007f')).toBeNull();
    expect(extractBearerToken('Bearer \u0007')).toBeNull();
  });
});

describe('GET /health es publico', () => {
  it('responde 200 sin token y sin verificador configurado', async () => {
    const app = buildApp({ logger: false });

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('GET /auth/me', () => {
  it('responde 200 solo con id y email para un token valido', async () => {
    const app = buildAuthApp(createFakeVerifier());

    const response = await getMe(app, 'Bearer token-alice');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: 'uuid-alice',
      email: 'alice@example.test',
    });
  });

  it('omite el email cuando el usuario no lo tiene', async () => {
    const app = buildAuthApp(createFakeVerifier());

    const response = await getMe(app, 'Bearer token-sin-correo');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: 'uuid-sin-correo' });
  });

  it('responde 401 si falta el token', async () => {
    const app = buildAuthApp(createFakeVerifier());

    const response = await getMe(app);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthorized' });
  });

  it('responde 401 si el encabezado esta mal formado', async () => {
    const app = buildAuthApp(createFakeVerifier());

    for (const header of ['Basic abc', 'Token abc', 'Bearer', 'abc.def.ghi']) {
      const response = await getMe(app, header);
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'unauthorized' });
    }
  });

  it('responde 401 si el token es invalido', async () => {
    const app = buildAuthApp(createFakeVerifier());

    const response = await getMe(app, 'Bearer token-desconocido');

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthorized' });
  });

  it('responde 401 si el token ha expirado, sin filtrar el motivo', async () => {
    const app = buildAuthApp(createFakeVerifier());

    const response = await getMe(app, 'Bearer token-expirado');

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthorized' });
    expect(response.body).not.toContain('expired');
    expect(response.body).not.toContain('token-expirado');
  });

  it('no acepta el rol desde el cuerpo ni desde encabezados personalizados', async () => {
    const app = buildAuthApp(createFakeVerifier());

    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: 'Bearer token-alice', 'x-role': 'admin' },
      payload: { role: 'admin' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: 'uuid-alice',
      email: 'alice@example.test',
    });
    expect(response.json()).not.toHaveProperty('role');
  });

  it('responde 401 por defecto si no se inyecta un verificador real (fail-closed)', async () => {
    const app = buildApp({ logger: false });

    const response = await getMe(app, 'Bearer token-alice');

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthorized' });
  });
});

describe('GET /auth/me no mezcla identidades entre solicitudes', () => {
  it('devuelve la identidad correspondiente a cada token', async () => {
    const app = buildAuthApp(createFakeVerifier());

    const alice = await getMe(app, 'Bearer token-alice');
    const bob = await getMe(app, 'Bearer token-bob');
    const another = await getMe(app, 'Bearer token-alice');

    expect(alice.json().id).toBe('uuid-alice');
    expect(bob.json().id).toBe('uuid-bob');
    expect(another.json().id).toBe('uuid-alice');
  });

  it('mantiene la identidad correcta bajo solicitudes concurrentes', async () => {
    const app = buildAuthApp(createFakeVerifier());

    const [alice, bob, sinCorreo] = await Promise.all([
      getMe(app, 'Bearer token-alice'),
      getMe(app, 'Bearer token-bob'),
      getMe(app, 'Bearer token-sin-correo'),
    ]);

    expect(alice.json()).toEqual({
      id: 'uuid-alice',
      email: 'alice@example.test',
    });
    expect(bob.json()).toEqual({ id: 'uuid-bob', email: 'bob@example.test' });
    expect(sinCorreo.json()).toEqual({ id: 'uuid-sin-correo' });
  });
});

describe('createSupabaseTokenVerifier', () => {
  function createReader(result: {
    data: { user: { id: string; email?: string | null } | null };
    error: unknown;
  }): SupabaseAuthReader {
    return { auth: { getUser: vi.fn(async () => result) } };
  }

  it('resuelve la identidad cuando Supabase devuelve un usuario', async () => {
    const verifier = createSupabaseTokenVerifier(
      createReader({
        data: { user: { id: 'uuid-1', email: 'user@example.test' } },
        error: null,
      }),
    );

    await expect(verifier.verify('token')).resolves.toEqual({
      id: 'uuid-1',
      email: 'user@example.test',
    });
  });

  it('valida el token recibido (lo pasa a getUser)', async () => {
    const reader = createReader({
      data: { user: { id: 'uuid-1', email: null } },
      error: null,
    });

    await createSupabaseTokenVerifier(reader).verify('jwt-presentado');

    expect(reader.auth.getUser).toHaveBeenCalledWith('jwt-presentado');
  });

  it('rechaza cuando Supabase devuelve error (p. ej. expirado)', async () => {
    const verifier = createSupabaseTokenVerifier(
      createReader({
        data: { user: null },
        error: { message: 'JWT expired', code: 'token_expired' },
      }),
    );

    await expect(verifier.verify('token-expirado')).rejects.toThrow(
      /Token de acceso invalido o expirado/,
    );
  });

  it('rechaza cuando no hay usuario ni error', async () => {
    const verifier = createSupabaseTokenVerifier(
      createReader({ data: { user: null }, error: null }),
    );

    await expect(verifier.verify('token')).rejects.toThrow(
      /Token de acceso invalido o expirado/,
    );
  });

  function createReaderWithRawUser(
    user: unknown,
    error: unknown = null,
  ): SupabaseAuthReader {
    return {
      auth: { getUser: vi.fn(async () => ({ data: { user }, error })) },
    } as unknown as SupabaseAuthReader;
  }

  it('rechaza un usuario cuyo id no es valido o esta vacio', async () => {
    const invalidUsers: unknown[] = [
      { id: '' },
      { id: '   ' },
      { id: 'id con espacio' },
      { id: 'id\tcon\ttabulador' },
      { id: 'id\u0000nulo' },
      { id: undefined },
      { id: null },
      { id: 42 },
      {},
      'no-es-un-objeto',
    ];

    for (const user of invalidUsers) {
      const verifier = createSupabaseTokenVerifier(
        createReaderWithRawUser(user),
      );

      await expect(verifier.verify('token')).rejects.toThrow(
        /Token de acceso invalido o expirado/,
      );
    }
  });

  it('recorta el id valido antes de exponerlo', async () => {
    const verifier = createSupabaseTokenVerifier(
      createReaderWithRawUser({ id: '  uuid-1  ', email: null }),
    );

    await expect(verifier.verify('token')).resolves.toEqual({ id: 'uuid-1' });
  });

  it('no filtra el token ni el error interno de Supabase', async () => {
    const verifier = createSupabaseTokenVerifier(
      createReader({
        data: { user: null },
        error: { message: 'JWT expired: SUPER-SECRETO', code: 'token_expired' },
      }),
    );

    let caught: unknown;
    try {
      await verifier.verify('token-secretisimo');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).not.toContain('SUPER-SECRETO');
    expect(message).not.toContain('token-secretisimo');
    expect(message).not.toContain('expired');
  });
});
