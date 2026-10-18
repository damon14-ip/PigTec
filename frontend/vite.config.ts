import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Configuracion de Vite y Vitest del frontend de PigTec.
 *
 * El servidor de desarrollo escucha en 127.0.0.1:5173 para trabajar junto al
 * backend local (http://127.0.0.1:3000). No se configura PWA ni service worker.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,
  },
});
