import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type {
  ProfileRepository,
  UserProfile,
} from '../src/modules/auth/profile-repository.js';
import type {
  AuthenticatedUser,
  TokenVerifier,
} from '../src/modules/auth/token-verifier.js';
import { ANIMAL_STATUSES } from '../src/modules/common/animal.js';
import { HEALTH_EVENT_TYPES } from '../src/modules/common/health-event.js';
import { MOVEMENT_REASONS } from '../src/modules/common/movement.js';
import type { ReportsRepository } from '../src/modules/reports/reports.repository.js';
import type { ReportsExportRepository } from '../src/modules/reports/export/export.repository.js';
import {
  makeExportRepository,
  type FakeExportOptions,
} from './support/reports-export-fixtures.js';

const USERS: Record<string, AuthenticatedUser> = {
  'jwt-admin': { id: 'u-admin' },
  'jwt-manager': { id: 'u-manager' },
  'jwt-operator': { id: 'u-operator' },
  'jwt-vet': { id: 'u-vet' },
  'jwt-viewer': { id: 'u-viewer' },
  'jwt-inactive': { id: 'u-inactive' },
};

const PROFILES: Record<string, UserProfile> = {
  'u-admin': { id: 'u-admin', role: 'admin', isActive: true },
  'u-manager': { id: 'u-manager', role: 'manager', isActive: true },
  'u-operator': { id: 'u-operator', role: 'operator', isActive: true },
  'u-vet': { id: 'u-vet', role: 'veterinarian', isActive: true },
  'u-viewer': { id: 'u-viewer', role: 'viewer', isActive: true },
  'u-inactive': { id: 'u-inactive', role: 'manager', isActive: false },
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

function createProfileRepository(): ProfileRepository {
  return {
    findProfileById: vi.fn(async (userId: string) => PROFILES[userId] ?? null),
  };
}

function fill<T extends string>(keys: readonly T[], value = 0): Record<T, number> {
  const record = {} as Record<T, number>;
  for (const key of keys) {
    record[key] = value;
  }
  return record;
}

/** Repositorio agregado minimo: el resumen se calcula con datos reales. */
function createReportsRepository(): ReportsRepository {
  return {
    countAnimalsByStatus: vi.fn(async () => {
      const record = fill(ANIMAL_STATUSES);
      record.active = 2;
      return record;
    }),
    countAnimalsBySex: vi.fn(async () => ({
      male: 1,
      female: 1,
      unknown: 0,
    })),
    countAnimalsByOrigin: vi.fn(async () => ({
      born_on_farm: 1,
      purchased: 1,
      transferred_in: 0,
      unknown: 0,
    })),
    scanPenOccupancy: vi.fn(async () => ({
      byPen: { p1: 1 },
      housedAnimals: 1,
      truncated: false,
    })),
    listActivePens: vi.fn(async () => [
      {
        id: 'p1',
        code: 'C-1',
        name: null,
        area_id: 'ar1',
        capacity: 10,
        status: 'active' as const,
      },
    ]),
    listAreas: vi.fn(async () => [{ id: 'ar1', name: 'Gestación' }]),
    countMovements: vi.fn(async () => 2),
    countMovementsByReason: vi.fn(async () => {
      const record = fill(MOVEMENT_REASONS);
      record.weaning = 2;
      return record;
    }),
    countHealthEventsByType: vi.fn(async () => {
      const record = fill(HEALTH_EVENT_TYPES);
      record.treatment = 1;
      return record;
    }),
    scanLitters: vi.fn(async () => ({ rows: [], truncated: false })),
  };
}

interface BuildOptions {
  exportOptions?: FakeExportOptions;
  /** Si es `false`, NO se inyecta repositorio de exportacion (fail-closed). */
  withExportRepository?: boolean;
}

function buildReportsApp(options: BuildOptions = {}) {
  const exportRepository = makeExportRepository(options.exportOptions);
  return {
    exportRepository,
    app: buildApp({
      logger: false,
      tokenVerifier: createVerifier(),
      profileRepository: createProfileRepository(),
      reportsRepository: createReportsRepository(),
      ...(options.withExportRepository === false
        ? {}
        : { reportsExportRepository: exportRepository }),
    }),
  };
}

function callExport(
  app: ReturnType<typeof buildReportsApp>['app'],
  path: string,
  token?: string,
) {
  return app.inject({
    method: 'GET',
    url: path,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

const XLSX_URL = '/reports/export/excel';
const PDF_URL = '/reports/export/pdf';

describe('reports/export: autenticacion y permisos', () => {
  it.each([XLSX_URL, `${PDF_URL}?type=general`])(
    'sin token -> 401 en %s',
    async (url) => {
      const { app } = buildReportsApp();
      expect((await callExport(app, url)).statusCode).toBe(401);
    },
  );

  it('con viewer -> 403', async () => {
    const { app } = buildReportsApp();
    const response = await callExport(app, XLSX_URL, 'jwt-viewer');
    expect(response.statusCode).toBe(403);
  });

  it('con usuario inactivo -> 403', async () => {
    const { app } = buildReportsApp();
    const response = await callExport(app, XLSX_URL, 'jwt-inactive');
    expect(response.statusCode).toBe(403);
  });

  it.each(['jwt-admin', 'jwt-manager', 'jwt-operator', 'jwt-vet'])(
    'con rol operativo %s -> 200',
    async (token) => {
      const { app } = buildReportsApp();
      const response = await callExport(app, XLSX_URL, token);
      expect(response.statusCode).toBe(200);
    },
  );
});

describe('reports/export: Excel', () => {
  it('devuelve un .xlsx descargable con cabeceras correctas', async () => {
    const { app } = buildReportsApp();
    const response = await callExport(app, XLSX_URL, 'jwt-operator');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(String(response.headers['content-disposition'])).toMatch(
      /^attachment; filename="PigTec_Reportes_KolkaPig_\d{4}-\d{2}-\d{2}\.xlsx"$/,
    );
    expect(response.headers['cache-control']).toBe('no-store');
    // La firma ZIP ('PK') confirma que es un libro .xlsx real.
    expect(response.rawPayload.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('consulta el repositorio de detalle con el JWT del usuario (RLS)', async () => {
    const { app, exportRepository } = buildReportsApp();
    await callExport(app, XLSX_URL, 'jwt-vet');

    expect(exportRepository.listAnimals).toHaveBeenCalledWith({}, 'jwt-vet');
    expect(exportRepository.listAreas).toHaveBeenCalledWith('jwt-vet');
  });

  it('propaga los filtros de la consulta al repositorio', async () => {
    const { app, exportRepository } = buildReportsApp();
    const response = await callExport(
      app,
      `${XLSX_URL}?sex=female&origin=purchased`,
      'jwt-admin',
    );

    expect(response.statusCode).toBe(200);
    expect(exportRepository.listAnimals).toHaveBeenCalledWith(
      { sex: 'female', origin: 'purchased' },
      'jwt-admin',
    );
    expect(exportRepository.listAnimalCodes).toHaveBeenCalledWith('jwt-admin');
  });
});

describe('reports/export: PDF', () => {
  it('por defecto genera el informe general', async () => {
    const { app } = buildReportsApp();
    const response = await callExport(app, PDF_URL, 'jwt-operator');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(String(response.headers['content-disposition'])).toMatch(
      /^attachment; filename="PigTec_Informe_general_\d{4}-\d{2}-\d{2}\.pdf"$/,
    );
    expect(response.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('incluye el codigo KPG-RG del formato elegido en el nombre', async () => {
    const { app } = buildReportsApp();
    const response = await callExport(
      app,
      `${PDF_URL}?type=animals`,
      'jwt-operator',
    );

    expect(response.statusCode).toBe(200);
    expect(String(response.headers['content-disposition'])).toContain(
      'KPG-RG-14',
    );
  });

  it('rechaza un tipo de documento no previsto con 400', async () => {
    const { app } = buildReportsApp();
    const response = await callExport(
      app,
      `${PDF_URL}?type=inventado`,
      'jwt-operator',
    );

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_query' });
  });
});

describe('reports/export: validacion de la consulta', () => {
  it('rechaza un enum no previsto con 400', async () => {
    const { app } = buildReportsApp();
    const response = await callExport(
      app,
      `${XLSX_URL}?sex=otro`,
      'jwt-admin',
    );

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_query' });
  });

  it('rechaza un parametro no previsto en el Excel con 400', async () => {
    const { app } = buildReportsApp();
    const response = await callExport(
      app,
      `${XLSX_URL}?type=general`,
      'jwt-admin',
    );

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_query' });
  });

  it('rechaza un rango de fechas invertido con 400', async () => {
    const { app } = buildReportsApp();
    const response = await callExport(
      app,
      `${PDF_URL}?type=movements&from=2026-05-02&to=2026-05-01`,
      'jwt-admin',
    );

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });
  });
});

describe('reports/export: fail-closed y solo lectura', () => {
  it('sin repositorio de exportacion responde 503', async () => {
    const { app } = buildReportsApp({ withExportRepository: false });
    const response = await callExport(app, XLSX_URL, 'jwt-admin');

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'service_unavailable' });
  });

  it('si el repositorio de detalle falla, responde 503 (no se inventan datos)', async () => {
    const failing = {
      listAnimals: vi.fn(async () => {
        throw new Error('sin acceso');
      }),
    } as unknown as ReportsExportRepository;
    const app = buildApp({
      logger: false,
      tokenVerifier: createVerifier(),
      profileRepository: createProfileRepository(),
      reportsRepository: createReportsRepository(),
      reportsExportRepository: failing,
    });

    const response = await callExport(app, XLSX_URL, 'jwt-admin');
    expect(response.statusCode).toBe(503);
  });

  it('el repositorio de exportacion no expone escrituras', () => {
    const repository = makeExportRepository();
    expect(Object.keys(repository)).not.toContain('insert');
    expect(Object.keys(repository)).not.toContain('update');
    expect(Object.keys(repository)).not.toContain('delete');
  });
});
