/**
 * Utilidades compartidas por las pruebas de integracion OPT-IN de PigTec.
 *
 * Estas pruebas hablan con un backend Fastify EN EJECUCION (`npm run dev`) y,
 * por tanto, con la base real (PigTecBD) usando la identidad del JWT aportado.
 * NUNCA se ejecutan en `npm test`: requieren variables de entorno locales y, en
 * el caso de las pruebas que ESCRIBEN, una confirmacion explicita adicional.
 *
 * Variables de entorno (SOLO locales; nunca se suben a Git ni se imprimen):
 *   PIGTEC_E2E_BASE_URL      p. ej. http://127.0.0.1:3000
 *   PIGTEC_E2E_TOKEN         JWT de un usuario OPERATIVO ACTIVO (admin,
 *                            manager, operator o veterinarian). Las pruebas de
 *                            ESCRITURA exigen, ademas, admin o manager.
 *   PIGTEC_E2E_WRITE='1'     Habilita las pruebas que MUTAN datos. Ausente =
 *                            la corrida es de SOLO LECTURA.
 *   PIGTEC_E2E_VIEWER_TOKEN  (opcional) JWT de un usuario `viewer` activo, para
 *                            comprobar el rechazo 403 de escritura.
 *
 * El helper nunca registra el token ni el cuerpo de las respuestas con datos
 * sensibles: solo se comparan estados HTTP y campos concretos en cada prueba.
 */

export interface E2EConfig {
  /** URL base sin barra final. */
  baseUrl: string;
  /** JWT operativo (secreto: no se imprime). */
  token: string;
  /** JWT de un `viewer` activo, si se aporta (secreto: no se imprime). */
  viewerToken: string | null;
  /** `true` cuando PIGTEC_E2E_WRITE=1 (escrituras autorizadas). */
  writeEnabled: boolean;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface ApiRequestOptions {
  method?: string;
  body?: unknown;
  /**
   * Token a usar. `undefined` (por defecto) usa el token operativo de la
   * configuracion; `null` omite el encabezado Authorization (peticion anonima).
   */
  token?: string | null;
}

function trimmed(value: string | undefined): string | null {
  const result = value?.trim();
  return result ? result : null;
}

/**
 * Lee la configuracion de integracion. Devuelve `null` si faltan la URL o el
 * token: en ese caso las suites de integracion se omiten (no se ejecutan).
 */
export function readE2EConfig(): E2EConfig | null {
  const baseUrl = trimmed(process.env.PIGTEC_E2E_BASE_URL);
  const token = trimmed(process.env.PIGTEC_E2E_TOKEN);

  if (!baseUrl || !token) {
    return null;
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    token,
    viewerToken: trimmed(process.env.PIGTEC_E2E_VIEWER_TOKEN),
    writeEnabled: process.env.PIGTEC_E2E_WRITE === '1',
  };
}

/**
 * Ejecuta una peticion HTTP contra el backend en ejecucion y devuelve el estado
 * y el cuerpo parseado (JSON cuando es posible). No imprime ni el token ni el
 * cuerpo.
 */
export async function api(
  config: E2EConfig,
  path: string,
  request: ApiRequestOptions = {},
): Promise<ApiResponse> {
  const token = request.token === undefined ? config.token : request.token;
  const headers: Record<string, string> = {};

  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  if (request.body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  const response = await fetch(`${config.baseUrl}${path}`, {
    method: request.method ?? 'GET',
    headers,
    ...(request.body !== undefined
      ? { body: JSON.stringify(request.body) }
      : {}),
  });

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return { status: response.status, body };
}

/**
 * Identificador compacto y reconocible de una corrida de pruebas, para marcar
 * los datos sinteticos (codigos de corral, aretes, notas).
 */
export function newRunId(): string {
  return `E2E4-${Date.now().toString(36)}`;
}
