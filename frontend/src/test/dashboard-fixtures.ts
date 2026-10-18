import type { DashboardSummary } from '../services/dashboard.service';

/**
 * Resúmenes de ejemplo para las pruebas del dashboard.
 *
 * Son valores de prueba (no reales) que reproducen EXACTAMENTE el contrato de
 * `GET /dashboard/summary`: `EMPTY_SUMMARY` representa una base vacía y
 * `FULL_SUMMARY` una granja con datos.
 */

export const EMPTY_SUMMARY: DashboardSummary = {
  generatedAt: '2026-10-18T12:00:00.000Z',
  period: {
    month: '2026-10',
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-10-31T23:59:59.999Z',
    months: ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'],
  },
  animals: {
    total: 0,
    active: 0,
    byStatus: [
      { status: 'active', count: 0 },
      { status: 'sold', count: 0 },
      { status: 'dead', count: 0 },
      { status: 'transferred_out', count: 0 },
      { status: 'missing', count: 0 },
      { status: 'inactive', count: 0 },
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
  },
  movements: {
    month: 0,
    byMonth: [
      { month: '2026-05', count: 0 },
      { month: '2026-06', count: 0 },
      { month: '2026-07', count: 0 },
      { month: '2026-08', count: 0 },
      { month: '2026-09', count: 0 },
      { month: '2026-10', count: 0 },
    ],
  },
  healthEvents: { month: 0 },
  litters: { total: 0, month: 0 },
};

export const FULL_SUMMARY: DashboardSummary = {
  ...EMPTY_SUMMARY,
  animals: {
    total: 20,
    active: 12,
    byStatus: [
      { status: 'active', count: 12 },
      { status: 'sold', count: 3 },
      { status: 'dead', count: 1 },
      { status: 'transferred_out', count: 0 },
      { status: 'missing', count: 0 },
      { status: 'inactive', count: 4 },
    ],
  },
  pens: {
    total: 5,
    occupied: 3,
    occupancyRate: 0.6,
    capacity: {
      registered: true,
      total: 20,
      housedAnimals: 18,
      usageRate: 0.9,
      partial: false,
    },
  },
  movements: {
    month: 9,
    byMonth: [
      { month: '2026-05', count: 2 },
      { month: '2026-06', count: 0 },
      { month: '2026-07', count: 5 },
      { month: '2026-08', count: 0 },
      { month: '2026-09', count: 0 },
      { month: '2026-10', count: 9 },
    ],
  },
  healthEvents: { month: 7 },
  litters: { total: 25, month: 3 },
};
