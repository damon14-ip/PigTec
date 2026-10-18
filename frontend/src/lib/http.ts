/**
 * Cliente HTTP centralizado del frontend.
 *
 * Responsabilidades:
 * - construir la URL absoluta a partir de `VITE_API_BASE_URL`,
 * - adjuntar el JWT de la sesion en `Authorization: Bearer`,
 * - convertir cualquier fallo en un `ApiError` con codigo estable,
 * - avisar (`onUnauthorized`) cuando la sesion ha expirado (HTTP 401).
 *
 * No conoce Supabase ni React: se puede probar con un `fetch` inyectado.
 */

/** Error normalizado de una peticion a la API. */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  /** Codigo HTTP (0 cuando no hubo respuesta, p. ej. fallo de red). */
  readonly status: number;

  /** Codigo estable devuelto por el backend (p. ej. `forbidden`). */
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface RequestOptions {
  signal?: AbortSignal;
}

/** Archivo binario descargado de la API (Excel/PDF). */
export interface FileDownload {
  /** Contenido binario del archivo. */
  blob: Blob;
  /** Nombre sugerido por el servidor (`Content-Disposition`), o `null`. */
  filename: string | null;
  /** Tipo MIME informado por el servidor, o `null`. */
  contentType: string | null;
}

export interface ApiClient {
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  post<T>(path: string, body: unknown, options?: RequestOptions): Promise<T>;
  patch<T>(path: string, body: unknown, options?: RequestOptions): Promise<T>;
  /**
   * Envia DELETE. En PigTec DELETE es una baja LOGICA en el backend
   * (`status='inactive'`), no un borrado fisico.
   */
  delete<T>(path: string, options?: RequestOptions): Promise<T>;
  /**
   * Descarga un archivo binario (exportaciones). Es OPCIONAL para no romper los
   * dobles de prueba que construyen un `ApiClient` como objeto literal; el
   * servicio de exportaciones exige su presencia y falla con un error claro si
   * falta.
   */
  getFile?(path: string, options?: RequestOptions): Promise<FileDownload>;
}

export interface CreateApiClientOptions {
  baseUrl: string;
  /** Devuelve el JWT actual o `null` si no hay sesion. */
  getAccessToken?: () => string | null;
  /** Se invoca ante un HTTP 401 para invalidar la sesion local. */
  onUnauthorized?: () => void;
  /** Implementacion de `fetch` (inyectable en pruebas). */
  fetchImpl?: typeof fetch;
}

/** Extrae el codigo de error del cuerpo JSON del backend (`{ error: string }`). */
async function readErrorCode(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof (body as { error: unknown }).error === 'string'
    ) {
      return (body as { error: string }).error;
    }
  } catch {
    // Cuerpo vacio o no JSON: se usa el codigo generico basado en el estado.
  }
  return `http_${response.status}`;
}

/**
 * Extrae el nombre de archivo de una cabecera `Content-Disposition`.
 *
 * Admite la forma moderna (`filename*=UTF-8''nombre%20codificado`, RFC 5987) y
 * la clasica (`filename="nombre"` o `filename=nombre`). Devuelve `null` si no
 * hay nombre utilizable.
 */
function readHeaderFilename(header: string | null): string | null {
  if (!header) {
    return null;
  }

  const encoded = /filename\*=(?:UTF-8|utf-8)''([^;]+)/i.exec(header);
  if (encoded) {
    try {
      const decoded = decodeURIComponent(encoded[1].trim());
      if (decoded !== '') {
        return decoded;
      }
    } catch {
      // Codificacion invalida: se intenta con las formas mas simples.
    }
  }

  const quoted = /filename="([^"]*)"/i.exec(header);
  if (quoted) {
    const name = quoted[1].trim();
    return name === '' ? null : name;
  }

  const plain = /filename=([^;]+)/i.exec(header);
  if (plain) {
    const name = plain[1].trim();
    return name === '' ? null : name;
  }

  return null;
}

/**
 * Crea el cliente HTTP de la aplicacion.
 *
 * `onUnauthorized` se invoca una sola vez por peticion fallida con 401, para que
 * el proveedor de sesion pueda cerrar la sesion expirada.
 */
export function createApiClient(options: CreateApiClientOptions): ApiClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  async function request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body: unknown,
    requestOptions: RequestOptions = {},
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const token = options.getAccessToken?.() ?? null;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        ...(requestOptions.signal ? { signal: requestOptions.signal } : {}),
      });
    } catch {
      // Fallo de red o peticion abortada: no hubo respuesta del servidor.
      throw new ApiError(
        0,
        'network_error',
        'No se pudo conectar con el servidor de PigTec.',
      );
    }

    if (response.status === 401) {
      options.onUnauthorized?.();
      throw new ApiError(
        401,
        await readErrorCode(response),
        'La sesion ha expirado. Vuelve a iniciar sesion.',
      );
    }

    if (!response.ok) {
      const code = await readErrorCode(response);
      throw new ApiError(
        response.status,
        code,
        'El servidor no pudo completar la solicitud.',
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError(
        response.status,
        'invalid_response',
        'El servidor devolvio una respuesta no valida.',
      );
    }
  }

  /** Descarga binaria reutilizando la misma gestion de errores que `request`. */
  async function requestFile(
    path: string,
    requestOptions: RequestOptions = {},
  ): Promise<FileDownload> {
    const headers: Record<string, string> = { Accept: '*/*' };

    const token = options.getAccessToken?.() ?? null;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: 'GET',
        headers,
        ...(requestOptions.signal ? { signal: requestOptions.signal } : {}),
      });
    } catch {
      throw new ApiError(
        0,
        'network_error',
        'No se pudo conectar con el servidor de PigTec.',
      );
    }

    if (response.status === 401) {
      options.onUnauthorized?.();
      throw new ApiError(
        401,
        await readErrorCode(response),
        'La sesion ha expirado. Vuelve a iniciar sesion.',
      );
    }

    if (!response.ok) {
      throw new ApiError(
        response.status,
        await readErrorCode(response),
        'El servidor no pudo completar la solicitud.',
      );
    }

    let blob: Blob;
    try {
      blob = await response.blob();
    } catch {
      throw new ApiError(
        response.status,
        'invalid_response',
        'El servidor devolvio una respuesta no valida.',
      );
    }

    return {
      blob,
      filename: readHeaderFilename(
        response.headers?.get?.('Content-Disposition') ?? null,
      ),
      contentType: response.headers?.get?.('Content-Type') ?? null,
    };
  }

  return {
    get: <T>(path: string, requestOptions?: RequestOptions) =>
      request<T>('GET', path, undefined, requestOptions),
    post: <T>(path: string, body: unknown, requestOptions?: RequestOptions) =>
      request<T>('POST', path, body, requestOptions),
    patch: <T>(path: string, body: unknown, requestOptions?: RequestOptions) =>
      request<T>('PATCH', path, body, requestOptions),
    delete: <T>(path: string, requestOptions?: RequestOptions) =>
      request<T>('DELETE', path, undefined, requestOptions),
    getFile: (path: string, requestOptions?: RequestOptions) =>
      requestFile(path, requestOptions),
  };
}

/** Mensajes en espanol para los codigos de error conocidos de la API. */
const ERROR_MESSAGES: Record<string, string> = {
  network_error: 'No se pudo conectar con el servidor de PigTec.',
  unauthorized: 'La sesion ha expirado. Vuelve a iniciar sesion.',
  forbidden: 'No tienes permisos para esta operacion.',
  invalid_body: 'La solicitud no es valida.',
  invalid_params: 'Los parametros de la solicitud no son validos.',
  invalid_query: 'Los filtros de la solicitud no son validos.',
  invalid_request: 'Los datos enviados no son validos.',
  invalid_reference: 'Existe una referencia a un registro inexistente.',
  not_found: 'No se encontro el registro solicitado.',
  conflict: 'La operacion entra en conflicto con el estado actual.',
  service_unavailable: 'El servicio no esta disponible. Intenta mas tarde.',
  download_unavailable:
    'La descarga de archivos no esta disponible en este navegador.',
  ai_quota_exceeded:
    'Se alcanzo la cuota diaria de consultas al asistente por IA.',
  ai_rate_limited:
    'El proveedor de IA esta limitando las solicitudes. Intenta mas tarde.',
  ai_timeout: 'El proveedor de IA tardo demasiado. Vuelve a intentarlo.',
  ai_unavailable:
    'El asistente por IA no esta disponible en este momento. Puedes usar las respuestas locales y consultas de datos.',
  ai_invalid_response: 'El proveedor de IA devolvio una respuesta no valida.',
  invalid_response: 'El servidor devolvio una respuesta no valida.',
};

/**
 * Traduce un error a un mensaje legible para el usuario.
 *
 * Para `ApiError` usa el mensaje asociado al codigo del backend; cualquier otro
 * error recibe un mensaje generico.
 */
export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) {
    return ERROR_MESSAGES[error.code] ?? error.message;
  }
  return 'Ocurrio un error inesperado.';
}
