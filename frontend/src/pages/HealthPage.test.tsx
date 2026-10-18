import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { makeAuthValue, makeProfile, renderWithAuth } from '../test/helpers';
import { ApiError, type ApiClient } from '../lib/http';
import type { OperationalRole } from '../config/roles';
import type { Animal } from '../services/animals.service';
import type { HealthEvent } from '../services/health-events.service';
import { formatDateTimeLocal } from '../lib/dates';
import { HealthPage } from './HealthPage';

const CREATED_AT = '2026-01-01T00:00:00.000Z';

const ANIMAL_ACTIVE: Animal = {
  id: 'animal-active',
  animal_code: 'PIG-000001',
  ear_tag_code: 'AR-100',
  sex: 'female',
  breed: 'Landrace',
  birth_date: '2026-01-05',
  origin: 'born_on_farm',
  mother_id: null,
  father_id: null,
  litter_id: null,
  current_pen_id: null,
  status: 'active',
  entry_date: '2026-01-10',
  exit_date: null,
  notes: null,
  created_by: 'perfil-prueba',
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

const ANIMAL_MISSING: Animal = {
  ...ANIMAL_ACTIVE,
  id: 'animal-missing',
  animal_code: 'PIG-000002',
  ear_tag_code: null,
  status: 'missing',
};

/** Estado terminal: NO admite nuevos eventos sanitarios (regla del backend). */
const ANIMAL_SOLD: Animal = {
  ...ANIMAL_ACTIVE,
  id: 'animal-sold',
  animal_code: 'PIG-000003',
  ear_tag_code: 'AR-300',
  current_pen_id: null,
  status: 'sold',
  exit_date: '2026-03-01',
};

const EVENT_OBSERVATION: HealthEvent = {
  id: 'event-obs',
  animal_id: 'animal-active',
  event_type: 'observation',
  occurred_at: '2026-03-05T14:30:00.000Z',
  title: 'Apetito normal',
  description: 'Sin novedades en el corral.',
  documented_by: null,
  details: {},
  attachment_url: null,
  recorded_by: 'perfil-prueba',
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

const EVENT_TREATMENT: HealthEvent = {
  id: 'event-treat',
  animal_id: 'animal-active',
  event_type: 'treatment',
  occurred_at: '2026-03-06T09:00:00.000Z',
  title: 'Antibiótico',
  description: null,
  documented_by: 'Vet. externo',
  details: { dosis: '5 ml' },
  attachment_url: null,
  recorded_by: 'perfil-prueba',
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

const EVENT_MORTALITY: HealthEvent = {
  id: 'event-mortality',
  animal_id: 'animal-missing',
  event_type: 'mortality',
  occurred_at: '2026-03-07T08:00:00.000Z',
  title: 'Fallecimiento súbito',
  description: null,
  documented_by: null,
  details: {},
  attachment_url: null,
  recorded_by: 'perfil-prueba',
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

interface ClientOptions {
  events?: HealthEvent[];
  animals?: Animal[];
  /** Historial devuelto por `GET /animals/:id/health-events`. */
  animalHistory?: HealthEvent[];
  getImpl?: (
    path: string,
    fallback: (path: string) => Promise<unknown>,
  ) => Promise<unknown>;
  postImpl?: (path: string, body: unknown) => Promise<unknown>;
}

function queryOf(path: string): URLSearchParams {
  const index = path.indexOf('?');
  return new URLSearchParams(index === -1 ? '' : path.slice(index + 1));
}

/** Cliente de API simulado: nunca realiza peticiones reales. */
function makeClient(options: ClientOptions = {}) {
  const events = options.events ?? [
    EVENT_OBSERVATION,
    EVENT_TREATMENT,
    EVENT_MORTALITY,
  ];
  const animals = options.animals ?? [ANIMAL_ACTIVE, ANIMAL_MISSING, ANIMAL_SOLD];
  const animalHistory = options.animalHistory ?? events;

  const defaultGet = async (path: string): Promise<unknown> => {
    if (path === '/animals') {
      return animals;
    }
    if (path.startsWith('/animals/') && path.includes('/health-events')) {
      const id = path.slice('/animals/'.length, path.indexOf('/health-events'));
      return animalHistory.filter((event) => event.animal_id === id);
    }
    if (path === '/health-events' || path.startsWith('/health-events?')) {
      const query = queryOf(path);
      const animalId = query.get('animal_id');
      const eventType = query.get('event_type');
      const from = query.get('occurred_from');
      const to = query.get('occurred_to');
      let rows = events;
      if (animalId) {
        rows = rows.filter((event) => event.animal_id === animalId);
      }
      if (eventType) {
        rows = rows.filter((event) => event.event_type === eventType);
      }
      if (from) {
        rows = rows.filter((event) => event.occurred_at >= from);
      }
      if (to) {
        rows = rows.filter((event) => event.occurred_at <= to);
      }
      const offset = Number(query.get('offset') ?? '0');
      const limit = Number(query.get('limit') ?? '100');
      return rows.slice(offset, offset + limit);
    }
    if (path.startsWith('/health-events/')) {
      const id = path.slice('/health-events/'.length);
      const found = events.find((event) => event.id === id);
      if (!found) {
        throw new ApiError(404, 'not_found', 'no existe');
      }
      return found;
    }
    throw new Error(`Ruta no simulada: ${path}`);
  };

  const get = vi.fn(
    options.getImpl
      ? (path: string) => options.getImpl!(path, defaultGet)
      : defaultGet,
  );
  const post = vi.fn(options.postImpl ?? (async () => EVENT_OBSERVATION));

  const client = {
    get,
    post,
    patch: vi.fn(async () => EVENT_OBSERVATION),
    delete: vi.fn(async () => EVENT_OBSERVATION),
  } as unknown as ApiClient;

  return { client, get, post };
}

function renderPage(client: ApiClient, role: OperationalRole = 'manager') {
  return renderWithAuth(<HealthPage />, {
    auth: makeAuthValue({
      apiClient: client,
      profile: makeProfile({ role }),
    }),
  });
}

function lastEventsPath(get: ReturnType<typeof vi.fn>): string {
  const paths = get.mock.calls
    .map((call) => call[0] as string)
    .filter(
      (path) => path === '/health-events' || path.startsWith('/health-events?'),
    );
  return paths[paths.length - 1];
}

async function openForm(client: ApiClient, role: OperationalRole = 'manager') {
  renderPage(client, role);
  const button = await screen.findByRole('button', { name: 'Registrar evento' });
  fireEvent.click(button);
  return screen.findByRole('dialog', { name: 'Registrar evento sanitario' });
}

/** Completa un evento de observación válido dentro del formulario. */
function fillValidObservation(
  dialog: HTMLElement,
  animalId = 'animal-active',
  title = 'Observación de prueba',
) {
  fireEvent.change(within(dialog).getByLabelText('Porcino'), {
    target: { value: animalId },
  });
  fireEvent.change(within(dialog).getByLabelText('Tipo de evento'), {
    target: { value: 'observation' },
  });
  fireEvent.change(within(dialog).getByLabelText('Título'), {
    target: { value: title },
  });
}

describe('HealthPage: listado', () => {
  it('muestra fecha, porcino, tipo y titulo de cada evento', async () => {
    const { client } = makeClient();
    renderPage(client);

    const table = await screen.findByRole('table');
    expect(
      within(table).getByText(formatDateTimeLocal(EVENT_OBSERVATION.occurred_at)),
    ).toBeInTheDocument();
    expect(within(table).getAllByText('PIG-000001').length).toBeGreaterThan(0);
    expect(within(table).getByText('Observación')).toBeInTheDocument();
    expect(within(table).getByText('Apetito normal')).toBeInTheDocument();
    expect(within(table).getByText('Tratamiento')).toBeInTheDocument();
    expect(within(table).getByText('Mortalidad')).toBeInTheDocument();
  });

  it('es inmutable: no ofrece editar ni eliminar', async () => {
    const { client } = makeClient();
    renderPage(client);

    const table = await screen.findByRole('table');
    expect(
      within(table).queryByRole('button', { name: /editar|eliminar|borrar/i }),
    ).not.toBeInTheDocument();
  });

  it('muestra el estado vacio cuando no hay eventos', async () => {
    const { client } = makeClient({ events: [] });
    renderPage(client);

    expect(
      await screen.findByText('Todavía no hay eventos sanitarios registrados.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('HealthPage: estados de carga y error', () => {
  it('muestra el estado de carga mientras consulta', () => {
    const { client } = makeClient({ getImpl: () => new Promise(() => {}) });
    renderPage(client);

    expect(screen.getByText('Cargando eventos sanitarios…')).toBeInTheDocument();
  });

  it('muestra el error 503 y permite reintentar', async () => {
    let fail = true;
    const { client } = makeClient({
      getImpl: async (path, fallback) => {
        if (path.startsWith('/health-events') && fail) {
          fail = false;
          throw new ApiError(503, 'service_unavailable', 'no disponible');
        }
        return fallback(path);
      },
    });
    renderPage(client);

    expect(
      await screen.findByText('No se pudieron cargar los eventos sanitarios'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('El servicio no esta disponible. Intenta mas tarde.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Apetito normal')).toBeInTheDocument();
  });

  it('trata un fallo de red con un mensaje claro', async () => {
    const { client } = makeClient({
      getImpl: async (path, fallback) => {
        if (path.startsWith('/health-events')) {
          throw new ApiError(0, 'network_error', 'sin conexion');
        }
        return fallback(path);
      },
    });
    renderPage(client);

    expect(
      await screen.findByText('No se pudo conectar con el servidor de PigTec.'),
    ).toBeInTheDocument();
  });

  it('avisa cuando falla el catalogo de porcinos sin bloquear el listado', async () => {
    const { client } = makeClient({
      getImpl: async (path, fallback) => {
        if (path === '/animals') {
          throw new ApiError(503, 'service_unavailable', 'no disponible');
        }
        return fallback(path);
      },
    });
    renderPage(client);

    expect(
      await screen.findByText('No se pudieron cargar los porcinos'),
    ).toBeInTheDocument();
    const table = await screen.findByRole('table');
    expect(
      within(table).getAllByText('Código no disponible').length,
    ).toBeGreaterThan(0);
  });
});

describe('HealthPage: filtros y paginacion', () => {
  it('filtra por porcino usando el codigo PigTec exacto', async () => {
    const { client, get } = makeClient();
    renderPage(client);
    await screen.findByText('Apetito normal');

    fireEvent.change(screen.getByLabelText('Buscar porcino'), {
      target: { value: 'PIG-000002' },
    });

    await waitFor(() =>
      expect(queryOf(lastEventsPath(get)).get('animal_id')).toBe(
        'animal-missing',
      ),
    );
  });

  it('avisa cuando el texto buscado no coincide con ningun porcino', async () => {
    const { client } = makeClient();
    renderPage(client);
    await screen.findByText('Apetito normal');

    fireEvent.change(screen.getByLabelText('Buscar porcino'), {
      target: { value: 'PIG-999999' },
    });

    expect(
      await screen.findByText(
        'Escribe el código PigTec exacto del porcino o selecciónalo de las sugerencias.',
      ),
    ).toBeInTheDocument();
  });

  it('filtra por tipo de evento', async () => {
    const { client, get } = makeClient();
    renderPage(client);
    await screen.findByText('Apetito normal');

    fireEvent.change(screen.getByLabelText('Filtrar por tipo de evento'), {
      target: { value: 'treatment' },
    });

    await waitFor(() =>
      expect(queryOf(lastEventsPath(get)).get('event_type')).toBe('treatment'),
    );
  });

  it('filtra por rango de fechas (occurred_from/occurred_to)', async () => {
    const { client, get } = makeClient();
    renderPage(client);
    await screen.findByText('Apetito normal');

    fireEvent.change(screen.getByLabelText('Desde'), {
      target: { value: '2026-03-01' },
    });
    fireEvent.change(screen.getByLabelText('Hasta'), {
      target: { value: '2026-03-31' },
    });

    await waitFor(() => {
      const query = queryOf(lastEventsPath(get));
      expect(query.get('occurred_from')).toBeTruthy();
      expect(query.get('occurred_to')).toBeTruthy();
    });
  });

  it('pagina con limit/offset sin inventar el total', async () => {
    const many: HealthEvent[] = Array.from({ length: 25 }, (_, index) => ({
      ...EVENT_OBSERVATION,
      id: `event-${index}`,
      title: `Evento ${index}`,
    }));
    const { client, get } = makeClient({ events: many });
    renderPage(client);
    await screen.findByText('Página 1');

    expect(queryOf(lastEventsPath(get)).get('limit')).toBe('20');
    expect(queryOf(lastEventsPath(get)).get('offset')).toBe('0');
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(21);

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

    expect(await screen.findByText('Página 2')).toBeInTheDocument();
    expect(queryOf(lastEventsPath(get)).get('offset')).toBe('20');
  });
});

describe('HealthPage: permisos por rol', () => {
  it('el operator solo puede registrar eventos de observacion', async () => {
    const { client } = makeClient();
    const dialog = await openForm(client, 'operator');

    const options = within(within(dialog).getByLabelText('Tipo de evento'))
      .getAllByRole('option')
      .map((option) => option.textContent);

    expect(options).toContain('Observación');
    expect(options).toContain('Reporte de síntomas');
    expect(options).not.toContain('Diagnóstico documentado');
    expect(options).not.toContain('Tratamiento');
    expect(options).not.toContain('Mortalidad');
  });

  it('el veterinario puede registrar eventos clinicos y mortalidad', async () => {
    const { client } = makeClient();
    const dialog = await openForm(client, 'veterinarian');

    const options = within(within(dialog).getByLabelText('Tipo de evento'))
      .getAllByRole('option')
      .map((option) => option.textContent);

    expect(options).toContain('Tratamiento');
    expect(options).toContain('Vacunación');
    expect(options).toContain('Mortalidad');
  });

  it('el manager puede registrar mortalidad', async () => {
    const { client } = makeClient();
    const dialog = await openForm(client, 'manager');

    const options = within(within(dialog).getByLabelText('Tipo de evento'))
      .getAllByRole('option')
      .map((option) => option.textContent);

    expect(options).toContain('Mortalidad');
  });
});

describe('HealthPage: formulario de registro', () => {
  it('solo ofrece porcinos que admiten eventos (activo o no localizado)', async () => {
    const { client } = makeClient();
    const dialog = await openForm(client);

    const codes = within(within(dialog).getByLabelText('Porcino'))
      .getAllByRole('option')
      .map((option) => option.textContent);

    expect(codes.some((text) => text?.includes('PIG-000001'))).toBe(true);
    expect(codes.some((text) => text?.includes('PIG-000002'))).toBe(true);
    expect(codes.some((text) => text?.includes('PIG-000003'))).toBe(false);
  });

  it('valida los campos obligatorios sin llamar a la API', async () => {
    const { client, post } = makeClient();
    const dialog = await openForm(client);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));

    expect(
      await within(dialog).findByText('Selecciona el porcino.'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('Selecciona el tipo de evento.'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('Escribe un título para el evento.'),
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('pide confirmacion, permite cancelar y no registra', async () => {
    const { client, post } = makeClient();
    const dialog = await openForm(client);
    fillValidObservation(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));

    const confirm = await screen.findByRole('dialog', {
      name: 'Confirmar registro del evento',
    });
    expect(within(confirm).getByText('PIG-000001')).toBeInTheDocument();

    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancelar' }));

    expect(
      screen.queryByRole('dialog', {
        name: 'Confirmar registro del evento',
      }),
    ).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('registra el evento y refresca el listado', async () => {
    const events: HealthEvent[] = [];
    const { client, post } = makeClient({
      events,
      postImpl: async (_path, body) => {
        const created: HealthEvent = {
          ...EVENT_OBSERVATION,
          id: 'event-nuevo',
          animal_id: (body as { animal_id: string }).animal_id,
          title: (body as { title: string }).title,
        };
        events.unshift(created);
        return created;
      },
    });
    await openForm(client);
    const dialog = screen.getByRole('dialog', {
      name: 'Registrar evento sanitario',
    });
    fillValidObservation(dialog, 'animal-active', 'Chequeo rutinario');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));

    const confirm = await screen.findByRole('dialog', {
      name: 'Confirmar registro del evento',
    });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Registrar evento' }));

    expect(post).toHaveBeenCalledWith('/health-events', {
      animal_id: 'animal-active',
      event_type: 'observation',
      title: 'Chequeo rutinario',
    });
    expect(
      await screen.findByText('Evento registrado para el porcino PIG-000001.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Chequeo rutinario')).toBeInTheDocument();
  });

  it('evita el doble envio mientras la operacion esta en curso', async () => {
    let release: (value: HealthEvent) => void = () => {};
    const pending = new Promise<HealthEvent>((resolve) => {
      release = resolve;
    });
    const { client, post } = makeClient({ postImpl: () => pending });
    const dialog = await openForm(client);
    fillValidObservation(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));

    const confirm = await screen.findByRole('dialog', {
      name: 'Confirmar registro del evento',
    });
    const confirmButton = within(confirm).getByRole('button', {
      name: 'Registrar evento',
    });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    expect(post).toHaveBeenCalledTimes(1);

    release(EVENT_OBSERVATION);
    await screen.findByText('Evento registrado para el porcino PIG-000001.');
  });
});

describe('HealthPage: mortalidad', () => {
  it('advierte del caracter definitivo y confirma en rojo', async () => {
    const { client } = makeClient();
    const dialog = await openForm(client, 'manager');
    fireEvent.change(within(dialog).getByLabelText('Porcino'), {
      target: { value: 'animal-missing' },
    });
    fireEvent.change(within(dialog).getByLabelText('Tipo de evento'), {
      target: { value: 'mortality' },
    });
    fireEvent.change(within(dialog).getByLabelText('Título'), {
      target: { value: 'Fallecimiento súbito' },
    });

    expect(
      within(dialog).getByText(/Es una operación definitiva/i),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));

    const confirm = await screen.findByRole('dialog', {
      name: 'Confirmar registro del evento',
    });
    expect(within(confirm).getByText('Registro de mortalidad')).toBeInTheDocument();
    expect(within(confirm).getByText(/marcará al porcino como/i)).toBeInTheDocument();
  });
});

describe('HealthPage: detalle e historial', () => {
  it('muestra el detalle de un evento', async () => {
    const { client } = makeClient();
    renderPage(client);
    await screen.findByText('Apetito normal');

    const row = screen.getByText('Apetito normal').closest('tr');
    expect(row).not.toBeNull();
    fireEvent.click(
      within(row as HTMLElement).getByRole('button', { name: 'Ver detalle' }),
    );

    const dialog = await screen.findByRole('dialog', {
      name: 'Detalle del evento sanitario',
    });
    expect(
      await within(dialog).findByText('Sin novedades en el corral.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('PIG-000001')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'El historial sanitario es permanente: no se puede editar ni eliminar.',
      ),
    ).toBeInTheDocument();
  });

  it('traduce un 404 al abrir el detalle', async () => {
    const { client } = makeClient({
      getImpl: async (path, fallback) => {
        if (path.startsWith('/health-events/')) {
          throw new ApiError(404, 'not_found', 'no existe');
        }
        return fallback(path);
      },
    });
    renderPage(client);
    await screen.findByText('Apetito normal');

    fireEvent.click(screen.getAllByRole('button', { name: 'Ver detalle' })[0]);

    expect(
      await screen.findByText('No se pudo cargar el evento'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('No se encontro el registro solicitado.'),
    ).toBeInTheDocument();
  });

  it('muestra el historial del porcino en orden cronologico', async () => {
    const { client } = makeClient({
      // El backend devuelve descendente; el historial lo muestra ascendente.
      animalHistory: [EVENT_TREATMENT, EVENT_OBSERVATION],
    });
    renderPage(client);
    await screen.findByText('Apetito normal');

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Historial del porcino' })[0],
    );

    const dialog = await screen.findByRole('dialog', {
      name: 'Historial sanitario del porcino',
    });
    const table = await within(dialog).findByRole('table');
    const rows = within(table).getAllByRole('row');
    // Cabecera + 2 eventos, del más antiguo al más reciente.
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText('Apetito normal')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Antibiótico')).toBeInTheDocument();
    // El propio historial no repite la columna "Porcino".
    expect(within(table).queryByText('PIG-000001')).not.toBeInTheDocument();
  });

  it('avisa cuando el porcino no tiene eventos', async () => {
    const { client } = makeClient({ animalHistory: [] });
    renderPage(client);
    await screen.findByText('Apetito normal');

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Historial del porcino' })[0],
    );

    const dialog = await screen.findByRole('dialog', {
      name: 'Historial sanitario del porcino',
    });
    expect(
      await within(dialog).findByText(
        'Este porcino todavía no tiene eventos sanitarios registrados.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('HealthPage: errores de escritura', () => {
  const cases: Array<[number, string, string]> = [
    [400, 'invalid_request', 'Los datos enviados no son validos.'],
    [401, 'unauthorized', 'La sesion ha expirado. Vuelve a iniciar sesion.'],
    [403, 'forbidden', 'No tienes permisos para esta operacion.'],
    [404, 'not_found', 'No se encontro el registro solicitado.'],
    [409, 'conflict', 'La operacion entra en conflicto con el estado actual.'],
    [422, 'invalid_reference', 'Existe una referencia a un registro inexistente.'],
    [503, 'service_unavailable', 'El servicio no esta disponible. Intenta mas tarde.'],
  ];

  for (const [status, code, message] of cases) {
    it(`traduce el error ${status} (${code})`, async () => {
      const { client } = makeClient({
        postImpl: async () => {
          throw new ApiError(status, code, 'fallo simulado');
        },
      });
      const dialog = await openForm(client);
      fillValidObservation(dialog);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));

      const confirm = await screen.findByRole('dialog', {
        name: 'Confirmar registro del evento',
      });
      fireEvent.click(
        within(confirm).getByRole('button', { name: 'Registrar evento' }),
      );

      expect(await screen.findByText(message)).toBeInTheDocument();
    });
  }
});
