import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Limpieza automatica del DOM entre pruebas.
afterEach(() => {
  cleanup();
});

/**
 * `ResizeObserver` no existe en jsdom. Recharts (ResponsiveContainer) lo usa
 * para medir el contenedor; se proporciona un stub inerte para que los graficos
 * puedan montarse en las pruebas sin fallar.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverStub;
}

