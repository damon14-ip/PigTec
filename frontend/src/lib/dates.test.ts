import { describe, expect, it } from 'vitest';
import {
  endOfLocalDayIso,
  formatCalendarDate,
  formatDateTimeLocal,
  isValidCalendarDate,
  isValidLocalDateTime,
  localDateTimeToIso,
  startOfLocalDayIso,
} from './dates';

describe('dates: formatCalendarDate', () => {
  it('convierte una fecha de calendario a DD/MM/AAAA', () => {
    expect(formatCalendarDate('2026-03-01')).toBe('01/03/2026');
  });

  it('devuelve un guion cuando no hay valor y el original si no es valido', () => {
    expect(formatCalendarDate(null)).toBe('—');
    expect(formatCalendarDate('')).toBe('');
    expect(formatCalendarDate('no-es-fecha')).toBe('no-es-fecha');
  });
});

describe('dates: formatDateTimeLocal', () => {
  it('devuelve un guion cuando no hay valor', () => {
    expect(formatDateTimeLocal(null)).toBe('—');
  });

  it('formatea un instante en hora local', () => {
    const iso = '2026-03-05T14:30:00.000Z';
    const expected = (() => {
      const date = new Date(iso);
      const pad = (value: number) => String(value).padStart(2, '0');
      return (
        `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}` +
        ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
      );
    })();
    expect(formatDateTimeLocal(iso)).toBe(expected);
  });
});

describe('dates: validacion', () => {
  it('valida fechas de calendario reales', () => {
    expect(isValidCalendarDate('2026-03-01')).toBe(true);
    expect(isValidCalendarDate('2026-02-30')).toBe(false);
    expect(isValidCalendarDate('2026-3-1')).toBe(false);
  });

  it('valida un valor datetime-local', () => {
    expect(isValidLocalDateTime('2026-03-05T14:30')).toBe(true);
    expect(isValidLocalDateTime('2026-03-05')).toBe(false);
  });

  it('convierte datetime-local a ISO con zona', () => {
    const iso = localDateTimeToIso('2026-03-05T14:30');
    expect(iso).toBe(new Date('2026-03-05T14:30').toISOString());
  });
});

describe('dates: limites del dia local', () => {
  it('calcula el inicio y el fin del dia en ISO', () => {
    expect(startOfLocalDayIso('2026-03-01')).toBe(
      new Date('2026-03-01T00:00:00').toISOString(),
    );
    expect(endOfLocalDayIso('2026-03-01')).toBe(
      new Date('2026-03-01T23:59:59.999').toISOString(),
    );
  });

  it('devuelve undefined ante una fecha invalida', () => {
    expect(startOfLocalDayIso('2026-02-30')).toBeUndefined();
    expect(endOfLocalDayIso('')).toBeUndefined();
  });
});
