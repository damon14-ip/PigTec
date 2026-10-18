import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { makeAuthValue, makeProfile, renderWithAuth } from '../test/helpers';
import { ApiError, type ApiClient } from '../lib/http';
import type { OperationalRole } from '../config/roles';
import type { Animal, AnimalLocation } from '../services/animals.service';
import type { Area } from '../services/areas.service';
import type { Pen } from '../services/pens.service';
import type { Movement } from '../services/movements.service';
import {
  formatMovementDateTime,
  endOfDayIso,
  startOfDayIso,
} from '../components/movements/labels';
import { MovementsPage } from './MovementsPage';

const CREATED_AT = '2026-01-01T00:00:00.000Z';

const AREA_1: Area = {
  id: 'area-1',
  name: 'Nave 1',
  description: null,
  status: 'active',
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

const PEN_1: Pen = {
  id: 'pen-1',
  area_id: 'area-1',
  code: 'C-01',
  name: null,
  capacity: 20,
  notes: null,
  status: 'active',
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

const PEN_2: Pen = {
  id: 'pen-2',
  area_id: 'area-1',
  code: 'C-02',
  name: 'Corral 2',
  capacity: 20,
  notes: null,
  status: 'active',
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

const PEN_INACTIVE: Pen = {
  id: 'pen-3',
  area_id: 'area-1',
  code: 'C-03',
  name: null,
  capacity: 10,
  notes: null,
  status: 'inactive',
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

const ANIMAL_A: Animal = {
  id: 'animal-1',
  animal_code: 'PIG-000001',
  ear_tag_code: 'AR-100',
  sex: 'female',
  breed: 'Landrace',
  birth_date: null,
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

const ANIMAL_SOLD: Animal = {
  ...ANIMAL_A,
  id: 'animal-3',
  animal_code: 'PIG-000003',
  ear_tag_code: null,
  status: 'sold',
  current_pen_id: null,
  exit_date: '2026-02-01',
};

const MOVEMENT_MANAGEMENT: Movement = {
  id: 'mv-1',
  animal_id: 'animal-1',
  from_pen_id: 'pen-1',
  to_pen_id: 'pen-2',
  moved_at: '2026-03-01T10:00:00.000Z',
  reason: 'management',
  notes: 'Cambio de corral',
  recorded_by: 'perfil-prueba',
  created_at: '2026-03-01T10:00:00.000Z',
};

const MOVEMENT_SALE: Movement = {
  id: 'mv-2',
  animal_id: 'animal-1',
  from_pen_id: 'pen-2',
  to_pen_id: null,
  moved_at: '2026-02-01T08:30:00.000Z',
  reason: 'sale',
  notes: null,
  recorded_by: 'perfil-prueba',
  created_at: '2026-02-01T08:30:00.000Z',
};

interface ClientOptions {
  movements?: Movement[];
  animals?: Animal[];
  areas?: Area[];
  pens?: Pen[];
  /**
   * Implementacion de `GET`. Recibe un `fallback` con el comportamiento por
   * defecto (catálogos + página de movimientos) para probar fallos parciales.
   */
  getImpl?: (
    path: string,
    fallback: (path: string) => Promise<unknown>,
  ) => Promise<unknown>;
  postImpl?: (path: string, body: unknown) => Promise<unknown>;
}

/** Lee el `query string` de una ruta simulada. */
function queryOf(path: string): URLSearchParams {
  const index = path.indexOf('?');
  return new URLSearchParams(index === -1 ? '' : path.slice(index + 1));
}

function buildLocation(
  animal: Animal,
  pens: Pen[],
  areas: Area[],
): AnimalLocation {
  const pen = animal.current_pen_id
    ? pens.find((item) => item.id === animal.current_pen_id)
    : undefined;
  if (!pen) {
    return { animal_id: animal.id, current_pen_id: null, pen: null };
  }
  const area = areas.find((item) => item.id === pen.area_id);
  return {
    animal_id: animal.id,
    current_pen_id: pen.id,
    pen: {
      id: pen.id,
      code: pen.code,
      name: pen.name,
      status: pen.status,
      area: area
        ? { id: area.id, name: area.name, status: area.status }
        : null,
    },
  };
}

/** Cliente de API simulado: nunca realiza peticiones reales. */
function makeClient(options: ClientOptions = {}) {
  const movements = options.movements ?? [];
  const animals = options.animals ?? [];
  const areas = options.areas ?? [];
  const pens = options.pens ?? [];

  const defaultGet = async (path: string): Promise<unknown> => {
    if (path === '/areas') {
      return areas;
    }
    if (path === '/pens') {
      return pens;
    }
    if (path === '/animals') {
      return animals;
    }
    if (path.startsWith('/animals/') && path.endsWith('/location')) {
      const id = path.slice('/animals/'.length, -'/location'.length);
      const animal = animals.find((item) => item.id === id);
      if (!animal) {
        throw new ApiError(404, 'not_found', 'no existe');
      }
      return buildLocation(animal, pens, areas);
    }
    if (path === '/movements' || path.startsWith('/movements?')) {
      const query = queryOf(path);
      const offset = Number(query.get('offset') ?? '0');
      const limit = Number(query.get('limit') ?? '100');
      const reason = query.get('reason');
      const animalId = query.get('animal_id');
      const penId = query.get('pen_id');
      let rows = movements;
      if (reason) {
        rows = rows.filter((movement) => movement.reason === reason);
      }
      if (animalId) {
        rows = rows.filter((movement) => movement.animal_id === animalId);
      }
      if (penId) {
        rows = rows.filter(
          (movement) =>
            movement.from_pen_id === penId || movement.to_pen_id === penId,
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
  const post = vi.fn(options.postImpl ?? (async () => MOVEMENT_MANAGEMENT));

  const client = {
    get,
    post,
    patch: vi.fn(async () => MOVEMENT_MANAGEMENT),
    delete: vi.fn(async () => MOVEMENT_MANAGEMENT),
  } as unknown as ApiClient;

  return { client, get, post };
}

function renderPage(client: ApiClient, role: OperationalRole = 'manager') {
  return renderWithAuth(<MovementsPage />, {
    auth: makeAuthValue({
      apiClient: client,
      profile: makeProfile({ role }),
    }),
  });
}

/** Última ruta de `GET /movements` solicitada. */
function lastMovementsPath(get: ReturnType<typeof vi.fn>): string {
  const paths = get.mock.calls
    .map((call) => call[0] as string)
    .filter((path) => path === '/movements' || path.startsWith('/movements?'));
  return paths[paths.length - 1];
}

async function openForm(client: ApiClient, role: OperationalRole = 'manager') {
  renderPage(client, role);
  const button = await screen.findByRole('button', {
    name: 'Registrar movimiento',
  });
  fireEvent.click(button);
  return screen.findByRole('dialog', { name: 'Registrar movimiento' });
}

/** Selecciona el porcino y espera a que llegue su ubicación actual. */
async function selectAnimal(
  dialog: HTMLElement,
  animalId = 'animal-1',
  locationText = 'Nave 1 · C-01',
) {
  fireEvent.change(within(dialog).getByLabelText('Porcino'), {
    target: { value: animalId },
  });
  if (locationText) {
    await within(dialog).findByText(locationText);
  }
}

/** Completa un movimiento válido y llega hasta la confirmación. */
async function fillAndConfirm(dialog: HTMLElement) {
  await selectAnimal(dialog);
  fireEvent.change(within(dialog).getByLabelText('Tipo de movimiento'), {
    target: { value: 'management' },
  });
  fireEvent.change(within(dialog).getByLabelText('Corral destino'), {
    target: { value: 'pen-2' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));
  return screen.findByRole('dialog', {
    name: 'Confirmar registro del movimiento',
  });
}

function baseOptions(): ClientOptions {
  return {
    movements: [MOVEMENT_MANAGEMENT, MOVEMENT_SALE],
    animals: [ANIMAL_A, ANIMAL_SOLD],
    areas: [AREA_1],
    pens: [PEN_1, PEN_2, PEN_INACTIVE],
  };
}

describe('MovementsPage: listado', () => {
  it('muestra fecha, porcino, tipo, origen, destino y observaciones', async () => {
    const { client } = makeClient(baseOptions());
    renderPage(client);

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Manejo')).toBeInTheDocument();
    expect(within(table).getAllByText('PIG-000001').length).toBeGreaterThan(0);
    expect(within(table).getByText('Nave 1 · C-01')).toBeInTheDocument();
    expect(
      within(table).getAllByText('Nave 1 · C-02 · Corral 2').length,
    ).toBeGreaterThan(0);
    expect(within(table).getByText('Cambio de corral')).toBeInTheDocument();
    expect(
      within(table).getByText(formatMovementDateTime(MOVEMENT_MANAGEMENT.moved_at)),
    ).toBeInTheDocument();
    // La venta no tiene destino: se explica la salida.
    expect(
      within(table).getByText('Venta (salida de la granja)'),
    ).toBeInTheDocument();
    expect(within(table).getByText('Salida de la granja')).toBeInTheDocument();
    // El historial no ofrece edición ni eliminación.
    expect(within(table).queryByRole('button')).not.toBeInTheDocument();
  });

  it('muestra el estado vacío cuando no hay movimientos', async () => {
    const { client } = makeClient({ ...baseOptions(), movements: [] });
    renderPage(client);

    expect(
      await screen.findByText('Todavía no hay movimientos registrados.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('MovementsPage: estados de carga y error', () => {
  it('muestra el estado de carga mientras consulta', () => {
    const { client } = makeClient({ getImpl: () => new Promise(() => {}) });
    renderPage(client);

    expect(screen.getByText('Cargando movimientos…')).toBeInTheDocument();
  });

  it('muestra el error 503 y permite reintentar', async () => {
    let fail = true;
    const { client } = makeClient({
      ...baseOptions(),
      getImpl: async (path, fallback) => {
        if (path.startsWith('/movements') && fail) {
          fail = false;
          throw new ApiError(503, 'service_unavailable', 'no disponible');
        }
        return fallback(path);
      },
    });
    renderPage(client);

    expect(
      await screen.findByText('No se pudieron cargar los movimientos'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('El servicio no esta disponible. Intenta mas tarde.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Manejo')).toBeInTheDocument();
  });

  it('trata un fallo de red con un mensaje claro', async () => {
    const { client } = makeClient({
      ...baseOptions(),
      getImpl: async (path, fallback) => {
        if (path.startsWith('/movements')) {
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

  it('avisa cuando fallan los catálogos sin bloquear el historial', async () => {
    const { client } = makeClient({
      ...baseOptions(),
      getImpl: async (path, fallback) => {
        if (path === '/animals' || path === '/pens' || path === '/areas') {
          throw new ApiError(503, 'service_unavailable', 'no disponible');
        }
        return fallback(path);
      },
    });
    renderPage(client);

    expect(
      await screen.findByText('No se pudieron cargar los catálogos'),
    ).toBeInTheDocument();
    // El historial sigue siendo consultable; el código no se puede resolver.
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Manejo')).toBeInTheDocument();
    expect(
      within(table).getAllByText('Código no disponible').length,
    ).toBeGreaterThan(0);
  });
});

describe('MovementsPage: filtros y paginación', () => {
  it('filtra por tipo de movimiento (reason)', async () => {
    const { client, get } = makeClient(baseOptions());
    renderPage(client);
    await screen.findByText('Manejo');

    fireEvent.change(screen.getByLabelText('Filtrar por tipo de movimiento'), {
      target: { value: 'sale' },
    });

    await waitFor(() =>
      expect(
        within(screen.getByRole('table')).queryByText('Manejo'),
      ).not.toBeInTheDocument(),
    );
    expect(queryOf(lastMovementsPath(get)).get('reason')).toBe('sale');
    expect(
      within(screen.getByRole('table')).getByText(
        'Venta (salida de la granja)',
      ),
    ).toBeInTheDocument();
  });

  it('filtra por corral (pen_id) y por rango de fechas', async () => {
    const { client, get } = makeClient(baseOptions());
    renderPage(client);
    await screen.findByText('Manejo');

    fireEvent.change(screen.getByLabelText('Filtrar por corral'), {
      target: { value: 'pen-1' },
    });
    await waitFor(() =>
      expect(queryOf(lastMovementsPath(get)).get('pen_id')).toBe('pen-1'),
    );

    fireEvent.change(screen.getByLabelText('Desde'), {
      target: { value: '2026-01-01' },
    });
    fireEvent.change(screen.getByLabelText('Hasta'), {
      target: { value: '2026-01-31' },
    });

    await waitFor(() => {
      const query = queryOf(lastMovementsPath(get));
      expect(query.get('moved_from')).toBe(startOfDayIso('2026-01-01'));
      expect(query.get('moved_to')).toBe(endOfDayIso('2026-01-31'));
    });
  });

  it('busca por porcino y envía su animal_id real', async () => {
    const { client, get } = makeClient(baseOptions());
    renderPage(client);
    await screen.findByText('Manejo');

    fireEvent.change(screen.getByLabelText('Buscar porcino'), {
      target: { value: 'PIG-000001' },
    });

    await waitFor(() =>
      expect(queryOf(lastMovementsPath(get)).get('animal_id')).toBe('animal-1'),
    );
    expect(
      within(screen.getByRole('table')).getByText('Manejo'),
    ).toBeInTheDocument();
  });

  it('avisa cuando el texto buscado no coincide con ningún porcino', async () => {
    const { client } = makeClient(baseOptions());
    renderPage(client);
    await screen.findByText('Manejo');

    fireEvent.change(screen.getByLabelText('Buscar porcino'), {
      target: { value: 'PIG-999999' },
    });

    expect(
      await screen.findByText(
        'Escribe el código PigTec exacto del porcino o selecciónalo de las sugerencias.',
      ),
    ).toBeInTheDocument();
  });

  it('pagina con limit/offset y sin inventar el total', async () => {
    const many: Movement[] = Array.from({ length: 25 }, (_, index) => ({
      ...MOVEMENT_MANAGEMENT,
      id: `mv-${index}`,
      moved_at: `2026-03-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
    }));
    const { client, get } = makeClient({ ...baseOptions(), movements: many });
    renderPage(client);
    await screen.findByText('Página 1');

    expect(queryOf(lastMovementsPath(get)).get('limit')).toBe('20');
    expect(queryOf(lastMovementsPath(get)).get('offset')).toBe('0');
    // 20 filas + la cabecera.
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(
      21,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

    expect(await screen.findByText('Página 2')).toBeInTheDocument();
    expect(queryOf(lastMovementsPath(get)).get('offset')).toBe('20');
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(
      6,
    );
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(await screen.findByText('Página 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
  });

  it('limita los filtros al rango real del backend (limit 20 máx. 500 en la API)', async () => {
    const { client, get } = makeClient(baseOptions());
    renderPage(client);
    await screen.findByText('Manejo');

    // Nunca se pide un limit fuera del rango aceptado por el esquema del backend.
    const limit = Number(queryOf(lastMovementsPath(get)).get('limit'));
    expect(limit).toBeGreaterThanOrEqual(1);
    expect(limit).toBeLessThanOrEqual(500);
  });
});

describe('MovementsPage: permisos por rol', () => {
  it('un veterinarian solo puede registrar aislamiento sanitario', async () => {
    const { client } = makeClient(baseOptions());
    const dialog = await openForm(client, 'veterinarian');
    const select = within(dialog).getByLabelText('Tipo de movimiento');
    const options = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent);

    expect(options).toEqual(['Selecciona el tipo…', 'Aislamiento sanitario']);
  });

  it('un operator no puede registrar ventas ni transferencias externas', async () => {
    const { client } = makeClient(baseOptions());
    const dialog = await openForm(client, 'operator');

    fireEvent.change(within(dialog).getByLabelText('Tipo de movimiento'), {
      target: { value: 'transfer' },
    });

    expect(
      within(dialog).queryByRole('option', { name: 'Venta (salida de la granja)' }),
    ).not.toBeInTheDocument();
    // El traslado del operator siempre es interno: exige corral destino.
    expect(within(dialog).getByLabelText('Corral destino')).toBeInTheDocument();
    expect(
      within(dialog).queryByLabelText(
        'El animal sale de la granja (transferencia externa, sin corral destino)',
      ),
    ).not.toBeInTheDocument();
  });

  it('un manager puede registrar todos los tipos y la transferencia externa', async () => {
    const { client } = makeClient(baseOptions());
    const dialog = await openForm(client, 'manager');
    const select = within(dialog).getByLabelText('Tipo de movimiento');
    const options = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent);

    expect(options).toContain('Venta (salida de la granja)');
    expect(options).toContain('Traslado');

    fireEvent.change(select, { target: { value: 'transfer' } });
    const checkbox = within(dialog).getByLabelText(
      'El animal sale de la granja (transferencia externa, sin corral destino)',
    );
    fireEvent.click(checkbox);
    // Con salida externa desaparece el corral destino.
    expect(
      within(dialog).queryByLabelText('Corral destino'),
    ).not.toBeInTheDocument();
  });
});

describe('MovementsPage: formulario dinámico', () => {
  it('muestra la ubicación actual del porcino seleccionado', async () => {
    const { client } = makeClient(baseOptions());
    const dialog = await openForm(client);

    await selectAnimal(dialog);

    expect(within(dialog).getByText('Nave 1 · C-01')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'El corral de origen lo registra el sistema con la ubicación vigente del porcino; no se elige manualmente.',
      ),
    ).toBeInTheDocument();
  });

  it('la venta no pide corral destino y explica sus efectos', async () => {
    const { client } = makeClient(baseOptions());
    const dialog = await openForm(client);
    await selectAnimal(dialog);

    fireEvent.change(within(dialog).getByLabelText('Tipo de movimiento'), {
      target: { value: 'sale' },
    });

    expect(
      within(dialog).queryByLabelText('Corral destino'),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByText(/no lleva corral destino/),
    ).toBeInTheDocument();
  });

  it('ofrece como destino solo corrales activos distintos del actual', async () => {
    const { client } = makeClient(baseOptions());
    const dialog = await openForm(client);
    await selectAnimal(dialog);

    fireEvent.change(within(dialog).getByLabelText('Tipo de movimiento'), {
      target: { value: 'management' },
    });

    const destination = within(dialog).getByLabelText('Corral destino');
    const options = within(destination)
      .getAllByRole('option')
      .map((option) => option.textContent);

    expect(options).toContain('Nave 1 · C-02 · Corral 2');
    // El corral actual (origen) y los inactivos no se ofrecen.
    expect(options).not.toContain('Nave 1 · C-01');
    expect(options).not.toContain('Nave 1 · C-03');
  });

  it('explica el aislamiento sanitario', async () => {
    const { client } = makeClient(baseOptions());
    const dialog = await openForm(client, 'veterinarian');
    await selectAnimal(dialog);

    fireEvent.change(within(dialog).getByLabelText('Tipo de movimiento'), {
      target: { value: 'health_isolation' },
    });

    expect(
      within(dialog).getByText('Aislamiento sanitario', { selector: '.alert__title' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Corral destino')).toBeInTheDocument();
  });
});

describe('MovementsPage: validaciones', () => {
  it('exige porcino y tipo sin llamar a la API', async () => {
    const { client, post } = makeClient(baseOptions());
    const dialog = await openForm(client);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));

    expect(
      await within(dialog).findByText('Selecciona un porcino.'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('Selecciona el tipo de movimiento.'),
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('dialog', {
        name: 'Confirmar registro del movimiento',
      }),
    ).not.toBeInTheDocument();
  });

  it('bloquea porcinos en estados que no admiten movimientos', async () => {
    const { client, post } = makeClient(baseOptions());
    const dialog = await openForm(client);
    await selectAnimal(dialog, 'animal-3', '');

    fireEvent.change(within(dialog).getByLabelText('Tipo de movimiento'), {
      target: { value: 'management' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));

    expect(
      await within(dialog).findByText(
        'El porcino no admite movimientos en estado Vendido.',
      ),
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('exige corral destino en los motivos internos', async () => {
    const { client, post } = makeClient(baseOptions());
    const dialog = await openForm(client);
    await selectAnimal(dialog);

    fireEvent.change(within(dialog).getByLabelText('Tipo de movimiento'), {
      target: { value: 'fattening' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));

    expect(
      await within(dialog).findByText('Selecciona el corral destino.'),
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('limita las observaciones a 2000 caracteres', async () => {
    const { client, post } = makeClient(baseOptions());
    const dialog = await openForm(client);
    await selectAnimal(dialog);

    fireEvent.change(within(dialog).getByLabelText('Tipo de movimiento'), {
      target: { value: 'management' },
    });
    fireEvent.change(within(dialog).getByLabelText('Corral destino'), {
      target: { value: 'pen-2' },
    });
    fireEvent.change(within(dialog).getByLabelText('Observaciones (opcional)'), {
      target: { value: 'x'.repeat(2001) },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));

    expect(
      await within(dialog).findByText(
        'Las observaciones no pueden superar 2000 caracteres.',
      ),
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
});

describe('MovementsPage: confirmación y registro', () => {
  it('pide confirmación explícita y se puede cancelar sin registrar', async () => {
    const { client, post } = makeClient(baseOptions());
    const dialog = await openForm(client);
    const confirm = await fillAndConfirm(dialog);

    expect(within(confirm).getByText('PIG-000001')).toBeInTheDocument();
    expect(within(confirm).getByText('Manejo')).toBeInTheDocument();
    expect(
      within(confirm).getByText('Nave 1 · C-02 · Corral 2'),
    ).toBeInTheDocument();
    expect(
      within(confirm).getByText('Ahora (la fija el sistema)'),
    ).toBeInTheDocument();

    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancelar' }));

    expect(
      screen.queryByRole('dialog', {
        name: 'Confirmar registro del movimiento',
      }),
    ).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    // El formulario conserva lo indicado.
    expect(within(dialog).getByLabelText('Tipo de movimiento')).toHaveValue(
      'management',
    );
  });

  it('registra el movimiento, notifica y refresca las vistas', async () => {
    const movements: Movement[] = [];
    const { client, get, post } = makeClient({
      ...baseOptions(),
      movements,
      postImpl: async (_path, body) => {
        const created: Movement = {
          ...MOVEMENT_MANAGEMENT,
          id: 'mv-nuevo',
          animal_id: (body as { animal_id: string }).animal_id,
          reason: (body as { reason: Movement['reason'] }).reason,
          to_pen_id: (body as { to_pen_id: string | null }).to_pen_id,
          notes: 'Registrado en la prueba',
        };
        movements.unshift(created);
        return created;
      },
    });
    const dialog = await openForm(client);
    const confirm = await fillAndConfirm(dialog);

    fireEvent.click(
      within(confirm).getByRole('button', { name: 'Registrar movimiento' }),
    );

    expect(post).toHaveBeenCalledWith('/movements', {
      animal_id: 'animal-1',
      reason: 'management',
      to_pen_id: 'pen-2',
    });
    const body = post.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('from_pen_id');
    expect(body).not.toHaveProperty('recorded_by');

    expect(
      await screen.findByText(
        'Movimiento registrado para el porcino PIG-000001.',
      ),
    ).toBeInTheDocument();
    // El formulario se cierra y el historial se recarga con el nuevo registro.
    expect(
      screen.queryByRole('dialog', { name: 'Registrar movimiento' }),
    ).not.toBeInTheDocument();
    expect(await screen.findByText('Registrado en la prueba')).toBeInTheDocument();
    // Los catálogos también se refrescan (la ubicación la deriva la base).
    await waitFor(() =>
      expect(
        get.mock.calls.filter((call) => call[0] === '/animals').length,
      ).toBeGreaterThan(1),
    );
  });

  it('envía la fecha y hora indicadas en ISO con zona', async () => {
    const { client, post } = makeClient(baseOptions());
    const dialog = await openForm(client);
    await selectAnimal(dialog);

    fireEvent.change(within(dialog).getByLabelText('Tipo de movimiento'), {
      target: { value: 'management' },
    });
    fireEvent.change(within(dialog).getByLabelText('Corral destino'), {
      target: { value: 'pen-2' },
    });
    fireEvent.change(within(dialog).getByLabelText('Fecha y hora (opcional)'), {
      target: { value: '2026-04-01T08:30' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));

    const confirm = await screen.findByRole('dialog', {
      name: 'Confirmar registro del movimiento',
    });
    fireEvent.click(
      within(confirm).getByRole('button', { name: 'Registrar movimiento' }),
    );

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const body = post.mock.calls[0][1] as { moved_at?: string };
    expect(body.moved_at).toBe(new Date('2026-04-01T08:30').toISOString());
  });

  it('evita el doble envío mientras la operación está en curso', async () => {
    let release: (value: Movement) => void = () => {};
    const pending = new Promise<Movement>((resolve) => {
      release = resolve;
    });
    const { client, post } = makeClient({
      ...baseOptions(),
      postImpl: () => pending,
    });
    const dialog = await openForm(client);
    const confirm = await fillAndConfirm(dialog);

    const confirmButton = within(confirm).getByRole('button', {
      name: 'Registrar movimiento',
    });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    expect(post).toHaveBeenCalledTimes(1);

    release(MOVEMENT_MANAGEMENT);
    expect(
      await screen.findByText(
        'Movimiento registrado para el porcino PIG-000001.',
      ),
    ).toBeInTheDocument();
  });
});

describe('MovementsPage: errores de escritura', () => {
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
        ...baseOptions(),
        postImpl: async () => {
          throw new ApiError(status, code, 'fallo simulado');
        },
      });
      const dialog = await openForm(client);
      const confirm = await fillAndConfirm(dialog);

      fireEvent.click(
        within(confirm).getByRole('button', { name: 'Registrar movimiento' }),
      );

      expect(await screen.findByText(message)).toBeInTheDocument();
      // El formulario sigue abierto para corregir.
      expect(
        screen.getByRole('dialog', { name: 'Registrar movimiento' }),
      ).toBeInTheDocument();
    });
  }
});
