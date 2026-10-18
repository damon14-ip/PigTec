import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { makeAuthValue, makeProfile, renderWithAuth } from '../test/helpers';
import { ApiError, type ApiClient } from '../lib/http';
import type { OperationalRole } from '../config/roles';
import type { Animal } from '../services/animals.service';
import type { Litter, LitterOffspring } from '../services/litters.service';
import { formatCalendarDate } from '../lib/dates';
import { LittersPage } from './LittersPage';

const CREATED_AT = '2026-01-01T00:00:00.000Z';

const MOTHER: Animal = {
  id: 'animal-mother',
  animal_code: 'PIG-000001',
  ear_tag_code: 'AR-100',
  sex: 'female',
  breed: 'Landrace',
  birth_date: null,
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

const FATHER: Animal = {
  ...MOTHER,
  id: 'animal-father',
  animal_code: 'PIG-000002',
  ear_tag_code: null,
  sex: 'male',
};

const LITTER: Litter = {
  id: 'litter-1',
  litter_code: 'CAM-001',
  mother_id: 'animal-mother',
  father_id: 'animal-father',
  birth_date: '2026-03-01',
  total_born: 10,
  born_alive: 9,
  stillborn: 1,
  notes: 'Parto normal',
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

const OFFSPRING: LitterOffspring = {
  id: 'offspring-1',
  animal_code: 'PIG-000123',
  ear_tag_code: 'AR-123',
  sex: 'female',
  birth_date: '2026-03-01',
  status: 'active',
  mother_id: 'animal-mother',
  father_id: 'animal-father',
};

interface ClientOptions {
  litters?: Litter[];
  offspring?: LitterOffspring[];
  animals?: Animal[];
  getImpl?: (
    path: string,
    fallback: (path: string) => Promise<unknown>,
  ) => Promise<unknown>;
  postImpl?: (path: string, body: unknown) => Promise<unknown>;
  patchImpl?: (path: string, body: unknown) => Promise<unknown>;
}

function queryOf(path: string): URLSearchParams {
  const index = path.indexOf('?');
  return new URLSearchParams(index === -1 ? '' : path.slice(index + 1));
}

/** Cliente de API simulado: nunca realiza peticiones reales. */
function makeClient(options: ClientOptions = {}) {
  const litters = options.litters ?? [LITTER];
  const offspring = options.offspring ?? [OFFSPRING];
  const animals = options.animals ?? [MOTHER, FATHER];

  const defaultGet = async (path: string): Promise<unknown> => {
    if (path === '/animals') {
      return animals;
    }
    if (path.startsWith('/litters/') && path.endsWith('/offspring')) {
      return offspring;
    }
    if (path.startsWith('/litters/')) {
      const id = path.slice('/litters/'.length);
      const found = litters.find((item) => item.id === id);
      if (!found) {
        throw new ApiError(404, 'not_found', 'no existe');
      }
      return found;
    }
    if (path === '/litters' || path.startsWith('/litters?')) {
      const query = queryOf(path);
      const offset = Number(query.get('offset') ?? '0');
      const limit = Number(query.get('limit') ?? '100');
      const motherId = query.get('mother_id');
      const from = query.get('birth_from');
      const to = query.get('birth_to');
      let rows = litters;
      if (motherId) {
        rows = rows.filter((litter) => litter.mother_id === motherId);
      }
      if (from) {
        rows = rows.filter(
          (litter) => litter.birth_date !== null && litter.birth_date >= from,
        );
      }
      if (to) {
        rows = rows.filter(
          (litter) => litter.birth_date !== null && litter.birth_date <= to,
        );
      }
      return rows.slice(offset, offset + limit);
    }
    throw new Error(`Ruta no simulada: ${path}`);
  };

  const get = vi.fn(
    options.getImpl
      ? (path: string) => options.getImpl!(path, defaultGet)
      : defaultGet,
  );
  const post = vi.fn(options.postImpl ?? (async () => LITTER));
  const patch = vi.fn(options.patchImpl ?? (async () => LITTER));

  const client = {
    get,
    post,
    patch,
    delete: vi.fn(async () => LITTER),
  } as unknown as ApiClient;

  return { client, get, post, patch };
}

function renderPage(client: ApiClient, role: OperationalRole = 'manager') {
  return renderWithAuth(<LittersPage />, {
    auth: makeAuthValue({
      apiClient: client,
      profile: makeProfile({ role }),
    }),
  });
}

function lastLittersPath(get: ReturnType<typeof vi.fn>): string {
  const paths = get.mock.calls
    .map((call) => call[0] as string)
    .filter((path) => path === '/litters' || path.startsWith('/litters?'));
  return paths[paths.length - 1];
}

async function openForm(client: ApiClient, role: OperationalRole = 'manager') {
  renderPage(client, role);
  const button = await screen.findByRole('button', {
    name: 'Registrar camada',
  });
  fireEvent.click(button);
  return screen.findByRole('dialog', { name: 'Registrar camada' });
}

describe('LittersPage: listado', () => {
  it('muestra codigo, madre, padre, parto y conteos', async () => {
    const { client } = makeClient();
    renderPage(client);

    const table = await screen.findByRole('table');
    expect(within(table).getByText('CAM-001')).toBeInTheDocument();
    expect(within(table).getByText('PIG-000001')).toBeInTheDocument();
    expect(within(table).getByText('PIG-000002')).toBeInTheDocument();
    expect(
      within(table).getByText(formatCalendarDate('2026-03-01')),
    ).toBeInTheDocument();
    expect(within(table).getByText('10')).toBeInTheDocument();
    expect(within(table).getByText('9')).toBeInTheDocument();
    expect(within(table).getByText('1')).toBeInTheDocument();
    // La camada no se elimina: no hay accion de borrado.
    expect(
      within(table).queryByRole('button', { name: /eliminar|borrar/i }),
    ).not.toBeInTheDocument();
  });

  it('muestra el estado vacio cuando no hay camadas', async () => {
    const { client } = makeClient({ litters: [] });
    renderPage(client);

    expect(
      await screen.findByText('Todavía no hay camadas registradas.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('LittersPage: estados de carga y error', () => {
  it('muestra el estado de carga mientras consulta', () => {
    const { client } = makeClient({ getImpl: () => new Promise(() => {}) });
    renderPage(client);

    expect(screen.getByText('Cargando camadas…')).toBeInTheDocument();
  });

  it('muestra el error 503 y permite reintentar', async () => {
    let fail = true;
    const { client } = makeClient({
      getImpl: async (path, fallback) => {
        if (path.startsWith('/litters') && fail) {
          fail = false;
          throw new ApiError(503, 'service_unavailable', 'no disponible');
        }
        return fallback(path);
      },
    });
    renderPage(client);

    expect(
      await screen.findByText('No se pudieron cargar las camadas'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('El servicio no esta disponible. Intenta mas tarde.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('CAM-001')).toBeInTheDocument();
  });

  it('trata un fallo de red con un mensaje claro', async () => {
    const { client } = makeClient({
      getImpl: async (path, fallback) => {
        if (path.startsWith('/litters')) {
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

describe('LittersPage: filtros y paginacion', () => {
  it('filtra por madre usando su mother_id real', async () => {
    const { client, get } = makeClient();
    renderPage(client);
    await screen.findByText('CAM-001');

    fireEvent.change(screen.getByLabelText('Buscar por madre'), {
      target: { value: 'PIG-000001' },
    });

    await waitFor(() =>
      expect(queryOf(lastLittersPath(get)).get('mother_id')).toBe('animal-mother'),
    );
  });

  it('filtra por rango de fechas de parto (birth_from/birth_to)', async () => {
    const { client, get } = makeClient();
    renderPage(client);
    await screen.findByText('CAM-001');

    fireEvent.change(screen.getByLabelText('Parto desde'), {
      target: { value: '2026-01-01' },
    });
    fireEvent.change(screen.getByLabelText('Parto hasta'), {
      target: { value: '2026-01-31' },
    });

    await waitFor(() => {
      const query = queryOf(lastLittersPath(get));
      expect(query.get('birth_from')).toBe('2026-01-01');
      expect(query.get('birth_to')).toBe('2026-01-31');
    });
  });

  it('avisa cuando el texto buscado no coincide con ninguna madre', async () => {
    const { client } = makeClient();
    renderPage(client);
    await screen.findByText('CAM-001');

    fireEvent.change(screen.getByLabelText('Buscar por madre'), {
      target: { value: 'PIG-999999' },
    });

    expect(
      await screen.findByText(
        'Escribe el código PigTec exacto de la madre o selecciónala de las sugerencias.',
      ),
    ).toBeInTheDocument();
  });

  it('pagina con limit/offset sin inventar el total', async () => {
    const many: Litter[] = Array.from({ length: 25 }, (_, index) => ({
      ...LITTER,
      id: `litter-${index}`,
      litter_code: `CAM-${index}`,
    }));
    const { client, get } = makeClient({ litters: many });
    renderPage(client);
    await screen.findByText('Página 1');

    expect(queryOf(lastLittersPath(get)).get('limit')).toBe('20');
    expect(queryOf(lastLittersPath(get)).get('offset')).toBe('0');
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(21);

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

    expect(await screen.findByText('Página 2')).toBeInTheDocument();
    expect(queryOf(lastLittersPath(get)).get('offset')).toBe('20');
  });
});

describe('LittersPage: permisos por rol', () => {
  it('el veterinario consulta pero no registra ni edita camadas', async () => {
    const { client } = makeClient();
    renderPage(client, 'veterinarian');
    await screen.findByText('CAM-001');

    expect(
      screen.queryByRole('button', { name: 'Registrar camada' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Modo consulta')).toBeInTheDocument();
    expect(
      within(screen.getByRole('table')).queryByRole('button', { name: 'Editar' }),
    ).not.toBeInTheDocument();
  });

  it('el operator puede registrar y editar camadas', async () => {
    const { client } = makeClient();
    renderPage(client, 'operator');

    expect(
      await screen.findByRole('button', { name: 'Registrar camada' }),
    ).toBeInTheDocument();
    expect(
      within(await screen.findByRole('table')).getAllByRole('button', {
        name: 'Editar',
      }).length,
    ).toBeGreaterThan(0);
  });
});

describe('LittersPage: formulario de registro', () => {
  it('ofrece solo hembras como madre y solo machos como padre', async () => {
    const { client } = makeClient();
    const dialog = await openForm(client);

    const mothers = within(within(dialog).getByLabelText('Madre'))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(mothers.some((text) => text?.includes('PIG-000001'))).toBe(true);
    expect(mothers.some((text) => text?.includes('PIG-000002'))).toBe(false);

    const fathers = within(within(dialog).getByLabelText('Padre (opcional)'))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(fathers.some((text) => text?.includes('PIG-000002'))).toBe(true);
    expect(fathers.some((text) => text?.includes('PIG-000001'))).toBe(false);
  });

  it('exige la madre sin llamar a la API', async () => {
    const { client, post } = makeClient();
    const dialog = await openForm(client);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));

    expect(
      await within(dialog).findByText('Selecciona la madre de la camada.'),
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('valida que los vivos no superen el total de nacidos', async () => {
    const { client, post } = makeClient();
    const dialog = await openForm(client);

    fireEvent.change(within(dialog).getByLabelText('Madre'), {
      target: { value: 'animal-mother' },
    });
    fireEvent.change(within(dialog).getByLabelText('Total nacidos'), {
      target: { value: '5' },
    });
    fireEvent.change(within(dialog).getByLabelText('Nacidos vivos'), {
      target: { value: '6' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));

    expect(
      await within(dialog).findByText(
        'Los vivos no pueden superar el total de nacidos.',
      ),
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('pide confirmacion, permite cancelar y no registra', async () => {
    const { client, post } = makeClient();
    const dialog = await openForm(client);
    fireEvent.change(within(dialog).getByLabelText('Madre'), {
      target: { value: 'animal-mother' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));

    const confirm = await screen.findByRole('dialog', {
      name: 'Confirmar registro de la camada',
    });
    expect(within(confirm).getByText('PIG-000001')).toBeInTheDocument();

    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancelar' }));

    expect(
      screen.queryByRole('dialog', {
        name: 'Confirmar registro de la camada',
      }),
    ).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('registra la camada y refresca el listado', async () => {
    const litters: Litter[] = [];
    const { client, post } = makeClient({
      litters,
      postImpl: async (_path, body) => {
        const created: Litter = {
          ...LITTER,
          id: 'litter-nuevo',
          mother_id: (body as { mother_id: string }).mother_id,
          litter_code: 'CAM-NUEVA',
        };
        litters.unshift(created);
        return created;
      },
    });
    const dialog = await openForm(client);
    fireEvent.change(within(dialog).getByLabelText('Madre'), {
      target: { value: 'animal-mother' },
    });
    fireEvent.change(within(dialog).getByLabelText('Código de camada (opcional)'), {
      target: { value: 'CAM-NUEVA' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));

    const confirm = await screen.findByRole('dialog', {
      name: 'Confirmar registro de la camada',
    });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Registrar camada' }));

    expect(post).toHaveBeenCalledWith('/litters', {
      mother_id: 'animal-mother',
      litter_code: 'CAM-NUEVA',
    });
    expect(
      await screen.findByText('Camada registrada (CAM-NUEVA).'),
    ).toBeInTheDocument();
    expect(await screen.findByText('CAM-NUEVA')).toBeInTheDocument();
  });

  it('evita el doble envio mientras la operacion esta en curso', async () => {
    let release: (value: Litter) => void = () => {};
    const pending = new Promise<Litter>((resolve) => {
      release = resolve;
    });
    const { client, post } = makeClient({ postImpl: () => pending });
    const dialog = await openForm(client);
    fireEvent.change(within(dialog).getByLabelText('Madre'), {
      target: { value: 'animal-mother' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));

    const confirm = await screen.findByRole('dialog', {
      name: 'Confirmar registro de la camada',
    });
    const confirmButton = within(confirm).getByRole('button', {
      name: 'Registrar camada',
    });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    expect(post).toHaveBeenCalledTimes(1);

    release(LITTER);
    await screen.findByText('Camada registrada (CAM-001).');
  });
});

describe('LittersPage: edicion', () => {
  it('edita los campos permitidos y envia el PATCH', async () => {
    const { client, patch } = makeClient();
    renderPage(client);
    const table = await screen.findByRole('table');
    fireEvent.click(within(table).getByRole('button', { name: 'Editar' }));

    const dialog = await screen.findByRole('dialog', { name: 'Editar camada' });
    fireEvent.change(within(dialog).getByLabelText('Observaciones (opcional)'), {
      target: { value: 'Nota corregida' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));

    const confirm = await screen.findByRole('dialog', {
      name: 'Confirmar edición de la camada',
    });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0][0]).toBe('/litters/litter-1');
    const body = patch.mock.calls[0][1] as Record<string, unknown>;
    expect(body.notes).toBe('Nota corregida');
    expect(body.mother_id).toBe('animal-mother');
  });
});

describe('LittersPage: detalle y descendencia', () => {
  it('muestra el detalle con la descendencia de la camada', async () => {
    const { client } = makeClient();
    renderPage(client);
    await screen.findByText('CAM-001');

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'Detalle de la camada',
    });
    expect(await within(dialog).findByText('PIG-000123')).toBeInTheDocument();
    expect(within(dialog).getByText('Parto normal')).toBeInTheDocument();
  });

  it('avisa cuando la camada no tiene crias asociadas', async () => {
    const { client } = makeClient({ offspring: [] });
    renderPage(client);
    await screen.findByText('CAM-001');

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));

    expect(
      await screen.findByText(
        'Esta camada todavía no tiene crías asociadas. La asociación se realiza desde el módulo de porcinos.',
      ),
    ).toBeInTheDocument();
  });
});

describe('LittersPage: errores de escritura', () => {
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
      fireEvent.change(within(dialog).getByLabelText('Madre'), {
        target: { value: 'animal-mother' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));

      const confirm = await screen.findByRole('dialog', {
        name: 'Confirmar registro de la camada',
      });
      fireEvent.click(
        within(confirm).getByRole('button', { name: 'Registrar camada' }),
      );

      expect(await screen.findByText(message)).toBeInTheDocument();
    });
  }
});
