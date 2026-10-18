import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { makeAuthValue, makeProfile, renderWithAuth } from '../test/helpers';
import { ApiError, type ApiClient } from '../lib/http';
import type { OperationalRole } from '../config/roles';
import type { Area } from '../services/areas.service';
import type { Pen } from '../services/pens.service';
import { AreasPensPage } from './AreasPensPage';

const CREATED_AT = '2026-01-01T00:00:00.000Z';

const AREA_ACTIVE: Area = {
  id: 'area-1',
  name: 'Nave 1',
  description: 'Galpón norte',
  status: 'active',
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

const AREA_INACTIVE: Area = {
  id: 'area-2',
  name: 'Nave 2 (baja)',
  description: null,
  status: 'inactive',
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

const PEN_ACTIVE: Pen = {
  id: 'pen-1',
  area_id: 'area-1',
  code: 'C-01',
  name: 'Corral 1',
  capacity: 20,
  notes: null,
  status: 'active',
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

const PEN_NO_CAPACITY: Pen = {
  id: 'pen-2',
  area_id: 'area-1',
  code: 'C-02',
  name: null,
  capacity: null,
  notes: null,
  status: 'inactive',
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

interface ClientOptions {
  areas?: Area[];
  pens?: Pen[];
  getImpl?: (path: string) => Promise<unknown>;
  postImpl?: (path: string, body: unknown) => Promise<unknown>;
  patchImpl?: (path: string, body: unknown) => Promise<unknown>;
  deleteImpl?: (path: string) => Promise<unknown>;
}

/**
 * Cliente de API simulado. Por defecto `GET /areas` y `GET /pens` devuelven los
 * datos indicados; nunca se realiza una peticion real.
 */
function makeClient(options: ClientOptions = {}) {
  const get = vi.fn(
    options.getImpl ??
      (async (path: string) =>
        path.startsWith('/areas')
          ? (options.areas ?? [])
          : (options.pens ?? [])),
  );
  const post = vi.fn(options.postImpl ?? (async () => AREA_ACTIVE));
  const patch = vi.fn(options.patchImpl ?? (async () => AREA_ACTIVE));
  const remove = vi.fn(options.deleteImpl ?? (async () => AREA_ACTIVE));

  const client = {
    get,
    post,
    patch,
    delete: remove,
  } as unknown as ApiClient;

  return { client, get, post, patch, remove };
}

function renderPage(client: ApiClient, role: OperationalRole = 'manager') {
  return renderWithAuth(<AreasPensPage />, {
    auth: makeAuthValue({
      apiClient: client,
      profile: makeProfile({ role }),
    }),
  });
}

describe('AreasPensPage: listado de areas', () => {
  it('muestra las areas reales con su estado', async () => {
    const { client } = makeClient({ areas: [AREA_ACTIVE, AREA_INACTIVE] });
    renderPage(client);

    expect(await screen.findByText('Nave 1')).toBeInTheDocument();
    expect(screen.getByText('Nave 2 (baja)')).toBeInTheDocument();
    expect(screen.getByText('Galpón norte')).toBeInTheDocument();
    expect(screen.getAllByText('Activo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Inactivo').length).toBeGreaterThan(0);
    // Solo el area activa ofrece la baja logica.
    expect(screen.getAllByRole('button', { name: 'Desactivar' })).toHaveLength(1);
  });

  it('muestra el estado vacio cuando no hay areas', async () => {
    const { client } = makeClient({ areas: [] });
    renderPage(client);

    expect(
      await screen.findByText('Todavía no hay áreas registradas.'),
    ).toBeInTheDocument();
  });

  it('filtra por estado y por texto', async () => {
    const { client } = makeClient({ areas: [AREA_ACTIVE, AREA_INACTIVE] });
    renderPage(client);
    await screen.findByText('Nave 1');

    fireEvent.change(screen.getByLabelText('Filtrar por estado'), {
      target: { value: 'inactive' },
    });
    expect(screen.queryByText('Nave 1')).not.toBeInTheDocument();
    expect(screen.getByText('Nave 2 (baja)')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filtrar por estado'), {
      target: { value: 'all' },
    });
    fireEvent.change(screen.getByLabelText('Buscar área'), {
      target: { value: 'norte' },
    });
    expect(screen.getByText('Nave 1')).toBeInTheDocument();
    expect(screen.queryByText('Nave 2 (baja)')).not.toBeInTheDocument();
  });
});

describe('AreasPensPage: listado de corrales', () => {
  it('muestra el area, la capacidad y el estado de cada corral', async () => {
    const { client } = makeClient({
      areas: [AREA_ACTIVE],
      pens: [PEN_ACTIVE, PEN_NO_CAPACITY],
    });
    renderPage(client);
    await screen.findByText('Nave 1');

    fireEvent.click(screen.getByRole('tab', { name: /Corrales/ }));

    expect(await screen.findByText('C-01')).toBeInTheDocument();
    expect(screen.getByText('C-02')).toBeInTheDocument();
    // El nombre del area aparece en el filtro (1) y en cada una de las 2 filas.
    expect(screen.getAllByText('Nave 1')).toHaveLength(3);
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('Sin registrar')).toBeInTheDocument();
  });

  it('muestra el estado vacio cuando no hay corrales', async () => {
    const { client } = makeClient({ areas: [AREA_ACTIVE], pens: [] });
    renderPage(client);
    await screen.findByText('Nave 1');

    fireEvent.click(screen.getByRole('tab', { name: /Corrales/ }));
    expect(
      await screen.findByText('Todavía no hay corrales registrados.'),
    ).toBeInTheDocument();
  });
});

describe('AreasPensPage: estados de carga y error', () => {
  it('muestra el estado de carga mientras consulta', () => {
    const { client } = makeClient({ getImpl: () => new Promise(() => {}) });
    renderPage(client);

    expect(screen.getByText('Cargando áreas…')).toBeInTheDocument();
  });

  it('muestra el error 503 y permite reintentar', async () => {
    let calls = 0;
    const { client } = makeClient({
      getImpl: async (path) => {
        if (path.startsWith('/areas')) {
          calls += 1;
          if (calls === 1) {
            throw new ApiError(503, 'service_unavailable', 'no disponible');
          }
          return [AREA_ACTIVE];
        }
        return [];
      },
    });
    renderPage(client);

    expect(
      await screen.findByText('No se pudieron cargar las áreas'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('El servicio no esta disponible. Intenta mas tarde.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Nave 1')).toBeInTheDocument();
  });

  it('trata un fallo de red con un mensaje claro', async () => {
    const { client } = makeClient({
      getImpl: async (path) => {
        if (path.startsWith('/areas')) {
          throw new ApiError(0, 'network_error', 'sin conexion');
        }
        return [];
      },
    });
    renderPage(client);

    expect(
      await screen.findByText(
        'No se pudo conectar con el servidor de PigTec.',
      ),
    ).toBeInTheDocument();
  });
});

describe('AreasPensPage: permisos por rol', () => {
  it('oculta las acciones de escritura a un rol sin permiso', async () => {
    const { client } = makeClient({
      areas: [AREA_ACTIVE],
      pens: [PEN_ACTIVE],
    });
    renderPage(client, 'operator');

    await screen.findByText('Nave 1');
    expect(screen.getByText('Modo consulta')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Nueva área' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Editar' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Desactivar' }),
    ).not.toBeInTheDocument();
  });

  it('muestra las acciones de escritura a un manager', async () => {
    const { client } = makeClient({ areas: [AREA_ACTIVE] });
    renderPage(client, 'manager');

    await screen.findByText('Nave 1');
    expect(
      screen.getByRole('button', { name: 'Nueva área' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
  });
});

describe('AreasPensPage: alta de areas', () => {
  it('valida el nombre obligatorio sin llamar a la API', async () => {
    const { client, post } = makeClient({ areas: [] });
    renderPage(client);
    await screen.findByText('Todavía no hay áreas registradas.');

    fireEvent.click(screen.getByRole('button', { name: 'Nueva área' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nueva área' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(
      await within(dialog).findByText('El nombre es obligatorio.'),
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('registra un area, refresca la tabla y notifica el exito', async () => {
    const areas: Area[] = [];
    const { client, post } = makeClient({
      getImpl: async (path) =>
        path.startsWith('/areas') ? [...areas] : [],
      postImpl: async (_path, body) => {
        const created: Area = {
          ...AREA_ACTIVE,
          id: 'nueva',
          name: (body as { name: string }).name,
        };
        areas.push(created);
        return created;
      },
    });
    renderPage(client);
    await screen.findByText('Todavía no hay áreas registradas.');

    fireEvent.click(screen.getByRole('button', { name: 'Nueva área' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nueva área' });
    fireEvent.change(within(dialog).getByLabelText('Nombre'), {
      target: { value: 'Nave 3' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(post).toHaveBeenCalledWith('/areas', {
      name: 'Nave 3',
      description: null,
    });
    expect(
      await screen.findByText('Área registrada correctamente.'),
    ).toBeInTheDocument();
    // La tabla se actualiza tras la operacion exitosa.
    expect(await screen.findByText('Nave 3')).toBeInTheDocument();
  });

  it('edita un area existente (PATCH) y refresca la tabla', async () => {
    const areas: Area[] = [AREA_ACTIVE];
    const { client, patch } = makeClient({
      getImpl: async (path) =>
        path.startsWith('/areas') ? [...areas] : [],
      patchImpl: async (path, body) => {
        const updated: Area = {
          ...AREA_ACTIVE,
          name: (body as { name: string }).name,
        };
        expect(path).toBe('/areas/area-1');
        areas[0] = updated;
        return updated;
      },
    });
    renderPage(client);
    await screen.findByText('Nave 1');

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar área' });
    fireEvent.change(within(dialog).getByLabelText('Nombre'), {
      target: { value: 'Nave renombrada' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(
      await screen.findByText('Área actualizada correctamente.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Nave renombrada')).toBeInTheDocument();
    expect(patch).toHaveBeenCalledWith('/areas/area-1', {
      name: 'Nave renombrada',
      description: 'Galpón norte',
    });
  });

  it('evita el doble envio mientras la peticion esta en curso', async () => {
    let resolvePost: (value: unknown) => void = () => {};
    const { client, post } = makeClient({
      getImpl: async (path) => (path.startsWith('/areas') ? [] : []),
      postImpl: () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    });
    renderPage(client);
    await screen.findByText('Todavía no hay áreas registradas.');

    fireEvent.click(screen.getByRole('button', { name: 'Nueva área' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nueva área' });
    fireEvent.change(within(dialog).getByLabelText('Nombre'), {
      target: { value: 'Nave 3' },
    });
    const save = within(dialog).getByRole('button', { name: 'Guardar' });
    fireEvent.click(save);
    fireEvent.click(save);

    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    resolvePost(AREA_ACTIVE);
    await screen.findByText('Área registrada correctamente.');
  });
});

describe('AreasPensPage: alta de corrales', () => {
  it('valida el area obligatoria', async () => {
    const { client, post } = makeClient({
      areas: [AREA_ACTIVE],
      pens: [],
    });
    renderPage(client);
    await screen.findByText('Nave 1');
    fireEvent.click(screen.getByRole('tab', { name: /Corrales/ }));
    await screen.findByText('Todavía no hay corrales registrados.');

    fireEvent.click(screen.getByRole('button', { name: 'Nuevo corral' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo corral' });
    fireEvent.change(within(dialog).getByLabelText('Código'), {
      target: { value: 'C-09' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(
      await within(dialog).findByText('Selecciona un área.'),
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('registra un corral asociado a un area existente', async () => {
    const pens: Pen[] = [];
    const { client, post } = makeClient({
      areas: [AREA_ACTIVE],
      getImpl: async (path) =>
        path.startsWith('/areas') ? [AREA_ACTIVE] : [...pens],
      postImpl: async (_path, body) => {
        const created: Pen = { ...PEN_ACTIVE, ...(body as object), id: 'nuevo' };
        pens.push(created);
        return created;
      },
    });
    renderPage(client);
    await screen.findByText('Nave 1');
    fireEvent.click(screen.getByRole('tab', { name: /Corrales/ }));
    await screen.findByText('Todavía no hay corrales registrados.');

    fireEvent.click(screen.getByRole('button', { name: 'Nuevo corral' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo corral' });
    fireEvent.change(within(dialog).getByLabelText('Área'), {
      target: { value: 'area-1' },
    });
    fireEvent.change(within(dialog).getByLabelText('Código'), {
      target: { value: 'C-09' },
    });
    fireEvent.change(
      within(dialog).getByLabelText('Capacidad (opcional, porcinos)'),
      { target: { value: '15' } },
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(post).toHaveBeenCalledWith('/pens', {
      area_id: 'area-1',
      code: 'C-09',
      name: null,
      capacity: 15,
      notes: null,
    });
    expect(
      await screen.findByText('Corral registrado correctamente.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('C-09')).toBeInTheDocument();
  });

  it('rechaza una capacidad que no es un entero valido', async () => {
    const { client, post } = makeClient({ areas: [AREA_ACTIVE] });
    renderPage(client);
    await screen.findByText('Nave 1');
    fireEvent.click(screen.getByRole('tab', { name: /Corrales/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Nuevo corral' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo corral' });
    fireEvent.change(within(dialog).getByLabelText('Área'), {
      target: { value: 'area-1' },
    });
    fireEvent.change(within(dialog).getByLabelText('Código'), {
      target: { value: 'C-09' },
    });
    fireEvent.change(
      within(dialog).getByLabelText('Capacidad (opcional, porcinos)'),
      { target: { value: 'diez' } },
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(
      await within(dialog).findByText(
        'La capacidad debe ser un número entero igual o mayor que 0.',
      ),
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
});

describe('AreasPensPage: confirmacion de baja logica', () => {
  it('pide confirmacion antes de desactivar y no borra fisicamente', async () => {
    const { client, remove } = makeClient({
      areas: [AREA_ACTIVE],
      deleteImpl: async () => ({ ...AREA_ACTIVE, status: 'inactive' }),
    });
    renderPage(client);
    await screen.findByText('Nave 1');

    fireEvent.click(screen.getByRole('button', { name: 'Desactivar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Desactivar área' });
    expect(remove).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Desactivar' }));
    await vi.waitFor(() =>
      expect(remove).toHaveBeenCalledWith('/areas/area-1'),
    );
    expect(
      await screen.findByText(
        'Área desactivada (baja lógica). Su historial se conserva.',
      ),
    ).toBeInTheDocument();
  });

  it('permite cancelar la confirmacion sin tocar la API', async () => {
    const { client, remove } = makeClient({ areas: [AREA_ACTIVE] });
    renderPage(client);
    await screen.findByText('Nave 1');

    fireEvent.click(screen.getByRole('button', { name: 'Desactivar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Desactivar área' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    expect(remove).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('AreasPensPage: errores de escritura', () => {
  async function submitNewArea(client: ApiClient) {
    renderPage(client);
    await screen.findByText('Todavía no hay áreas registradas.');
    fireEvent.click(screen.getByRole('button', { name: 'Nueva área' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nueva área' });
    fireEvent.change(within(dialog).getByLabelText('Nombre'), {
      target: { value: 'Nave X' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    return dialog;
  }

  it('traduce un 409 (conflicto) y mantiene el formulario abierto', async () => {
    const { client } = makeClient({
      postImpl: async () => {
        throw new ApiError(409, 'conflict', 'duplicado');
      },
    });
    await submitNewArea(client);

    expect(
      await screen.findByText(
        'La operacion entra en conflicto con el estado actual.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('dialog', { name: 'Nueva área' }),
    ).toBeInTheDocument();
  });

  it('traduce un 403 (permiso denegado por el backend)', async () => {
    const { client } = makeClient({
      postImpl: async () => {
        throw new ApiError(403, 'forbidden', 'no autorizado');
      },
    });
    await submitNewArea(client);

    expect(
      await screen.findByText('No tienes permisos para esta operacion.'),
    ).toBeInTheDocument();
  });

  it('traduce un 401 (sesion expirada)', async () => {
    const { client } = makeClient({
      postImpl: async () => {
        throw new ApiError(401, 'unauthorized', 'expirada');
      },
    });
    await submitNewArea(client);

    expect(
      await screen.findByText(
        'La sesion ha expirado. Vuelve a iniciar sesion.',
      ),
    ).toBeInTheDocument();
  });

  it('traduce un 404 (registro inexistente)', async () => {
    const { client } = makeClient({
      areas: [AREA_ACTIVE],
      deleteImpl: async () => {
        throw new ApiError(404, 'not_found', 'no existe');
      },
    });
    renderPage(client);
    await screen.findByText('Nave 1');
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Desactivar área' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Desactivar' }));

    expect(
      await screen.findByText('No se encontro el registro solicitado.'),
    ).toBeInTheDocument();
  });

  it('traduce un 422 (referencia inexistente al crear corral)', async () => {
    const { client } = makeClient({
      areas: [AREA_ACTIVE],
      postImpl: async () => {
        throw new ApiError(422, 'invalid_reference', 'area inexistente');
      },
    });
    renderPage(client);
    await screen.findByText('Nave 1');
    fireEvent.click(screen.getByRole('tab', { name: /Corrales/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Nuevo corral' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo corral' });
    fireEvent.change(within(dialog).getByLabelText('Área'), {
      target: { value: 'area-1' },
    });
    fireEvent.change(within(dialog).getByLabelText('Código'), {
      target: { value: 'C-09' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(
      await screen.findByText(
        'Existe una referencia a un registro inexistente.',
      ),
    ).toBeInTheDocument();
  });
});
