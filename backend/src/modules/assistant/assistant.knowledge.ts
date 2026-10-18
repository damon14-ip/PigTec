/**
 * Base de conocimiento local del asistente PigTec.
 *
 * Fuente: el codigo REAL del backend en esta misma carpeta (`src/modules/*`).
 * Su proposito es que el asistente describa unicamente lo que existe y marque
 * con claridad lo que aun no existe, para no confundir a las personas usuarias.
 *
 * Cada capacidad se clasifica en UNO de cuatro estados:
 * - `implemented`     : existe y esta verificado en el backend (API REST).
 * - `pending_frontend`: el backend ya lo ofrece, pero falta la interfaz web.
 * - `planned`         : esta previsto en el plan por etapas, pero NO existe aun.
 * - `not_in_scope`    : no existe y no forma parte del alcance actual.
 *
 * IMPORTANTE (mantenimiento): este archivo es la UNICA fuente de la descripcion
 * de capacidades. Si se implementa o se retira una funcion, se actualiza aqui y
 * el prompt de sistema (assistant.prompt.ts) se regenera solo, porque se
 * compone a partir de `buildCapabilitySummary()`.
 *
 * NO agregar datos concretos de KolkaPig (animales, aretes, existencias): la
 * base describe funciones, no registros. Las consultas dinamicas a Supabase
 * llegaran en un paso posterior.
 */

export type FeatureStatus =
  | 'implemented'
  | 'pending_frontend'
  | 'planned'
  | 'not_in_scope';

export interface KnowledgeFeature {
  /** Nombre corto y reconocible de la capacidad. */
  name: string;
  /** Estado real segun el codigo y el plan del proyecto. */
  status: FeatureStatus;
  /**
   * Detalle en lenguaje claro. Debe poder sostenerse con el codigo: si no se
   * puede verificar, no se escribe.
   */
  detail: string;
}

export interface KnowledgeSection {
  id: string;
  title: string;
  /** Parrafo breve de introduccion a la seccion. */
  summary: string;
  features: readonly KnowledgeFeature[];
}

export const PIGTEC_KNOWLEDGE: readonly KnowledgeSection[] = [
  {
    id: 'introduccion',
    title: 'Introducción a PigTec',
    summary:
      'PigTec es el sistema de gestión porcina de la granja KolkaPig (FERCYT, UNAMBA). Sirve para registrar y consultar porcinos, organizarlos por áreas y corrales, y llevar el historial de movimientos, camadas y eventos sanitarios. La aplicación web ya está disponible para iniciar sesión, navegar entre secciones y usar el asistente; el backend de los módulos está implementado y las pantallas operativas de gestión todavía se están construyendo.',
    features: [
      {
        name: 'Aplicación web de PigTec',
        status: 'implemented',
        detail:
          'La aplicación web (React + TypeScript + Vite) ya está disponible: inicio de sesión con Supabase, navegación entre secciones, dashboard y asistente integrado. El backend es una API REST (Fastify + TypeScript + Supabase/PostgreSQL) y los módulos operativos existen como servicios del backend.',
      },
      {
        name: 'API REST del backend',
        status: 'implemented',
        detail:
          'Rutas con validación estricta de entradas para autenticación, autorización, áreas, corrales, porcinos, movimientos, camadas y eventos sanitarios.',
      },
      {
        name: 'Autenticación con JWT',
        status: 'implemented',
        detail:
          'Cada petición exige un token JWT válido de Supabase; sin token o con token inválido se responde 401.',
      },
      {
        name: 'Asistente de consultas de datos',
        status: 'implemented',
        detail:
          'El asistente puede responder TRES consultas concretas con datos reales de la granja, verificados y en solo lectura: (1) resumen de porcinos por estado, (2) ubicación actual de un porcino por su código oficial PIG-XXXXXX y (3) sus movimientos recientes por código. Son consultas predefinidas y limitadas: el asistente no genera SQL, no consulta otras tablas ni datos, no accede libremente a la base y nunca escribe.',
      },
      {
        name: 'Autorización por rol',
        status: 'implemented',
        detail:
          'El rol y el estado activo del usuario se leen de la base con la identidad del token (RLS). Los perfiles inactivos o con rol sin permisos operativos reciben 403.',
      },
    ],
  },
  {
    id: 'interfaz_web',
    title: 'Aplicación web (interfaz)',
    summary:
      'La aplicación web de PigTec ya permite entrar y recorrer el sistema. Las pantallas que sirven para registrar, editar y listar datos de los módulos todavía se están construyendo, por lo que hoy no deben presentarse como si ya estuvieran operativas.',
    features: [
      {
        name: 'Inicio de sesión web',
        status: 'implemented',
        detail:
          'Se puede entrar a la aplicación con una cuenta autorizada de KolkaPig; la autenticación se apoya en Supabase.',
      },
      {
        name: 'Navegación y dashboard',
        status: 'implemented',
        detail:
          'El menú lateral lleva a cada sección según el rol del usuario y el dashboard muestra la bienvenida y la estructura de indicadores. Todavía no hay cifras ni gráficos conectados.',
      },
      {
        name: 'Asistente integrado (chatbot)',
        status: 'implemented',
        detail:
          'El asistente PigTec está disponible dentro de la aplicación y responde preguntas sobre el sistema y algunas consultas de datos. Es de solo lectura.',
      },
      {
        name: 'Pantallas operativas de gestión',
        status: 'pending_frontend',
        detail:
          'Áreas y corrales, Porcinos, Movimientos, Camadas y Sanidad ya existen en el backend, pero sus pantallas para registrar, editar y listar datos todavía están en desarrollo: por ahora muestran información de lo previsto, no formularios operativos.',
      },
      {
        name: 'Indicadores reales y gráficos del dashboard',
        status: 'planned',
        detail:
          'Las métricas reales y los gráficos del dashboard se implementarán en la etapa S5-B; hoy solo existe la estructura visual.',
      },
      {
        name: 'Exportaciones Excel y PDF',
        status: 'planned',
        detail:
          'La exportación a Excel y la generación de documentos PDF están previstas para la etapa S5-E; todavía no generan archivos.',
      },
    ],
  },
  {
    id: 'usuarios_roles',
    title: 'Usuarios y roles',
    summary:
      'Los roles del sistema son admin, manager, operator y veterinarian. El rol viewer existe en la base pero no tiene permisos operativos: hoy no puede usar los módulos ni el asistente.',
    features: [
      {
        name: 'Consulta del propio perfil',
        status: 'implemented',
        detail:
          'GET /auth/me devuelve la identidad básica y GET /auth/profile devuelve id, rol y estado activo del usuario autenticado.',
      },
      {
        name: 'Permisos por rol en los módulos',
        status: 'implemented',
        detail:
          'admin y manager administran áreas y corrales y hacen el alta oficial de porcinos; operator registra movimientos internos, camadas y observaciones; veterinarian registra eventos clínicos, mortalidad y aislamiento sanitario. Los cuatro roles operativos consultan.',
      },
      {
        name: 'Administración de usuarios y roles desde el sistema',
        status: 'planned',
        detail:
          'No existe todavía pantalla ni API para crear usuarios o cambiar roles: esas acciones se realizan por fuera del sistema. La especificación prevé asignación controlada de roles.',
      },
      {
        name: 'Rol viewer funcional',
        status: 'not_in_scope',
        detail:
          'viewer existe en la base como valor por defecto, pero no se usará funcionalmente: no tiene permisos operativos y se le deniega el acceso (403).',
      },
    ],
  },
  {
    id: 'areas_corrales',
    title: 'Áreas y corrales',
    summary:
      'Un área es una zona o sector de la granja (por ejemplo, maternidad o engorde) y agrupa varios corrales. Un corral es un espacio físico dentro de un área donde se ubican los porcinos.',
    features: [
      {
        name: 'Consulta de áreas y corrales',
        status: 'implemented',
        detail:
          'GET /areas y GET /pens (con filtros por estado y por área) están disponibles para los cuatro roles operativos activos.',
      },
      {
        name: 'Administración de áreas y corrales',
        status: 'implemented',
        detail:
          'admin y manager crean (POST), editan (PATCH) y dan de baja (DELETE lógico: pasan a estado inactivo) áreas y corrales. No se borran filas, para no romper el historial.',
      },
      {
        name: 'Relación corral → área',
        status: 'implemented',
        detail:
          'Todo corral pertenece a un área y su código es único dentro de esa área. Un corral inactivo o de un área inactiva no admite nuevos movimientos.',
      },
      {
        name: 'Reasignar un corral a otra área',
        status: 'planned',
        detail:
          'Actualmente no se puede cambiar el área de un corral existente; solo su código, nombre, capacidad y notas.',
      },
    ],
  },
  {
    id: 'porcinos',
    title: 'Registro y consulta de porcinos',
    summary:
      'El porcino es la unidad central del sistema. Cada animal recibe un código PigTec único e inmutable generado por la base de datos.',
    features: [
      {
        name: 'Código oficial PIG-000001',
        status: 'implemented',
        detail:
          'El animal_code lo genera la base de datos con una secuencia dedicada (formato PIG-000001, PIG-000002, ...). Es único, permanente e inmutable; el backend no lo acepta ni lo modifica.',
      },
      {
        name: 'Arete opcional',
        status: 'implemented',
        detail:
          'Además del código PigTec, se puede registrar un código de arete (ear_tag_code) como identificación adicional; no sustituye al código oficial.',
      },
      {
        name: 'Alta oficial de porcinos',
        status: 'implemented',
        detail:
          'POST /animals lo realizan únicamente admin y manager. El alta siempre nace con estado active y el autor se toma del token.',
      },
      {
        name: 'Edición y cambio de estado',
        status: 'implemented',
        detail:
          'PATCH /animals edita datos generales (raza, sexo, fechas, parentesco, camada, notas) y PATCH /animals/:id/status fija estados administrativos (active, inactive, missing). Los estados sold, dead y transferred_out se derivan de operaciones con historial.',
      },
      {
        name: 'Consulta y ubicación de porcinos',
        status: 'implemented',
        detail:
          'GET /animals (con filtros), GET /animals/:id y GET /animals/:id/location están disponibles para los roles operativos. El corral actual solo cambia registrando un movimiento, para conservar la trazabilidad.',
      },
      {
        name: 'Alta por solicitud y aprobación',
        status: 'planned',
        detail:
          'El flujo por el que operator envía una solicitud de alta y manager/admin aprueba o rechaza está planificado pero no implementado. Hoy operator no da de alta animales directamente.',
      },
    ],
  },
  {
    id: 'movimientos',
    title: 'Movimientos y cambios de corral',
    summary:
      'Un movimiento es un registro histórico de cambio de ubicación o salida de un porcino. El historial no se edita ni se borra.',
    features: [
      {
        name: 'Registro de movimientos',
        status: 'implemented',
        detail:
          'POST /movements registra el motivo (destete, etapa de crecimiento, engorde, reproducción, aislamiento sanitario, venta, transferencia, manejo, otro) y el corral de destino cuando corresponde.',
      },
      {
        name: 'Reglas de coherencia',
        status: 'implemented',
        detail:
          'El sistema exige que el corral de origen coincida con la ubicación actual, que el destino exista y esté activo, y que no se muevan porcinos vendidos, muertos, transferidos al exterior o dados de baja.',
      },
      {
        name: 'Permisos por motivo',
        status: 'implemented',
        detail:
          'admin, manager y operator registran movimientos internos; veterinarian además registra el aislamiento sanitario; las ventas y transferencias externas son solo de admin y manager.',
      },
      {
        name: 'Historial de movimientos',
        status: 'implemented',
        detail:
          'GET /movements, GET /movements/:id y GET /animals/:id/movements consultan el historial. No hay edición ni borrado: el historial es inmutable.',
      },
    ],
  },
  {
    id: 'camadas',
    title: 'Camadas y reproducción',
    summary:
      'Una camada agrupa los nacimientos a partir de una madre. Es la base del registro reproductivo.',
    features: [
      {
        name: 'Registro de camadas',
        status: 'implemented',
        detail:
          'POST /litters registra la camada indicando la madre (obligatoria y hembra), el padre opcional (si se indica, macho) y los conteos de nacimiento.',
      },
      {
        name: 'Consulta de camadas y crías',
        status: 'implemented',
        detail:
          'GET /litters, GET /litters/:id y GET /litters/:id/offspring (crías por camada) están disponibles para los roles operativos.',
      },
      {
        name: 'Edición de camadas',
        status: 'implemented',
        detail:
          'PATCH /litters permite corregir datos y conteos. Los conteos no pueden superar el total de nacidos.',
      },
      {
        name: 'Eliminar camadas',
        status: 'not_in_scope',
        detail:
          'No hay borrado de camadas (decisión D-09): se corrigen, no se eliminan.',
      },
    ],
  },
  {
    id: 'eventos_sanitarios',
    title: 'Eventos sanitarios',
    summary:
      'El historial sanitario registra observaciones, diagnósticos, tratamientos, vacunaciones, desparasitaciones, recuperaciones y mortalidad.',
    features: [
      {
        name: 'Registro de eventos sanitarios',
        status: 'implemented',
        detail:
          'POST /health-events registra el tipo de evento, un título obligatorio, fecha, descripción y datos adicionales. El autor se toma del token.',
      },
      {
        name: 'Permisos por tipo de evento',
        status: 'implemented',
        detail:
          'Las observaciones y síntomas los registra cualquier rol operativo; los eventos clínicos (diagnóstico, tratamiento, vacunación, desparasitación, recuperación) solo el veterinarian; la mortalidad la registran admin, manager y veterinarian.',
      },
      {
        name: 'Consulta del historial sanitario',
        status: 'implemented',
        detail:
          'GET /health-events, GET /health-events/:id y GET /animals/:id/health-events están disponibles para los roles operativos. No hay edición ni borrado.',
      },
      {
        name: 'Diagnóstico veterinario automatizado',
        status: 'not_in_scope',
        detail:
          'El asistente y el sistema no emiten diagnósticos ni recetan: ante un problema de salud se recomienda consultar al médico veterinario responsable.',
      },
    ],
  },
  {
    id: 'limitaciones',
    title: 'Limitaciones actuales del sistema',
    summary:
      'Estas funciones NO están disponibles. El asistente no debe presentarlas como si existieran.',
    features: [
      {
        name: 'Inventario de alimentos, medicamentos o suministros',
        status: 'not_in_scope',
        detail:
          'PigTec NO controla inventarios de alimentos, medicamentos, insumos ni suministros, y tampoco stock ni bodega. No está implementado ni figura en el plan por etapas. En PigTec, "inventario" se refiere únicamente al inventario oficial de animales.',
      },
      {
        name: 'Asistente con acceso libre a la base de datos',
        status: 'not_in_scope',
        detail:
          'El asistente NO ejecuta SQL generado por IA, no consulta tablas libremente, no accede a Supabase desde el proveedor y no modifica registros. Solo responde tres consultas de solo lectura predefinidas (resumen por estado, ubicación por código y movimientos por código); para cualquier otro dato de la granja no hay respuesta y no se debe inventar.',
      },
      {
        name: 'Reportes, gráficos y exportaciones',
        status: 'planned',
        detail:
          'Todavía no hay un módulo de reportes operativo ni exportación de datos. Los indicadores reales y gráficos del dashboard llegarán en la etapa S5-B y las exportaciones Excel y PDF en la etapa S5-E. Mientras tanto, la consulta se hace por listados y filtros.',
      },
      {
        name: 'Notificaciones, alertas y auditoría visible',
        status: 'planned',
        detail:
          'No existen notificaciones ni alertas automáticas. El diseño de auditoría está pendiente de definición.',
      },
    ],
  },
];

/** Texto por estado, para el resumen compacto que recibe el modelo. */
const STATUS_LABEL: Record<FeatureStatus, string> = {
  implemented: 'disponible',
  pending_frontend: 'backend listo, falta interfaz',
  planned: 'planificado, no disponible',
  not_in_scope: 'no existe',
};

/**
 * Construye un resumen BREVE y preciso de capacidades y limitaciones para el
 * prompt de sistema. Se envia en cada peticion, por lo que debe ser corto: se
 * listan los nombres de las funciones, sin detallar cada regla.
 *
 * - "implemented"/"pending_frontend": capacidades que el asistente puede dar por
 *   existentes (con la salvedad de la interfaz).
 * - "planned"/"not_in_scope": capacidades que NO debe presentar como disponibles.
 */
export function buildCapabilitySummary(): string {
  const available: string[] = [];
  const backendReady: string[] = [];
  const unavailable: string[] = [];

  for (const section of PIGTEC_KNOWLEDGE) {
    for (const feature of section.features) {
      if (feature.status === 'implemented') {
        available.push(feature.name);
      } else if (feature.status === 'pending_frontend') {
        backendReady.push(feature.name);
      } else {
        unavailable.push(`${feature.name}: ${STATUS_LABEL[feature.status]}`);
      }
    }
  }

  const blocks = [
    'Capacidades disponibles hoy en PigTec (web y backend):',
    ...dedupe(available).map((item) => `- ${item}`),
  ];

  if (backendReady.length > 0) {
    blocks.push(
      '',
      'Ya existe en el sistema pero SIN pantalla web operativa todavia (no lo presentes como una pantalla disponible):',
      ...dedupe(backendReady).map((item) => `- ${item}`),
    );
  }

  blocks.push(
    '',
    'No disponible hoy (NO lo presentes como si existiera):',
    ...dedupe(unavailable).map((item) => `- ${item}`),
  );

  return blocks.join('\n');
}

/** Quita duplicados conservando el orden (por si dos secciones repiten un nombre). */
function dedupe(items: readonly string[]): string[] {
  return [...new Set(items)];
}
