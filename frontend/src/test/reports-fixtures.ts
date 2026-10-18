import type { ReportsSummary } from '../services/reports.service';

/**
 * Resumenes de ejemplo para las pruebas de reportes.
 *
 * Son valores de prueba (no reales) que reproducen EXACTAMENTE el contrato de
 * `GET /reports/summary`: `EMPTY_REPORTS` representa una base vacia
 * (ceros confirmados y metricas no calculables) y `FULL_REPORTS` una granja con
 * datos. Las sumas internas son coherentes con el backend (las series y
 * distribuciones suman su total).
 */

export const EMPTY_REPORTS: ReportsSummary = {
  generatedAt: '2026-10-18T12:00:00.000Z',
  period: {
    from: '2026-05-01',
    to: '2026-10-18',
    fromIso: '2026-05-01T00:00:00.000Z',
    toIso: '2026-10-18T23:59:59.999Z',
    months: ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'],
    maxMonths: 12,
  },
  filters: {
    movementReason: null,
    healthEventType: null,
    sex: null,
    origin: null,
  },
  animals: {
    total: 0,
    byStatus: [
      { value: 'active', count: 0 },
      { value: 'sold', count: 0 },
      { value: 'dead', count: 0 },
      { value: 'transferred_out', count: 0 },
      { value: 'missing', count: 0 },
      { value: 'inactive', count: 0 },
    ],
    bySex: [
      { value: 'male', count: 0 },
      { value: 'female', count: 0 },
      { value: 'unknown', count: 0 },
    ],
    byOrigin: [
      { value: 'born_on_farm', count: 0 },
      { value: 'purchased', count: 0 },
      { value: 'transferred_in', count: 0 },
      { value: 'unknown', count: 0 },
      { value: null, count: 0 },
    ],
  },
  pens: {
    total: 0,
    occupied: 0,
    occupancyRate: null,
    capacity: {
      registered: false,
      total: null,
      housedAnimals: 0,
      usageRate: null,
      partial: false,
    },
    truncated: false,
    byPen: [],
  },
  movements: {
    total: 0,
    byMonth: [
      { month: '2026-05', count: 0 },
      { month: '2026-06', count: 0 },
      { month: '2026-07', count: 0 },
      { month: '2026-08', count: 0 },
      { month: '2026-09', count: 0 },
      { month: '2026-10', count: 0 },
    ],
    byReason: [
      { value: 'weaning', count: 0 },
      { value: 'growth_stage', count: 0 },
      { value: 'fattening', count: 0 },
      { value: 'breeding', count: 0 },
      { value: 'health_isolation', count: 0 },
      { value: 'sale', count: 0 },
      { value: 'transfer', count: 0 },
      { value: 'management', count: 0 },
      { value: 'other', count: 0 },
    ],
  },
  litters: {
    total: 0,
    truncated: false,
    complete: true,
    totalBorn: null,
    bornAlive: null,
    stillborn: null,
    averageBornAlive: null,
    recent: [],
  },
  healthEvents: {
    total: 0,
    byType: [
      { value: 'observation', count: 0 },
      { value: 'symptom_report', count: 0 },
      { value: 'documented_diagnosis', count: 0 },
      { value: 'treatment', count: 0 },
      { value: 'vaccination', count: 0 },
      { value: 'deworming', count: 0 },
      { value: 'mortality', count: 0 },
      { value: 'recovery', count: 0 },
      { value: 'other', count: 0 },
    ],
  },
};

export const FULL_REPORTS: ReportsSummary = {
  ...EMPTY_REPORTS,
  animals: {
    total: 120,
    byStatus: [
      { value: 'active', count: 92 },
      { value: 'sold', count: 10 },
      { value: 'dead', count: 6 },
      { value: 'transferred_out', count: 4 },
      { value: 'missing', count: 2 },
      { value: 'inactive', count: 6 },
    ],
    bySex: [
      { value: 'male', count: 40 },
      { value: 'female', count: 72 },
      { value: 'unknown', count: 8 },
    ],
    byOrigin: [
      { value: 'born_on_farm', count: 80 },
      { value: 'purchased', count: 30 },
      { value: 'transferred_in', count: 6 },
      { value: 'unknown', count: 2 },
      { value: null, count: 2 },
    ],
  },
  pens: {
    total: 8,
    occupied: 6,
    occupancyRate: 0.75,
    capacity: {
      registered: true,
      total: 200,
      housedAnimals: 150,
      usageRate: 0.75,
      partial: false,
    },
    truncated: false,
    byPen: [
      {
        id: 'p1',
        code: 'C-1',
        name: 'Gestacion 1',
        area_name: 'Gestacion',
        capacity: 30,
        occupants: 28,
        usageRate: 28 / 30,
      },
      {
        id: 'p2',
        code: 'C-2',
        name: null,
        area_name: 'Gestacion',
        capacity: 30,
        occupants: 30,
        usageRate: 1,
      },
      {
        id: 'p3',
        code: 'C-3',
        name: 'Engorde 1',
        area_name: 'Engorde',
        capacity: null,
        occupants: 12,
        usageRate: null,
      },
    ],
  },
  movements: {
    total: 32,
    byMonth: [
      { month: '2026-05', count: 4 },
      { month: '2026-06', count: 6 },
      { month: '2026-07', count: 2 },
      { month: '2026-08', count: 8 },
      { month: '2026-09', count: 5 },
      { month: '2026-10', count: 7 },
    ],
    byReason: [
      { value: 'weaning', count: 6 },
      { value: 'growth_stage', count: 4 },
      { value: 'fattening', count: 3 },
      { value: 'breeding', count: 2 },
      { value: 'health_isolation', count: 2 },
      { value: 'sale', count: 5 },
      { value: 'transfer', count: 4 },
      { value: 'management', count: 5 },
      { value: 'other', count: 1 },
    ],
  },
  litters: {
    total: 12,
    truncated: false,
    complete: true,
    totalBorn: 130,
    bornAlive: 118,
    stillborn: 12,
    averageBornAlive: 118 / 12,
    recent: [
      {
        id: 'l1',
        litter_code: 'CAM-2026-012',
        birth_date: '2026-10-05',
        total_born: 11,
        born_alive: 10,
        stillborn: 1,
      },
      {
        id: 'l2',
        litter_code: 'CAM-2026-011',
        birth_date: '2026-09-20',
        total_born: 9,
        born_alive: 8,
        stillborn: 1,
      },
    ],
  },
  healthEvents: {
    total: 24,
    byType: [
      { value: 'observation', count: 6 },
      { value: 'symptom_report', count: 5 },
      { value: 'documented_diagnosis', count: 3 },
      { value: 'treatment', count: 4 },
      { value: 'vaccination', count: 3 },
      { value: 'deworming', count: 1 },
      { value: 'mortality', count: 1 },
      { value: 'recovery', count: 1 },
      { value: 'other', count: 0 },
    ],
  },
};
