import {
  ForeignKeyError,
  NotFoundError,
  ValidationError,
} from '../common/data-errors.js';
import type {
  Litter,
  LitterOffspring,
  LitterRepository,
  ListLittersFilter,
} from './litters.repository.js';

/**
 * Logica de negocio de camadas (reproduccion). Depende de un
 * `LitterRepository` inyectable.
 *
 * Reglas aplicadas (solo las documentadas):
 * - La madre existe y es hembra; el padre, si se indica, existe y es macho.
 * - Las cantidades no son negativas y no superan `total_born` (la misma regla
 *   del CHECK de `public.litters`, reforzada aqui para responder 400 claro).
 * - No se inventan reglas sobre edad, estado reproductivo, fechas maximas ni
 *   genealogia no documentada.
 * - No hay borrado fisico (decision D-09).
 */
export interface LitterService {
  list(filter: ListLittersFilter, accessToken: string): Promise<Litter[]>;
  getById(id: string, accessToken: string): Promise<Litter>;
  create(input: CreateLitterRequest, accessToken: string): Promise<Litter>;
  update(
    id: string,
    input: UpdateLitterRequest,
    accessToken: string,
  ): Promise<Litter>;
  listOffspring(id: string, accessToken: string): Promise<LitterOffspring[]>;
}

/** Camada a registrar: la madre es obligatoria (flujo de nacimiento). */
export interface CreateLitterRequest {
  mother_id: string;
  litter_code?: string | null;
  father_id?: string | null;
  birth_date?: string | null;
  total_born?: number | null;
  born_alive?: number | null;
  stillborn?: number | null;
  notes?: string | null;
}

/** Campos editables de una camada. `mother_id` no se anula (solo se reemplaza). */
export interface UpdateLitterRequest {
  litter_code?: string | null;
  mother_id?: string;
  father_id?: string | null;
  birth_date?: string | null;
  total_born?: number | null;
  born_alive?: number | null;
  stillborn?: number | null;
  notes?: string | null;
}

/**
 * Coherencia de cantidades segun el CHECK de `public.litters`: cuando hay
 * `total_born`, ni `born_alive` ni `stillborn` pueden superarlo. Cada valor es
 * no negativo por el esquema de validacion; aqui solo se cruzan.
 */
function assertCounts(input: {
  total_born: number | null;
  born_alive: number | null;
  stillborn: number | null;
}): void {
  if (input.total_born === null) {
    return;
  }
  if (input.born_alive !== null && input.born_alive > input.total_born) {
    throw new ValidationError('born_alive no puede superar total_born');
  }
  if (input.stillborn !== null && input.stillborn > input.total_born) {
    throw new ValidationError('stillborn no puede superar total_born');
  }
}

async function assertMother(
  repository: LitterRepository,
  motherId: string,
  accessToken: string,
): Promise<void> {
  const mother = await repository.findAnimal(motherId, accessToken);
  if (!mother) {
    throw new ForeignKeyError('la madre indicada no existe');
  }
  if (mother.sex !== 'female') {
    throw new ValidationError('la madre debe ser de sexo hembra');
  }
}

async function assertFather(
  repository: LitterRepository,
  fatherId: string,
  accessToken: string,
): Promise<void> {
  const father = await repository.findAnimal(fatherId, accessToken);
  if (!father) {
    throw new ForeignKeyError('el padre indicado no existe');
  }
  if (father.sex !== 'male') {
    throw new ValidationError('el padre debe ser de sexo macho');
  }
}

export function createLitterService(
  repository: LitterRepository,
): LitterService {
  return {
    list(filter, accessToken) {
      return repository.list(filter, accessToken);
    },

    async getById(id, accessToken) {
      const litter = await repository.findById(id, accessToken);
      if (!litter) {
        throw new NotFoundError('camada');
      }
      return litter;
    },

    async create(input, accessToken) {
      await assertMother(repository, input.mother_id, accessToken);
      if (input.father_id !== undefined && input.father_id !== null) {
        await assertFather(repository, input.father_id, accessToken);
      }

      assertCounts({
        total_born: input.total_born ?? null,
        born_alive: input.born_alive ?? null,
        stillborn: input.stillborn ?? null,
      });

      return repository.create(
        {
          mother_id: input.mother_id,
          ...(input.litter_code !== undefined
            ? { litter_code: input.litter_code }
            : {}),
          ...(input.father_id !== undefined
            ? { father_id: input.father_id }
            : {}),
          ...(input.birth_date !== undefined
            ? { birth_date: input.birth_date }
            : {}),
          ...(input.total_born !== undefined
            ? { total_born: input.total_born }
            : {}),
          ...(input.born_alive !== undefined
            ? { born_alive: input.born_alive }
            : {}),
          ...(input.stillborn !== undefined
            ? { stillborn: input.stillborn }
            : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
        accessToken,
      );
    },

    async update(id, input, accessToken) {
      // La coherencia de cantidades es cruzada: se valida sobre el estado
      // resultante (valores enviados + los vigentes), no solo sobre lo enviado.
      const existing = await repository.findById(id, accessToken);
      if (!existing) {
        throw new NotFoundError('camada');
      }

      if (input.mother_id !== undefined) {
        await assertMother(repository, input.mother_id, accessToken);
      }
      if (input.father_id !== undefined && input.father_id !== null) {
        await assertFather(repository, input.father_id, accessToken);
      }

      assertCounts({
        total_born:
          input.total_born !== undefined
            ? input.total_born
            : existing.total_born,
        born_alive:
          input.born_alive !== undefined
            ? input.born_alive
            : existing.born_alive,
        stillborn:
          input.stillborn !== undefined
            ? input.stillborn
            : existing.stillborn,
      });

      const litter = await repository.update(id, input, accessToken);
      if (!litter) {
        throw new NotFoundError('camada');
      }
      return litter;
    },

    async listOffspring(id, accessToken) {
      const litter = await repository.findById(id, accessToken);
      if (!litter) {
        throw new NotFoundError('camada');
      }
      return repository.listOffspring(id, accessToken);
    },
  };
}
