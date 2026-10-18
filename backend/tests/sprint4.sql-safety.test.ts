import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Guarda de seguridad sobre el guion SQL de verificacion transaccional.
 *
 * No se conecta a la base de datos: solo comprueba, por lectura estatica, que el
 * guion JAMAS confirma la transaccion, que marca los datos como sinteticos y que
 * no puede convertir un error inesperado en un falso resultado correcto.
 * Asi, ejecutarlo por error (o copiarlo a medias) no puede dejar filas
 * permanentes: la unica salida posible es revertir.
 */
const SCRIPT_URL = new URL(
  '../../database/verification/sprint4_transactional_check.sql',
  import.meta.url,
);

const sql = readFileSync(SCRIPT_URL, 'utf8');

/**
 * SQL sin comentarios de linea. Las comprobaciones de CODIGO no deben
 * confundirse con la DOCUMENTACION del guion, que habla de `WHEN OTHERS`,
 * `COMMIT` o `ROLLBACK` justamente para explicar que no se usan.
 */
const sqlCodigo = sql.replace(/--[^\n]*/g, '');

describe('guion SQL transaccional de Sprint 4 (guarda de seguridad, sin base de datos)', () => {
  it('abre una transaccion explicita antes del bloque de comprobaciones', () => {
    const begin = sqlCodigo.search(/\bBEGIN\s*;/i);
    const doBlock = sqlCodigo.search(/\bDO\s+\$sprint4_check\$/);

    expect(begin).toBeGreaterThanOrEqual(0);
    expect(doBlock).toBeGreaterThan(begin);
  });

  it('nunca confirma la transaccion', () => {
    expect(sqlCodigo).not.toMatch(/\bCOMMIT\b/i);
  });

  it('revierte siempre al final (un unico ROLLBACK, despues del bloque DO)', () => {
    const rollbacks = sqlCodigo.match(/\bROLLBACK\s*;/gi) ?? [];

    expect(rollbacks).toHaveLength(1);
    expect(sqlCodigo.search(/\bROLLBACK\s*;/i)).toBeGreaterThan(
      sqlCodigo.search(/\$sprint4_check\$;/),
    );
  });

  it('marca los datos como sinteticos de prueba', () => {
    expect(sqlCodigo).toMatch(/\[PRUEBA E2E SQL\]/);
  });

  it('rechaza capturar errores inesperados: solo se captura check_violation', () => {
    // Un `WHEN OTHERS` (o un SQLSTATE crudo) convertiria en "OK" cualquier
    // error: NOT NULL, clave foranea, permisos, etc.
    expect(sqlCodigo).not.toMatch(/WHEN\s+OTHERS/i);
    expect(sqlCodigo).not.toMatch(/WHEN\s+SQLSTATE/i);

    const manejadores = [...sqlCodigo.matchAll(/EXCEPTION\s+WHEN\s+(\w+)/gi)];

    expect(manejadores.length).toBeGreaterThanOrEqual(9);
    for (const manejador of manejadores) {
      expect(manejador[1]).toBe('check_violation');
    }
  });

  it('documenta que las secuencias no se revierten con ROLLBACK', () => {
    expect(sql).toMatch(/LAS SECUENCIAS NO SE REVIERTEN CON ROLLBACK/i);
    expect(sql).toMatch(/animal_code/);
    expect(sql).toMatch(/4\.1/);
  });

  it('no modifica el valor de la secuencia (no usa setval)', () => {
    expect(sqlCodigo).not.toMatch(/setval\s*\(/i);
  });
});
