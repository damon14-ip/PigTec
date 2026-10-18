/**
 * Limite interno de solicitudes diarias a Groq.
 *
 * Implementacion en MEMORIA (primera version). Reserva el cupo de forma
 * SINCRONA antes de llamar al proveedor, de modo que dos peticiones concurrentes
 * no puedan superar el limite dentro de un mismo proceso Node.
 *
 * LIMITACIONES CONOCIDAS (importantes):
 * - El contador se reinicia al reiniciar el servidor.
 * - No se comparte entre instancias: con varias instancias o workers, cada una
 *   tendria su propio cupo y el total real podria ser `limite x instancias`.
 * - No sobrevive a despliegues con reinicio frecuente ni a entornos serverless.
 * - Reinicia a las 00:00 UTC (dia natural en UTC).
 *
 * Por tanto NO es suficiente para un despliegue multiinstancia; debera
 * sustituirse por un contador compartido y atomico (por ejemplo, en la base de
 * datos) antes de escalar. Se documenta de forma expresa en `backend/.env.example`
 * y en el informe de la etapa.
 */

export interface AssistantQuota {
  /**
   * Reserva una solicitud del dia. Devuelve `true` si queda cupo (y lo
   * descuenta) o `false` si ya se agoto. La reserva es sincrona: no hay `await`
   * entre la comprobacion y el incremento.
   */
  reserve(): boolean;
  /** Solicitudes disponibles hoy (informativo). */
  remaining(): number;
  /** Limite diario configurado. */
  limit(): number;
}

export interface InMemoryQuotaOptions {
  /** Limite diario de solicitudes. */
  limit: number;
  /** Reloj inyectable (ms desde epoch); por defecto `Date.now`. */
  now?: () => number;
}

/** Clave de dia natural en UTC (`YYYY-MM-DD`). */
function utcDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/**
 * Crea el contador diario en memoria. Nunca lanza: si se agota el cupo, las
 * llamadas devuelven `false`.
 */
export function createInMemoryAssistantQuota(
  options: InMemoryQuotaOptions,
): AssistantQuota {
  const now = options.now ?? (() => Date.now());
  let currentDay = utcDay(now());
  let used = 0;

  /** Reinicia el contador si cambio el dia UTC. */
  function rollover(): void {
    const day = utcDay(now());
    if (day !== currentDay) {
      currentDay = day;
      used = 0;
    }
  }

  return {
    reserve(): boolean {
      rollover();
      if (used >= options.limit) {
        return false;
      }

      // Incremento sincrono: equivale a una reserva atomica dentro del unico
      // hilo de JavaScript, por lo que es seguro ante concurrencia local.
      used += 1;
      return true;
    },

    remaining(): number {
      rollover();
      return Math.max(0, options.limit - used);
    },

    limit(): number {
      return options.limit;
    },
  };
}
