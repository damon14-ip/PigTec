/**
 * Respuestas locales deterministas del asistente PigTec.
 *
 * Objetivo: resolver un conjunto PEQUENO de preguntas frecuentes sin llamar al
 * proveedor de IA. Cada respuesta esta fundamentada en el codigo real del
 * backend (ver `assistant.knowledge.ts`).
 *
 * Diseno conservador (evita respuestas incorrectas):
 * 1. Normalizacion: minusculas, sin acentos y sin signos de puntuacion.
 * 2. Coincidencia por FRASE disparadora completa (con límites de palabra), no
 *    por palabras sueltas: "que es un area" no coincide con "que es un arete".
 * 3. Limite de palabras: una pregunta larga (posiblemente compuesta) NO se
 *    responde localmente; se delega al proveedor.
 * 4. Ambiguedad: si DOS o mas reglas coinciden, NO se responde localmente.
 * 5. Ante cualquier duda se devuelve `null` y la peticion pasa a Groq.
 *
 * Las respuestas locales no consumen cuota ni informan `usage`.
 */

/** Regla de respuesta local. */
export interface LocalAnswerRule {
  /** Identificador estable (util en pruebas y trazabilidad). */
  id: string;
  /**
   * Grupos de frases. La regla coincide cuando, en CADA grupo, al menos una de
   * sus frases aparece como palabra(s) completa(s) en la consulta normalizada.
   * La mayoria de reglas usan un unico grupo con varias frases equivalentes.
   */
  groups: readonly (readonly string[])[];
  /** Maximo de palabras de la consulta para considerar que es directa. */
  maxWords: number;
  /** Respuesta en espanol, breve y verificable. */
  answer: string;
}

/** Tope absoluto de palabras: por encima, se asume pregunta compuesta -> Groq. */
const ABSOLUTE_MAX_WORDS = 20;

export const LOCAL_ANSWER_RULES: readonly LocalAnswerRule[] = [
  {
    id: 'food_inventory',
    groups: [
      ['inventario', 'inventarios', 'stock', 'bodega', 'existencias'],
      [
        'alimento',
        'alimentos',
        'medicamento',
        'medicamentos',
        'suministro',
        'suministros',
        'insumo',
        'insumos',
        'comida',
        'concentrado',
        'pienso',
        'vacuna',
        'vacunas',
      ],
    ],
    maxWords: 16,
    answer:
      'No. PigTec no controla inventarios de alimentos, medicamentos, suministros ni insumos, y tampoco maneja stock ni bodega: esa funcionalidad no está implementada ni figura en el plan actual. Cuando se habla de "inventario" en PigTec se refiere únicamente al inventario oficial de animales (el registro de porcinos con su código, estado y ubicación).',
  },
  {
    id: 'what_is_pigtec',
    groups: [
      [
        'que es pigtec',
        'que es el sistema pigtec',
        'que es el sistema de gestion pigtec',
        'para que sirve pigtec',
        'para que sirve el sistema pigtec',
        'que significa pigtec',
        'que es kolkapig',
      ],
    ],
    maxWords: 14,
    answer:
      'PigTec es el sistema de gestión porcina de la granja KolkaPig (FERCYT, UNAMBA). Permite registrar y consultar porcinos con un código único, organizarlos por áreas y corrales, y llevar el historial de movimientos, camadas y eventos sanitarios. Hoy el backend (API REST) está implementado y la interfaz web está en desarrollo.',
  },
  {
    id: 'what_is_area',
    groups: [
      [
        'que es un area',
        'que es el area',
        'que es una area',
        'que es area',
        'que significa area',
        'que son las areas',
      ],
    ],
    maxWords: 7,
    answer:
      'Un área es una zona o sector de la granja (por ejemplo, maternidad o engorde) que agrupa varios corrales. Se administran con el módulo de áreas: admin y manager pueden crearlas, editarlas y darlas de baja; los cuatro roles operativos pueden consultarlas. La baja es lógica: el área pasa a estado inactivo y no se borra, para no romper el historial. Un área inactiva no admite nuevos movimientos hacia sus corrales.',
  },
  {
    id: 'what_is_pen',
    groups: [
      [
        'que es un corral',
        'que es el corral',
        'que es un pens',
        'que es corral',
        'que significa corral',
        'que son los corrales',
      ],
    ],
    maxWords: 7,
    answer:
      'Un corral es un espacio físico dentro de un área donde se ubican los porcinos. Cada corral pertenece a un área y su código es único dentro de ella; el nombre y la capacidad son opcionales. Se administran con el módulo de corrales: admin y manager los crean, editan y dan de baja (lógica), y los roles operativos los consultan. La ubicación de un animal cambia únicamente registrando un movimiento, no editando el corral.',
  },
  {
    id: 'animal_code',
    groups: [
      [
        'como se genera el codigo',
        'como se asigna el codigo',
        'como se crea el codigo',
        'que formato tiene el codigo',
        'cual es el formato del codigo',
        'formato del codigo de un porcino',
        'codigo de un porcino',
        'codigo pigtec',
      ],
    ],
    maxWords: 12,
    answer:
      'El código oficial de un porcino (animal_code) lo genera la base de datos con una secuencia dedicada, en el formato PIG-000001, PIG-000002, etc. Es único, permanente e inmutable: el backend no lo acepta en el alta (si lo envías, responde 400) ni permite modificarlo. Como identificación adicional puedes registrar un arete (ear_tag_code), que no reemplaza al código PigTec.',
  },
  {
    id: 'roles',
    groups: [
      [
        'que puede hacer cada rol',
        'que hace cada rol',
        'cuales son los roles',
        'que roles existen',
        'que permisos tiene cada rol',
        'permisos de los roles',
        'que puede hacer cada usuario',
      ],
    ],
    maxWords: 12,
    answer:
      'PigTec tiene cuatro roles funcionales (además de viewer, que existe en la base pero no tiene permisos operativos):\n- admin y manager: consultan todo, administran áreas y corrales (crear, editar, dar de baja) y realizan el alta y la edición oficial de porcinos.\n- operator: consulta y registra movimientos internos, camadas y observaciones o síntomas. No da de alta animales por sí mismo (el alta por solicitud y aprobación está planificada) ni registra ventas externas, mortalidad o eventos clínicos.\n- veterinarian: consulta y registra el historial sanitario: eventos clínicos (diagnóstico, tratamiento, vacunación, desparasitación, recuperación), mortalidad y aislamiento sanitario.\nNota: la administración de usuarios y roles todavía no está implementada en el sistema.',
  },
  {
    id: 'modules_overview',
    groups: [
      [
        'que modulos tiene pigtec',
        'que modulos tiene el sistema',
        'que modulos tiene',
        'que modulos hay',
        'cuales son los modulos',
        'cuales son los modulos del sistema',
        'cuales son los modulos de pigtec',
        'que modulos ofrece pigtec',
        'que funcionalidades estan disponibles',
        'que funcionalidades tiene pigtec',
        'que funcionalidades tiene el sistema',
        'que funcionalidades hay',
        'que puedo hacer en pigtec',
        'que puedo hacer en el sistema',
        'que se puede hacer en pigtec',
        'que se puede hacer en el sistema',
        'que funciones tiene pigtec',
        'que funciones tiene el sistema',
      ],
    ],
    maxWords: 12,
    answer:
      'PigTec está organizado en módulos, pensados para el trabajo diario en la granja. La aplicación web ya permite iniciar sesión, navegar por las secciones y conversar conmigo (el asistente); el resto se está terminando.\n\nDisponibles hoy:\n- **Inicio de sesión y navegación**: entrar con tu cuenta y recorrer las secciones según tu rol.\n- **Dashboard**: pantalla de inicio con la bienvenida y la estructura de indicadores.\n- **Asistente PigTec**: este chatbot, para preguntar por el sistema y consultar algunos datos.\n\nCon el sistema listo, pero sin pantalla operativa todavía:\n- **Áreas y corrales**, **Porcinos**, **Movimientos**, **Camadas** y **Sanidad**: sus funciones ya existen, pero las pantallas para registrar, editar y listar datos aún se están construyendo.\n\nPendientes o no disponibles:\n- **Indicadores reales y gráficos del dashboard**: llegarán en la etapa S5-B.\n- **Exportaciones Excel y PDF**: llegarán en la etapa S5-E.\n- **Administración de usuarios y roles**: todavía no está en el sistema.\n- **Inventario de alimentos, medicamentos o suministros**: no existe ni está previsto en PigTec.',
  },
];

/**
 * Normaliza texto para comparar de forma estable:
 * minusculas, sin acentos (NFD + eliminacion de diacriticos) y sin puntuacion.
 * Los caracteres no alfanumericos se convierten en espacios simples.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Comprueba si la frase aparece completa (con limites de palabra). */
function containsPhrase(paddedText: string, phrase: string): boolean {
  return paddedText.includes(` ${phrase} `);
}

/**
 * Devuelve la respuesta local para el mensaje, o `null` si debe consultarse al
 * proveedor. Nunca lanza: ante cualquier caso dudoso devuelve `null`.
 */
export function findLocalAnswer(message: string): string | null {
  const normalized = normalizeForMatch(message);
  if (normalized === '') {
    return null;
  }

  const words = normalized.split(' ').length;
  if (words > ABSOLUTE_MAX_WORDS) {
    return null;
  }

  const padded = ` ${normalized} `;
  const matches = LOCAL_ANSWER_RULES.filter(
    (rule) =>
      words <= rule.maxWords &&
      rule.groups.every((group) =>
        group.some((phrase) => containsPhrase(padded, phrase)),
      ),
  );

  // Exactamente una coincidencia: respuesta local. Cero (desconocida) o dos o
  // mas (ambigua): se delega al proveedor.
  if (matches.length !== 1) {
    return null;
  }

  return matches[0].answer;
}
