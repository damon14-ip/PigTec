import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Contrato de la migracion 008 (generacion de `animal_code`) respecto del
 * backend y de las migraciones previas.
 *
 * Sin conexion a Supabase no se puede ejecutar la secuencia; estas pruebas
 * verifican por lectura del script las invariantes acordadas: transaccionalidad,
 * secuencia dedicada, formato `PIG-000001`, sincronizacion con codigos
 * existentes, asignacion solo cuando falta el codigo, inmutabilidad en UPDATE,
 * privilegios minimos y que NO se alteren las politicas RLS.
 */
const MIGRATION = readFileSync(
  new URL('../../database/migrations/008_animal_code_generation.sql', import.meta.url),
  'utf8',
);

describe('migracion 008: generacion de animal_code', () => {
  it('es transaccional', () => {
    expect(MIGRATION).toMatch(/\bBEGIN\s*;/);
    expect(MIGRATION).toMatch(/\bCOMMIT\s*;/);
  });

  it('crea la secuencia dedicada de codigos PigTec', () => {
    expect(MIGRATION).toMatch(
      /CREATE\s+SEQUENCE\s+public\.animals_animal_code_seq/i,
    );
  });

  it('genera el formato PIG-000001 con la secuencia (nextval + lpad)', () => {
    expect(MIGRATION).toMatch(
      /nextval\s*\(\s*'public\.animals_animal_code_seq'/i,
    );
    expect(MIGRATION).toMatch(/lpad\s*\(/i);
    expect(MIGRATION).toMatch(/'PIG-'/i);
  });

  it('sincroniza la secuencia con los codigos existentes para evitar colisiones', () => {
    expect(MIGRATION).toMatch(/setval\s*\(/i);
    expect(MIGRATION).toMatch(/\^PIG-\[0-9\]\+/);
    expect(MIGRATION).toMatch(/MAX\s*\(/i);
  });

  it('solo asigna el codigo cuando falta (no reescribe los existentes)', () => {
    expect(MIGRATION).toMatch(/NEW\.animal_code\s+IS\s+NULL/i);
    expect(MIGRATION).toMatch(/btrim\s*\(\s*NEW\.animal_code\s*\)/i);
  });

  it('declara animal_code inmutable en UPDATE', () => {
    expect(MIGRATION).toMatch(
      /IS\s+DISTINCT\s+FROM\s+OLD\.animal_code/i,
    );
    expect(MIGRATION).toMatch(/RAISE\s+EXCEPTION/i);
  });

  it('registra el trigger BEFORE INSERT OR UPDATE sobre public.animals', () => {
    expect(MIGRATION).toMatch(
      /CREATE\s+TRIGGER\s+trg_animals_assign_code/i,
    );
    expect(MIGRATION).toMatch(
      /BEFORE\s+INSERT\s+OR\s+UPDATE\s+ON\s+public\.animals/i,
    );
  });

  it('no concede la secuencia ni la funcion a PUBLIC/anon/authenticated', () => {
    expect(MIGRATION).toMatch(
      /REVOKE\s+ALL\s+ON\s+SEQUENCE\s+public\.animals_animal_code_seq\s+FROM\s+authenticated/i,
    );
    expect(MIGRATION).toMatch(
      /REVOKE\s+ALL\s+ON\s+SEQUENCE\s+public\.animals_animal_code_seq\s+FROM\s+anon/i,
    );
    expect(MIGRATION).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.assign_animal_code\(\)\s+FROM\s+authenticated/i,
    );
    expect(MIGRATION).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.assign_animal_code\(\)\s+FROM\s+anon/i,
    );
    expect(MIGRATION).not.toMatch(/GRANT\s+.*\s+ON\s+SEQUENCE/i);
  });

  it('no crea ni modifica politicas RLS de animals', () => {
    expect(MIGRATION).not.toMatch(/CREATE\s+POLICY/i);
    expect(MIGRATION).not.toMatch(/DROP\s+POLICY/i);
    expect(MIGRATION).not.toMatch(
      /ALTER\s+TABLE\s+public\.animals\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,
    );
  });
});
