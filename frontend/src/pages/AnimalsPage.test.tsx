import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { makeAuthValue, makeProfile, renderWithAuth } from '../test/helpers';
import { ApiError, type ApiClient } from '../lib/http';
import type { OperationalRole } from '../config/roles';
import type { Area } from '../services/areas.service';
import type { Pen } from '../services/pens.service';
import type { Animal, AnimalLocation } from '../services/animals.service';
import type { Movement } from '../services/movements.service';
import type { HealthEvent } from '../services/health-events.service';
import { AnimalsPage } from './AnimalsPage';

const CREATED_AT = '2026-01-01T00:00:00.000Z';

const AREA_ACTIVE: Area = {
  id: 'area-1',
  name: 'Nave 1',
  description: null,
  status: 'active',
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

const PEN_INACTIVE: Pen = {
  id: 'pen-2',
  area_id: 'area-1',
  code: 'C-02',
  name: null,
  capacity: 10,
  notes: null,
  status: 'inactive',
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

const PEN_FULL: Pen = {
  id: 'pen-3',
  area_id: 'area-1',
  code: 'C-03',
  name: null,
  capacity: 1,
  notes: null,
  status: 'active',
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

const PEN_NO_CAPACITY: Pen = {
  id: 'pen-4',
  area_id: 'area-1',
  code: 'C-04',
  name: null,
  capacity: null,
  notes: null,
  status: 'active',
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

const ANIMAL_A: Animal = {
  id: 'animal-1',
  animal_code: 'PIG-000001',
  ear_tag_code: 'AR-100',
  sex: 'female',
  breed: 'Landrace',
  birth_date: '2026-01-05',
  origin: 'born_on_farm',
  mother_id: null,
  father_id: null,
  litter_id: null,
  current_pen_id: 'pen-1',
  status: 'active',
  entry_date: '2026-01-10',
  exit_date: null,
  notes: null,
  created_by: 'perfil-prueba',
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

const ANIMAL_B: Animal = {
  id: 'animal-2',
  animal_code: 'PIG-000002',
  ear_tag_code: null,
  sex: 'male',
  breed: null,
  birth_date: null,
  origin: null,
  mother_id: null,
  father_id: null,
  litter_id: null,
  current_pen_id: null,
  status: 'missing',
  entry_date: '2026-02-01',
  exit_date: null,
  notes: null,
  created_by: null,
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

const ANIMAL_SOLD: Animal = {
  ...ANIMAL_A,
  id: 'animal-3',
  animal_code: 'PIG-000003',
  ear_tag_code: 'AR-300',
  current_pen_id: null,
  status: 'sold',
  exit_date: '2026-03-01',
};

const MOVEMENT_RECENT: Movement = {
  id: 'mv-2',
  animal_id: 'animal-1',
  from_pen_id: 'pen-1',
  to_pen_id: null,
  moved_at: '2026-03-01T10:00:00.000Z',
  reason: 'sale',
  notes: null,
  recorded_by: 'perfil-prueba',
  created_at: '2026-03-01T10:00:00.000Z',
};

const MOVEMENT_OLD: Movement = {
  id: 'mv-1',
  animal_id: 'animal-1',
  from_pen_id: null,
  to_pen_id: 'pen-1',
  moved_at: '2026-01-10T08:00:00.000Z',
  reason: 'management',
  notes: 'Ingreso al corral',
  recorded_by: 'perfil-prueba',
  created_at: '2026-01-10T08:00:00.000Z',
};

const HEALTH_EVENT: HealthEvent = {
  id: 'event-1',
  animal_id: 'animal-1',
  event_type: 'observation',
  occurred_at: '2026-02-01T10:00:00.000Z',
  title: 'Apetito normal',
  description: 'Sin novedades.',
  documented_by: null,
  details: {},
  attachment_url: null,
  recorded_by: 'perfil-prueba',
  created_at: '2026-02-01T10:00:00.000Z',
  updated_at: '2026-02-01T10:00:00.000Z',
};

interface ClientOptions {
  animals?: Animal[];
  areas?: Area[];
  pens?: Pen[];
  /** Historial simulado que sirve `GET /animals/:id/movements`. */
  movements?: Movement[];
  /** Historial simulado que sirve `GET /animals/:id/health-events`. */
  healthEvents?: HealthEvent[];
  getImpl?: (path: string) => Promise<unknown>;
  postImpl?: (path: string, body: unknown) => Promise<unknown>;
  patchImpl?: (path: string, body: unknown) => Promise<unknown>;
}

function buildLocation(animal: Animal, pens: Pen[]): AnimalLocation {
  const pen = animal.current_pen_id
    ? pens.find((item) => item.id === animal.current_pen_id)
    : undefined;
  if (!pen) {
    return { animal_id: animal.id, current_pen_id: null, pen: null };
  }
  return {
    animal_id: animal.id,
    current_pen_id: pen.id,
    pen: {
      id: pen.id,
      code: pen.code,
      name: pen.name,
      status: pen.status,
      area: {
        id: AREA_ACTIVE.id,
        name: AREA_ACTIVE.name,
        status: AREA_ACTIVE.status,
      },
    },
  };
}

/** Cliente de API simulado: nunca realiza peticiones reales. */
function makeClient(options: ClientOptions = {}) {
  const animals = options.animals ?? [];
  const pens = options.pens ?? [];
  const movements = options.movements ?? [];
  const healthEvents = options.healthEvents ?? [];

  const defaultGet = async (path: string): Promise<unknown> => {
    if (path.includes('/movements')) {
      const id = path.slice('/animals/'.length, path.indexOf('/movements'));
      return movements.filter((movement) => movement.animal_id === id);
    }
    if (path.includes('/health-events')) {
      const id = path.slice('/animals/'.length, path.indexOf('/health-events'));
      return healthEvents.filter((event) => event.animal_id === id);
    }
    if (path.endsWith('/location')) {
      const id = path.slice('/animals/'.length, -'/location'.length);
      const animal = animals.find((item) => item.id === id);
      if (!animal) {
        throw new ApiError(404, 'not_found', 'no existe');
      }
      return buildLocation(animal, pens);
    }
    if (path.startsWith('/animals/')) {
      const id = path.slice('/animals/'.length);
      const animal = animals.find((item) => item.id === id);
      if (!animal) {
        throw new ApiError(404, 'not_found', 'no existe');
      }
      return animal;
    }
    if (path === '/animals') {
      return animals;
    }
    if (path === '/areas') {
      return options.areas ?? [];
    }
    if (path === '/pens') {
      return pens;
    }
    throw new Error(`Ruta no simulada: ${path}`);
  };

  const get = vi.fn(options.getImpl ?? defaultGet);
  const post = vi.fn(options.postImpl ?? (async () => ANIMAL_A));
  const patch = vi.fn(options.patchImpl ?? (async () => ANIMAL_A));

  const client = {
    get,
    post,
    patch,
    delete: vi.fn(async () => ANIMAL_A),
  } as unknown as ApiClient;

  return { client, get, post, patch };
}

function renderPage(client: ApiClient, role: OperationalRole = 'manager') {
  return renderWithAuth(<AnimalsPage />, {
    auth: makeAuthValue({
      apiClient: client,
      profile: makeProfile({ role }),
    }),
  });
}

async function openNewAnimalForm(client: ApiClient) {
  renderPage(client);
  await waitFor(() =>
    expect(screen.queryByText('Cargando porcinos…')).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Nuevo porcino' }));
  return screen.findByRole('dialog', { name: 'Nuevo porcino' });
}

describe('AnimalsPage: listado', () => {
  it('muestra el código, el arete, el estado y la ubicación', async () => {
    const { client } = makeClient({
      animals: [ANIMAL_A, ANIMAL_B],
      pens: [PEN_ACTIVE],
    });
    renderPage(client);

    expect(await screen.findByText('PIG-000001')).toBeInTheDocument();
    expect(screen.getByText('AR-100')).toBeInTheDocument();
    expect(screen.getByText('Landrace')).toBeInTheDocument();
    expect(screen.getAllByText('Activo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('No localizado').length).toBeGreaterThan(0);
    const table = screen.getByRole('table');
    // ANIMAL_A esta en C-01; ANIMAL_B no tiene corral.
    expect(within(table).getByText('C-01')).toBeInTheDocument();
    expect(within(table).getByText('Sin corral')).toBeInTheDocument();
  });

  it('muestra el estado vacío cuando no hay porcinos', async () => {
    const { client } = makeClient({ animals: [] });
    renderPage(client);

    expect(
      await screen.findByText('Todavía no hay porcinos registrados.'),
    ).toBeInTheDocument();
  });

  it('filtra por texto (código o arete) y por estado', async () => {
    const { client } = makeClient({
      animals: [ANIMAL_A, ANIMAL_B],
      pens: [PEN_ACTIVE],
    });
    renderPage(client);
    await screen.findByText('PIG-000001');

    fireEvent.change(screen.getByLabelText('Buscar porcino'), {
      target: { value: 'AR-100' },
    });
    expect(screen.getByText('PIG-000001')).toBeInTheDocument();
    expect(screen.queryByText('PIG-000002')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Buscar porcino'), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByLabelText('Filtrar por estado'), {
      target: { value: 'missing' },
    });
    const table = screen.getByRole('table');
    expect(within(table).getByText('PIG-000002')).toBeInTheDocument();
    expect(within(table).queryByText('PIG-000001')).not.toBeInTheDocument();
  });

  it('filtra por corral', async () => {
    const { client } = makeClient({
      animals: [ANIMAL_A, ANIMAL_B],
      pens: [PEN_ACTIVE],
    });
    renderPage(client);
    await screen.findByText('PIG-000001');

    fireEvent.change(screen.getByLabelText('Filtrar por corral'), {
      target: { value: 'pen-1' },
    });
    const table = screen.getByRole('table');
    expect(within(table).getByText('PIG-000001')).toBeInTheDocument();
    expect(within(table).queryByText('PIG-000002')).not.toBeInTheDocument();
  });
});

describe('AnimalsPage: estados de carga y error', () => {
  it('muestra el estado de carga mientras consulta', () => {
    const { client } = makeClient({ getImpl: () => new Promise(() => {}) });
    renderPage(client);

    expect(screen.getByText('Cargando porcinos…')).toBeInTheDocument();
  });

  it('muestra el error 503 y permite reintentar', async () => {
    let calls = 0;
    const { client } = makeClient({
      getImpl: async (path) => {
        calls += 1;
        if (calls <= 3) {
          throw new ApiError(503, 'service_unavailable', 'no disponible');
        }
        if (path === '/animals') {
          return [ANIMAL_A];
        }
        if (path === '/pens') {
          return [PEN_ACTIVE];
        }
        return [];
      },
    });
    renderPage(client);

    expect(
      await screen.findByText('No se pudieron cargar los porcinos'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('El servicio no esta disponible. Intenta mas tarde.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('PIG-000001')).toBeInTheDocument();
  });

  it('trata un fallo de red con un mensaje claro', async () => {
    const { client } = makeClient({
      getImpl: async () => {
        throw new ApiError(0, 'network_error', 'sin conexion');
      },
    });
    renderPage(client);

    expect(
      await screen.findByText('No se pudo conectar con el servidor de PigTec.'),
    ).toBeInTheDocument();
  });
});

describe('AnimalsPage: permisos por rol', () => {
  it('oculta la escritura a un rol sin permiso', async () => {
    const { client } = makeClient({ animals: [ANIMAL_A], pens: [PEN_ACTIVE] });
    renderPage(client, 'operator');

    await screen.findByText('PIG-000001');
    expect(screen.getByText('Modo consulta')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Nuevo porcino' }),
    ).not.toBeInTheDocument();
  });

  it('muestra el alta a un manager', async () => {
    const { client } = makeClient({ animals: [ANIMAL_A], pens: [PEN_ACTIVE] });
    renderPage(client, 'manager');

    await screen.findByText('PIG-000001');
    expect(
      screen.getByRole('button', { name: 'Nuevo porcino' }),
    ).toBeInTheDocument();
  });
});

describe('AnimalsPage: alta de porcinos', () => {
  it('no permite escribir el código y explica que es automático', async () => {
    const { client } = makeClient({ animals: [], pens: [PEN_ACTIVE] });
    const dialog = await openNewAnimalForm(client);

    expect(
      within(dialog).getByText('Código automático'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Código PigTec')).not.toBeInTheDocument();
  });

  it('solo ofrece corrales activos en el selector', async () => {
    const { client } = makeClient({
      animals: [],
      pens: [PEN_ACTIVE, PEN_INACTIVE],
    });
    const dialog = await openNewAnimalForm(client);

    expect(
      within(dialog).getByRole('option', { name: /C-01/ }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('option', { name: /C-02/ }),
    ).not.toBeInTheDocument();
  });

  it('avisa (sin bloquear) cuando la capacidad está completa o superada', async () => {
    const { client } = makeClient({
      animals: [{ ...ANIMAL_A, id: 'animal-x', current_pen_id: 'pen-3' }],
      pens: [PEN_ACTIVE, PEN_FULL],
    });
    const dialog = await openNewAnimalForm(client);

    fireEvent.change(within(dialog).getByLabelText('Corral inicial (opcional)'), {
      target: { value: 'pen-3' },
    });

    expect(
      within(dialog).getByText('Capacidad completa o superada'),
    ).toBeInTheDocument();
    // Aviso informativo: el botón Guardar sigue disponible.
    expect(
      within(dialog).getByRole('button', { name: 'Guardar' }),
    ).toBeEnabled();
  });

  it('indica cuando la capacidad no está registrada', async () => {
    const { client } = makeClient({
      animals: [],
      pens: [PEN_ACTIVE, PEN_NO_CAPACITY],
    });
    const dialog = await openNewAnimalForm(client);

    fireEvent.change(within(dialog).getByLabelText('Corral inicial (opcional)'), {
      target: { value: 'pen-4' },
    });

    expect(
      within(dialog).getByText('Capacidad no registrada'),
    ).toBeInTheDocument();
  });

  it('valida el arete demasiado largo sin llamar a la API', async () => {
    const { client, post } = makeClient({ animals: [], pens: [PEN_ACTIVE] });
    const dialog = await openNewAnimalForm(client);

    fireEvent.change(within(dialog).getByLabelText('Arete (opcional)'), {
      target: { value: 'x'.repeat(101) },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(
      await within(dialog).findByText(
        'El arete no puede superar 100 caracteres.',
      ),
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('registra un porcino, refresca y notifica el código generado', async () => {
    const animals: Animal[] = [];
    const { client, post } = makeClient({
      animals,
      pens: [PEN_ACTIVE],
      getImpl: async (path) => {
        if (path === '/animals') {
          return [...animals];
        }
        if (path === '/pens') {
          return [PEN_ACTIVE];
        }
        return [AREA_ACTIVE];
      },
      postImpl: async (_path, body) => {
        const created: Animal = {
          ...ANIMAL_A,
          id: 'nuevo',
          animal_code: 'PIG-000010',
          ear_tag_code: (body as { ear_tag_code: string | null }).ear_tag_code,
          current_pen_id: (body as { current_pen_id: string | null })
            .current_pen_id,
        };
        animals.push(created);
        return created;
      },
    });
    const dialog = await openNewAnimalForm(client);

    fireEvent.change(within(dialog).getByLabelText('Arete (opcional)'), {
      target: { value: 'AR-777' },
    });
    fireEvent.change(within(dialog).getByLabelText('Corral inicial (opcional)'), {
      target: { value: 'pen-1' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(post).toHaveBeenCalledWith(
      '/animals',
      expect.objectContaining({
        ear_tag_code: 'AR-777',
        current_pen_id: 'pen-1',
      }),
    );
    expect(post.mock.calls[0][1]).not.toHaveProperty('animal_code');
    expect(
      await screen.findByText('Porcino registrado con el código PIG-000010.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('PIG-000010')).toBeInTheDocument();
  });

  it('evita el doble envío mientras la operación está en curso', async () => {
    let release: (value: Animal) => void = () => {};
    const pending = new Promise<Animal>((resolve) => {
      release = resolve;
    });
    const { client, post } = makeClient({
      animals: [],
      pens: [PEN_ACTIVE],
      postImpl: () => pending,
    });
    const dialog = await openNewAnimalForm(client);

    const save = within(dialog).getByRole('button', { name: 'Guardar' });
    fireEvent.click(save);
    fireEvent.click(save);

    expect(post).toHaveBeenCalledTimes(1);
    release(ANIMAL_A);
    expect(
      await screen.findByText(/Porcino registrado con el código/),
    ).toBeInTheDocument();
  });
});

describe('AnimalsPage: detalle y edición', () => {
  it('abre el detalle y muestra la ubicación actual', async () => {
    const { client } = makeClient({ animals: [ANIMAL_A], pens: [PEN_ACTIVE] });
    renderPage(client);
    await screen.findByText('PIG-000001');

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Detalle del porcino',
    });

    expect(await within(dialog).findByText('Nave 1 · C-01')).toBeInTheDocument();
    expect(within(dialog).getByText('AR-100')).toBeInTheDocument();
  });

  it('traduce un 404 al abrir el detalle', async () => {
    const { client } = makeClient({
      animals: [ANIMAL_A],
      pens: [PEN_ACTIVE],
      getImpl: async (path) => {
        if (path.startsWith('/animals/')) {
          throw new ApiError(404, 'not_found', 'no existe');
        }
        if (path === '/animals') {
          return [ANIMAL_A];
        }
        if (path === '/pens') {
          return [PEN_ACTIVE];
        }
        return [AREA_ACTIVE];
      },
    });
    renderPage(client);
    await screen.findByText('PIG-000001');

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));

    expect(
      await screen.findByText('No se pudo cargar el porcino'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('No se encontro el registro solicitado.'),
    ).toBeInTheDocument();
  });

  it('edita desde el detalle (PATCH) sin enviar location ni status', async () => {
    const animals: Animal[] = [ANIMAL_A];
    const { client, patch } = makeClient({
      animals,
      pens: [PEN_ACTIVE],
      getImpl: async (path) => {
        if (path.endsWith('/location')) {
          return buildLocation(animals[0], [PEN_ACTIVE]);
        }
        if (path.startsWith('/animals/')) {
          return animals.find((a) => a.id === path.slice('/animals/'.length));
        }
        if (path === '/animals') {
          return [...animals];
        }
        if (path === '/pens') {
          return [PEN_ACTIVE];
        }
        return [AREA_ACTIVE];
      },
      patchImpl: async (_path, body) => {
        const updated = { ...ANIMAL_A, ...(body as object) };
        animals[0] = updated;
        return updated;
      },
    });
    renderPage(client);
    await screen.findByText('PIG-000001');

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
    const detail = await screen.findByRole('dialog', {
      name: 'Detalle del porcino',
    });
    fireEvent.click(await within(detail).findByRole('button', { name: 'Editar' }));

    const form = await screen.findByRole('dialog', { name: 'Editar porcino' });
    expect(within(form).getByText('PIG-000001')).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText('Notas (opcional)'), {
      target: { value: 'Revisado' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Guardar' }));

    expect(patch).toHaveBeenCalledWith(
      '/animals/animal-1',
      expect.objectContaining({ notes: 'Revisado' }),
    );
    expect(patch.mock.calls[0][1]).not.toHaveProperty('current_pen_id');
    expect(
      await screen.findByText('Porcino actualizado correctamente.'),
    ).toBeInTheDocument();
  });

  it('cambia el estado administrativo con confirmación', async () => {
    const { client, patch } = makeClient({
      animals: [ANIMAL_A],
      pens: [PEN_ACTIVE],
      patchImpl: async () => ({ ...ANIMAL_A, status: 'inactive' }),
    });
    renderPage(client);
    await screen.findByText('PIG-000001');

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
    const detail = await screen.findByRole('dialog', {
      name: 'Detalle del porcino',
    });
    fireEvent.click(
      await within(detail).findByRole('button', { name: 'Cambiar estado' }),
    );

    const statusDialog = await screen.findByRole('dialog', {
      name: 'Cambiar estado del porcino',
    });
    fireEvent.click(
      within(statusDialog).getByRole('button', { name: 'Guardar' }),
    );

    expect(patch).toHaveBeenCalledWith('/animals/animal-1/status', {
      status: 'inactive',
    });
    expect(
      await screen.findByText('Estado del porcino actualizado.'),
    ).toBeInTheDocument();
  });

  it('no ofrece cambiar el estado de un estado derivado', async () => {
    const { client } = makeClient({
      animals: [ANIMAL_SOLD],
      pens: [PEN_ACTIVE],
    });
    renderPage(client);
    await screen.findByText('PIG-000003');

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
    const detail = await screen.findByRole('dialog', {
      name: 'Detalle del porcino',
    });

    expect(
      await within(detail).findByText('Estado derivado'),
    ).toBeInTheDocument();
    expect(
      within(detail).queryByRole('button', { name: 'Cambiar estado' }),
    ).not.toBeInTheDocument();
  });

  it('no muestra acciones de escritura en el detalle a un rol de consulta', async () => {
    const { client } = makeClient({ animals: [ANIMAL_A], pens: [PEN_ACTIVE] });
    renderPage(client, 'veterinarian');
    await screen.findByText('PIG-000001');

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
    const detail = await screen.findByRole('dialog', {
      name: 'Detalle del porcino',
    });
    await within(detail).findByText('AR-100');

    expect(
      within(detail).queryByRole('button', { name: 'Editar' }),
    ).not.toBeInTheDocument();
    expect(
      within(detail).queryByRole('button', { name: 'Cambiar estado' }),
    ).not.toBeInTheDocument();
  });
});

describe('AnimalsPage: trazabilidad de movimientos', () => {
  it('muestra el historial del porcino en orden cronológico', async () => {
    const { client } = makeClient({
      animals: [ANIMAL_A],
      pens: [PEN_ACTIVE],
      // El backend devuelve descendente; la ficha lo muestra del más antiguo.
      movements: [MOVEMENT_RECENT, MOVEMENT_OLD],
    });
    renderPage(client);
    await screen.findByText('PIG-000001');

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
    const detail = await screen.findByRole('dialog', {
      name: 'Detalle del porcino',
    });
    fireEvent.click(
      await within(detail).findByRole('button', { name: 'Ver movimientos' }),
    );

    const history = await screen.findByRole('dialog', {
      name: 'Movimientos del porcino',
    });
    const table = await within(history).findByRole('table');
    const rows = within(table).getAllByRole('row');

    // Cabecera + 2 movimientos, del más antiguo al más reciente.
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText('Manejo')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Ingreso al corral')).toBeInTheDocument();
    expect(
      within(rows[2]).getByText('Venta (salida de la granja)'),
    ).toBeInTheDocument();
    // El historial es inmutable: la tabla no ofrece acciones.
    expect(within(table).queryByRole('button')).not.toBeInTheDocument();
  });

  it('avisa cuando el porcino todavía no tiene movimientos', async () => {
    const { client } = makeClient({
      animals: [ANIMAL_A],
      pens: [PEN_ACTIVE],
      movements: [],
    });
    renderPage(client);
    await screen.findByText('PIG-000001');

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
    const detail = await screen.findByRole('dialog', {
      name: 'Detalle del porcino',
    });
    fireEvent.click(
      await within(detail).findByRole('button', { name: 'Ver movimientos' }),
    );

    const history = await screen.findByRole('dialog', {
      name: 'Movimientos del porcino',
    });
    expect(
      await within(history).findByText(
        'Este porcino todavía no tiene movimientos registrados.',
      ),
    ).toBeInTheDocument();
    expect(within(history).queryByRole('table')).not.toBeInTheDocument();
  });

  it('traduce el error al cargar el historial y permite reintentar', async () => {
    let fail = true;
    const { client } = makeClient({
      animals: [ANIMAL_A],
      pens: [PEN_ACTIVE],
      movements: [MOVEMENT_OLD],
      getImpl: async (path) => {
        if (path.includes('/movements') && fail) {
          fail = false;
          throw new ApiError(503, 'service_unavailable', 'no disponible');
        }
        if (path.includes('/movements')) {
          return [MOVEMENT_OLD];
        }
        if (path.endsWith('/location')) {
          return buildLocation(ANIMAL_A, [PEN_ACTIVE]);
        }
        if (path.startsWith('/animals/')) {
          return ANIMAL_A;
        }
        if (path === '/animals') {
          return [ANIMAL_A];
        }
        if (path === '/pens') {
          return [PEN_ACTIVE];
        }
        return [AREA_ACTIVE];
      },
    });
    renderPage(client);
    await screen.findByText('PIG-000001');

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
    const detail = await screen.findByRole('dialog', {
      name: 'Detalle del porcino',
    });
    fireEvent.click(
      await within(detail).findByRole('button', { name: 'Ver movimientos' }),
    );

    const history = await screen.findByRole('dialog', {
      name: 'Movimientos del porcino',
    });
    expect(
      await within(history).findByText('No se pudieron cargar los movimientos'),
    ).toBeInTheDocument();
    expect(
      within(history).getByText('El servicio no esta disponible. Intenta mas tarde.'),
    ).toBeInTheDocument();

    fireEvent.click(within(history).getByRole('button', { name: 'Reintentar' }));
    expect(await within(history).findByText('Manejo')).toBeInTheDocument();
  });
});

describe('AnimalsPage: historial sanitario', () => {
  it('abre el historial sanitario del porcino desde el detalle', async () => {
    const { client } = makeClient({
      animals: [ANIMAL_A],
      pens: [PEN_ACTIVE],
      healthEvents: [HEALTH_EVENT],
    });
    renderPage(client);
    await screen.findByText('PIG-000001');

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
    const detail = await screen.findByRole('dialog', {
      name: 'Detalle del porcino',
    });
    fireEvent.click(
      await within(detail).findByRole('button', { name: 'Ver sanidad' }),
    );

    const history = await screen.findByRole('dialog', {
      name: 'Historial sanitario del porcino',
    });
    const table = await within(history).findByRole('table');
    expect(within(table).getByText('Apetito normal')).toBeInTheDocument();
    expect(within(table).getByText('Observación')).toBeInTheDocument();
    // El historial es inmutable: no hay acciones de edición ni borrado.
    expect(
      within(table).queryByRole('button', { name: /editar|eliminar|borrar/i }),
    ).not.toBeInTheDocument();
  });

  it('avisa cuando el porcino todavía no tiene eventos sanitarios', async () => {
    const { client } = makeClient({
      animals: [ANIMAL_A],
      pens: [PEN_ACTIVE],
      healthEvents: [],
    });
    renderPage(client);
    await screen.findByText('PIG-000001');

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
    const detail = await screen.findByRole('dialog', {
      name: 'Detalle del porcino',
    });
    fireEvent.click(
      await within(detail).findByRole('button', { name: 'Ver sanidad' }),
    );

    const history = await screen.findByRole('dialog', {
      name: 'Historial sanitario del porcino',
    });
    expect(
      await within(history).findByText(
        'Este porcino todavía no tiene eventos sanitarios registrados.',
      ),
    ).toBeInTheDocument();
    expect(within(history).queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('AnimalsPage: errores de escritura', () => {
  it('traduce un 422 (corral inexistente)', async () => {
    const { client } = makeClient({
      animals: [],
      pens: [PEN_ACTIVE],
      postImpl: async () => {
        throw new ApiError(422, 'invalid_reference', 'referencia invalida');
      },
    });
    const dialog = await openNewAnimalForm(client);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(
      await screen.findByText('Existe una referencia a un registro inexistente.'),
    ).toBeInTheDocument();
  });

  it('traduce un 403 (permiso denegado por el backend)', async () => {
    const { client } = makeClient({
      animals: [],
      pens: [PEN_ACTIVE],
      postImpl: async () => {
        throw new ApiError(403, 'forbidden', 'no autorizado');
      },
    });
    const dialog = await openNewAnimalForm(client);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(
      await screen.findByText('No tienes permisos para esta operacion.'),
    ).toBeInTheDocument();
  });

  it('traduce un 401 (sesión expirada)', async () => {
    const { client } = makeClient({
      animals: [],
      pens: [PEN_ACTIVE],
      postImpl: async () => {
        throw new ApiError(401, 'unauthorized', 'expirada');
      },
    });
    const dialog = await openNewAnimalForm(client);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(
      await screen.findByText('La sesion ha expirado. Vuelve a iniciar sesion.'),
    ).toBeInTheDocument();
  });

  it('traduce un 409 (conflicto)', async () => {
    const { client } = makeClient({
      animals: [],
      pens: [PEN_ACTIVE],
      postImpl: async () => {
        throw new ApiError(409, 'conflict', 'duplicado');
      },
    });
    const dialog = await openNewAnimalForm(client);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(
      await screen.findByText(
        'La operacion entra en conflicto con el estado actual.',
      ),
    ).toBeInTheDocument();
  });
});
