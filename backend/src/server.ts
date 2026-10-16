import { buildApp } from './app.js';
import { loadDotEnv, parseEnv, type Env } from './config/env.js';

/**
 * Carga las variables de entorno y las valida.
 * Si la configuracion es invalida, imprime un mensaje saneado (sin valores)
 * y detiene el proceso antes de iniciar el servidor.
 */
function loadEnvOrExit(): Env {
  try {
    return parseEnv();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Configuracion de entorno invalida';
    console.error(message);
    process.exit(1);
  }
}

loadDotEnv();

const env = loadEnvOrExit();

const app = buildApp();

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
