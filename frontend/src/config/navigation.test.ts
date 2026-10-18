import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, canAccessModule, rolesForPath } from './navigation';
import { OPERATIONAL_ROLES } from './roles';

describe('navegacion y permisos', () => {
  it('declara las ocho secciones de PigTec', () => {
    expect(NAV_ITEMS.map((item) => item.key)).toEqual([
      'dashboard',
      'areas',
      'animals',
      'movements',
      'litters',
      'health',
      'reports',
      'users',
    ]);
  });

  it('restringe Usuarios al rol admin', () => {
    expect(rolesForPath('/users')).toEqual(['admin']);
    expect(canAccessModule('users', 'admin')).toBe(true);
    expect(canAccessModule('users', 'manager')).toBe(false);
    expect(canAccessModule('users', 'operator')).toBe(false);
    expect(canAccessModule('users', 'veterinarian')).toBe(false);
  });

  it('permite Reportes a todos los roles operativos, ninguno con viewer', () => {
    for (const role of OPERATIONAL_ROLES) {
      expect(canAccessModule('reports', role)).toBe(true);
    }

    const reports = NAV_ITEMS.find((item) => item.key === 'reports');
    expect(reports?.roles).not.toContain('viewer');
  });

  it('no expone el rol viewer en ninguna seccion', () => {
    for (const item of NAV_ITEMS) {
      expect(item.roles).not.toContain('viewer');
    }
  });

  it('devuelve null para una ruta desconocida', () => {
    expect(rolesForPath('/no-existe')).toBeNull();
  });
});
