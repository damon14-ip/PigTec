import { NotFoundError } from '../common/data-errors.js';
import type {
  Area,
  AreaRepository,
  CreateAreaInput,
  ListAreasFilter,
  UpdateAreaInput,
} from './areas.repository.js';

/**
 * Logica de negocio de areas. Depende de un `AreaRepository` inyectable.
 *
 * La desactivacion es una baja logica (`status='inactive'`): el esquema no
 * permite borrar un area referenciada por corrales (`ON DELETE RESTRICT`) y no
 * se comprometen registros historicos.
 */
export interface AreaService {
  list(filter: ListAreasFilter, accessToken: string): Promise<Area[]>;
  getById(id: string, accessToken: string): Promise<Area>;
  create(input: CreateAreaInput, accessToken: string): Promise<Area>;
  update(id: string, input: UpdateAreaInput, accessToken: string): Promise<Area>;
  deactivate(id: string, accessToken: string): Promise<Area>;
}

export function createAreaService(repository: AreaRepository): AreaService {
  return {
    list(filter, accessToken) {
      return repository.list(filter, accessToken);
    },

    async getById(id, accessToken) {
      const area = await repository.findById(id, accessToken);
      if (!area) {
        throw new NotFoundError('area');
      }
      return area;
    },

    create(input, accessToken) {
      return repository.create(input, accessToken);
    },

    async update(id, input, accessToken) {
      const area = await repository.update(id, input, accessToken);
      if (!area) {
        throw new NotFoundError('area');
      }
      return area;
    },

    async deactivate(id, accessToken) {
      const area = await repository.setStatus(id, 'inactive', accessToken);
      if (!area) {
        throw new NotFoundError('area');
      }
      return area;
    },
  };
}
