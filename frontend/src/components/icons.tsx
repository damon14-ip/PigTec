import type { IconName } from '../config/navigation';

/**
 * Iconos de la interfaz.
 *
 * Se implementan como SVG en linea para no anadir una dependencia de iconos.
 * Todos usan `currentColor`, trazo de 1.75 y son decorativos (`aria-hidden`):
 * el texto adyacente aporta el significado accesible.
 */
const PATHS: Record<IconName, string[]> = {
  dashboard: [
    'M3.75 4.5h6v6h-6z',
    'M14.25 4.5h6v3.75h-6z',
    'M14.25 12h6v7.5h-6z',
    'M3.75 14.25h6v5.25h-6z',
  ],
  areas: [
    'M3 7.5 12 3l9 4.5-9 4.5z',
    'M3 12l9 4.5 9-4.5',
    'M3 16.5 12 21l9-4.5',
  ],
  pig: [
    'M4.5 12a7.5 7.5 0 0 1 15 0v3.75a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 15.75z',
    'M8.25 12h.008M15.75 12h.008',
    'M9.75 18v1.5M14.25 18v1.5',
    'M6.75 9.75 4.5 8.25M17.25 9.75 19.5 8.25',
  ],
  movements: [
    'M4.5 8.25h11.25l-2.25-2.25',
    'M19.5 15.75H8.25l2.25 2.25',
  ],
  litters: [
    'M12 6.75a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5z',
    'M6 12a2.25 2.25 0 1 0 0-4.5A2.25 2.25 0 0 0 6 12z',
    'M18 12a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5z',
    'M12 13.5c-2.9 0-5.25 2.35-5.25 5.25v1.5h10.5v-1.5c0-2.9-2.35-5.25-5.25-5.25z',
  ],
  health: [
    'M4.5 12h3l1.5-3.75 3 7.5 1.5-3.75h6',
    'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z',
  ],
  reports: [
    'M6.75 3.75h7.5l4.5 4.5v12a1.5 1.5 0 0 1-1.5 1.5H6.75a1.5 1.5 0 0 1-1.5-1.5V5.25a1.5 1.5 0 0 1 1.5-1.5z',
    'M13.5 3.75V9h5.25',
    'M8.25 13.5h7.5M8.25 16.5h4.5',
  ],
  users: [
    'M15.75 19.5v-1.5a3.75 3.75 0 0 0-3.75-3.75h-3a3.75 3.75 0 0 0-3.75 3.75v1.5',
    'M10.5 10.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M19.5 19.5v-1.5a3.75 3.75 0 0 0-2.25-3.375',
    'M15 4.875a3 3 0 0 1 0 5.25',
  ],
  menu: ['M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5'],
  close: ['M6 6l12 12M18 6 6 18'],
  logout: [
    'M15.75 8.25 19.5 12l-3.75 3.75',
    'M19.5 12H9',
    'M9 4.5H6a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 6 19.5h3',
  ],
  chat: [
    'M3.75 6a2.25 2.25 0 0 1 2.25-2.25h12A2.25 2.25 0 0 1 20.25 6v7.5A2.25 2.25 0 0 1 18 15.75H9l-5.25 4.5z',
    'M8.25 9h7.5M8.25 12h4.5',
  ],
  send: ['M4.5 12 20.25 4.5 12 20.25l-1.5-6z', 'M10.5 14.25 20.25 4.5'],
  info: [
    'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z',
    'M12 11.25v5.25M12 7.75h.008',
  ],
  alert: [
    'M12 9.75v4.5M12 17.25h.008',
    'M10.5 3.9 2.6 17.1a1.5 1.5 0 0 0 1.3 2.25h16.2a1.5 1.5 0 0 0 1.3-2.25L13.5 3.9a1.5 1.5 0 0 0-2.6 0z',
  ],
  refresh: [
    'M20.25 12a8.25 8.25 0 1 1-2.42-5.83',
    'M20.25 4.5v4.5h-4.5',
  ],
};

export interface IconProps {
  name: IconName;
  /** Tamano en px (por defecto 20). */
  size?: number;
  className?: string;
}

/** Icono SVG decorativo. */
export function Icon({ name, size = 20, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
