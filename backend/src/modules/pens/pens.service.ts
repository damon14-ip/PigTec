import { NotFoundError } from '../common/data-errors.js';
import type {
  CreatePenInput,
  ListPensFilter,
  Pen,
  PenRepository,
  UpdatePenInput,
} from './pens.repository.js';

/**
 * Logica de negocio de corrales. Depende de un `PenRepository` inyectable.
 *
 * La desactivacion es una baja logica (`status='inactive'`); no se elimina la
 * fila porque los animales (`current_pen_id`) y los movimientos la referencian
 * con `ON DELETE RESTRICT` (registros historicos).
 */
export interface PenService {
  list(filter: ListPensFilter, accessToken: string): Promise<Pen[]>;
  getById(id: string, accessToken: string): Promise<Pen>;
  create(input: CreatePenInput, accessToken: string): Promise<Pen>;
  update(id: string, input: UpdatePenInput, accessToken: string): Promise<Pen>;
  deactivate(id: string, accessToken: string): Promise<Pen>;
}

export function createPenService(repository: PenRepository): PenService {
  return {
    list(filter, accessToken) {
      return repository.list(filter, accessToken);
    },

    async getById(id, accessToken) {
      const pen = await repository.findById(id, accessToken);
      if (!pen) {
        throw new NotFoundError('corral');
      }
      return pen;
    },

    create(input, accessToken) {
      return repository.create(input, accessToken);
    },

    async update(id, input, accessToken) {
      const pen = await repository.update(id, input, accessToken);
      if (!pen) {
        throw new NotFoundError('corral');
      }
      return pen;
    },

    async deactivate(id, accessToken) {
      const pen = await repository.setStatus(id, 'inactive', accessToken);
      if (!pen) {
        throw new NotFoundError('corral');
      }
      return pen;
    },
  };
}
