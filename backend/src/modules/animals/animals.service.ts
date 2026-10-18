import { NotFoundError, ValidationError } from '../common/data-errors.js';
import type { AnimalStatus } from '../common/animal.js';
import type {
  Animal,
  AnimalLocation,
  AnimalRepository,
  CreateAnimalInput,
  ListAnimalsFilter,
  UpdateAnimalInput,
} from './animals.repository.js';

/**
 * Logica de negocio de porcinos. Depende de un `AnimalRepository` inyectable.
 *
 * No hay borrado fisico: la baja es el estado administrativo `inactive`
 * (endpoint de estado). `animal_code` es inmutable y el corral actual no se
 * cambia por esta via (se reserva a los movimientos, para conservar la
 * trazabilidad).
 */
export interface AnimalService {
  list(filter: ListAnimalsFilter, accessToken: string): Promise<Animal[]>;
  getById(id: string, accessToken: string): Promise<Animal>;
  create(
    input: CreateAnimalInput,
    createdBy: string,
    accessToken: string,
  ): Promise<Animal>;
  update(
    id: string,
    input: UpdateAnimalInput,
    accessToken: string,
  ): Promise<Animal>;
  updateStatus(
    id: string,
    status: AnimalStatus,
    accessToken: string,
  ): Promise<Animal>;
  getLocation(id: string, accessToken: string): Promise<AnimalLocation>;
}

export function createAnimalService(repository: AnimalRepository): AnimalService {
  return {
    list(filter, accessToken) {
      return repository.list(filter, accessToken);
    },

    async getById(id, accessToken) {
      const animal = await repository.findById(id, accessToken);
      if (!animal) {
        throw new NotFoundError('porcino');
      }
      return animal;
    },

    create(input, createdBy, accessToken) {
      return repository.create(input, createdBy, accessToken);
    },

    async update(id, input, accessToken) {
      // El esquema prohibe que un animal sea su propia madre o padre
      // (CHECK id <> mother_id/father_id). Se valida aqui para responder 400
      // en lugar de un fallo generico de datos.
      if (input.mother_id === id || input.father_id === id) {
        throw new ValidationError(
          'un animal no puede ser su propia madre o padre',
        );
      }

      const animal = await repository.update(id, input, accessToken);
      if (!animal) {
        throw new NotFoundError('porcino');
      }
      return animal;
    },

    async updateStatus(id, status, accessToken) {
      const animal = await repository.setStatus(id, status, accessToken);
      if (!animal) {
        throw new NotFoundError('porcino');
      }
      return animal;
    },

    async getLocation(id, accessToken) {
      const location = await repository.findLocation(id, accessToken);
      if (!location) {
        throw new NotFoundError('porcino');
      }
      return location;
    },
  };
}
