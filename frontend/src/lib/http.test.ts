import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, describeApiError } from './http';

/** Respuesta falsa compatible con el subconjunto de `Response` que se usa. */
function fakeResponse(status: number, body?: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => {
      if (body === undefined) {
        throw new Error('respuesta sin cuerpo');
      }
      return body;
    },
  } as unknown as Response;
}

type FetchHandler = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/** Respuesta falsa de archivo: `blob` + cabeceras de descarga. */
function fakeFileResponse(
  status: number,
  options: {
    body?: Blob;
    headers?: Record<string, string>;
    jsonBody?: unknown;
  } = {},
): Response {
  const headers = options.headers ?? {};
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => headers[name] ?? null },
    blob: async () => options.body ?? new Blob(['contenido']),
    json: async () => {
      if (options.jsonBody === undefined) {
        throw new Error('respuesta sin cuerpo');
      }
      return options.jsonBody;
    },
  } as unknown as Response;
}

/** `fetch` falso tipado: las llamadas quedan registradas con sus argumentos. */
function createFetchMock(handler: FetchHandler) {
  return vi.fn(handler);
}

describe('createApiClient', () => {
  it('construye la URL con la base y anade el encabezado Bearer', async () => {
    const fetchImpl = createFetchMock(async () => fakeResponse(200, { ok: true }));
    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:3000/',
      getAccessToken: () => 'jwt-de-prueba',
      fetchImpl,
    });

    await client.get('/auth/profile');

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3000/auth/profile');
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer jwt-de-prueba',
    );
  });

  it('no envia Authorization cuando no hay sesion', async () => {
    const fetchImpl = createFetchMock(async () => fakeResponse(200, {}));
    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      getAccessToken: () => null,
      fetchImpl,
    });

    await client.get('/health');

    const [, init] = fetchImpl.mock.calls[0];
    expect(
      (init?.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
  });

  it('serializa el cuerpo como JSON en POST', async () => {
    const fetchImpl = createFetchMock(async () =>
      fakeResponse(200, { reply: 'ok' }),
    );
    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      fetchImpl,
    });

    await client.post('/assistant/chat', { message: 'hola' });

    const [, init] = fetchImpl.mock.calls[0];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ message: 'hola' }));
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
  });

  it('serializa el cuerpo como JSON en PATCH', async () => {
    const fetchImpl = createFetchMock(async () => fakeResponse(200, {}));
    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      fetchImpl,
    });

    await client.patch('/areas/abc', { name: 'Nave 1' });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3000/areas/abc');
    expect(init?.method).toBe('PATCH');
    expect(init?.body).toBe(JSON.stringify({ name: 'Nave 1' }));
  });

  it('envia DELETE sin cuerpo', async () => {
    const fetchImpl = createFetchMock(async () => fakeResponse(200, {}));
    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      fetchImpl,
    });

    await client.delete('/pens/abc');

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3000/pens/abc');
    expect(init?.method).toBe('DELETE');
    expect(init?.body).toBeUndefined();
  });

  it('convierte un HTTP 401 en ApiError y avisa una vez', async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = createFetchMock(async () =>
      fakeResponse(401, { error: 'unauthorized' }),
    );
    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      onUnauthorized,
      fetchImpl,
    });

    await expect(client.get('/auth/profile')).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
    });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('propaga el codigo de error del backend', async () => {
    const fetchImpl = createFetchMock(async () =>
      fakeResponse(403, { error: 'forbidden' }),
    );
    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      fetchImpl,
    });

    await expect(client.get('/auth/profile')).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
    });
  });

  it('trata un fallo de red como ApiError con estado 0', async () => {
    const fetchImpl = createFetchMock(async () => {
      throw new TypeError('failed to fetch');
    });
    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      fetchImpl,
    });

    await expect(client.get('/health')).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
    });
  });

  it('devuelve undefined en una respuesta 204 sin cuerpo', async () => {
    const fetchImpl = createFetchMock(async () => fakeResponse(204));
    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      fetchImpl,
    });

    await expect(client.get('/areas/x')).resolves.toBeUndefined();
  });

  it('usa un codigo generico si el cuerpo de error no es JSON', async () => {
    const fetchImpl = createFetchMock(async () => fakeResponse(500, undefined));
    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      fetchImpl,
    });

    await expect(client.get('/health')).rejects.toMatchObject({
      code: 'http_500',
    });
  });
});

describe('createApiClient: descarga de archivos (getFile)', () => {
  it('descarga el blob con el nombre y el tipo del servidor', async () => {
    const blob = new Blob(['xlsx'], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const fetchImpl = createFetchMock(async () =>
      fakeFileResponse(200, {
        body: blob,
        headers: {
          'Content-Disposition':
            'attachment; filename="PigTec_Reportes_KolkaPig_2026-10-18.xlsx"',
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      }),
    );
    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      getAccessToken: () => 'jwt-de-prueba',
      fetchImpl,
    });

    const file = await client.getFile!('/reports/export/excel');

    expect(file.blob).toBe(blob);
    expect(file.filename).toBe('PigTec_Reportes_KolkaPig_2026-10-18.xlsx');
    expect(file.contentType).toContain('spreadsheetml');

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3000/reports/export/excel');
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer jwt-de-prueba',
    );
  });

  it('lee el nombre codificado de la forma RFC 5987 (filename*)', async () => {
    const fetchImpl = createFetchMock(async () =>
      fakeFileResponse(200, {
        headers: {
          'Content-Disposition':
            "attachment; filename*=UTF-8''Informe%20general.pdf",
        },
      }),
    );
    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      fetchImpl,
    });

    const file = await client.getFile!('/reports/export/pdf?type=general');

    expect(file.filename).toBe('Informe general.pdf');
  });

  it('devuelve filename null cuando no hay Content-Disposition', async () => {
    const fetchImpl = createFetchMock(async () => fakeFileResponse(200));
    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      fetchImpl,
    });

    const file = await client.getFile!('/reports/export/excel');

    expect(file.filename).toBeNull();
    expect(file.contentType).toBeNull();
  });

  it('convierte un HTTP 401 en ApiError y avisa una vez', async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = createFetchMock(async () =>
      fakeFileResponse(401, { jsonBody: { error: 'unauthorized' } }),
    );
    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      onUnauthorized,
      fetchImpl,
    });

    await expect(client.getFile!('/reports/export/excel')).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
    });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('propaga el codigo de error del backend en la descarga', async () => {
    const fetchImpl = createFetchMock(async () =>
      fakeFileResponse(403, { jsonBody: { error: 'forbidden' } }),
    );
    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      fetchImpl,
    });

    await expect(client.getFile!('/reports/export/excel')).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
    });
  });

  it('trata un fallo de red como ApiError con estado 0', async () => {
    const fetchImpl = createFetchMock(async () => {
      throw new TypeError('failed to fetch');
    });
    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      fetchImpl,
    });

    await expect(client.getFile!('/reports/export/excel')).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
    });
  });
});

describe('describeApiError', () => {
  it('traduce los codigos conocidos a mensajes en espanol', () => {
    expect(describeApiError(new ApiError(403, 'forbidden', 'x'))).toBe(
      'No tienes permisos para esta operacion.',
    );
    expect(
      describeApiError(new ApiError(429, 'ai_quota_exceeded', 'x')),
    ).toContain('cuota diaria');
  });

  it('usa un mensaje generico para errores desconocidos', () => {
    expect(describeApiError(new Error('boom'))).toBe(
      'Ocurrio un error inesperado.',
    );
  });
});
