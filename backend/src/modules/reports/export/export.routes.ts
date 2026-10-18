import type { FastifyInstance, FastifyReply } from 'fastify';
import { createAuthenticate } from '../../auth/authenticate.js';
import { createRequireRole } from '../../auth/authorize.js';
import type { ProfileRepository } from '../../auth/profile-repository.js';
import { OPERATIONAL_ROLES } from '../../auth/roles.js';
import type { TokenVerifier } from '../../auth/token-verifier.js';
import { sendDomainError } from '../../common/http-errors.js';
import type { ReportsRepository } from '../reports.repository.js';
import { createReportsService } from '../reports.service.js';
import type { ReportsExportRepository } from './export.repository.js';
import { exportExcelQuerySchema, exportPdfQuerySchema } from './export.schemas.js';
import {
  createReportsExportService,
  type ReportExportFile,
} from './export.service.js';

export interface ReportsRoutesOptions {
  verifier: TokenVerifier;
  profileRepository: ProfileRepository;
  reportsRepository: ReportsRepository;
  reportsExportRepository: ReportsExportRepository;
}

/**
 * Rutas de reportes y analisis.
 *
 * `GET /reports/summary` es de SOLO LECTURA y devuelve todas las estadisticas en
 * una sola respuesta agregada, calculada en el backend con el JWT del usuario
 * (RLS). Exige un rol operativo ACTIVO (admin, manager, operator o
 * veterinarian); `viewer`, usuarios inactivos y peticiones sin token reciben
 * 401/403.
 *
 * `GET /reports/export/excel` y `GET /reports/export/pdf` generan el archivo EN
 * MEMORIA con la identidad del usuario (RLS) y lo devuelven como descarga bajo
 * demanda. No se almacena ningun documento en buckets ni en disco.
 *
 * Los parametros de filtro son los mismos que admite el backend en sus endpoints
 * operativos (rango de fechas y categorias reales); el esquema los valida y un
 * valor no previsto se rechaza con 400.
 */
export async function reportsExportRoutes(
  app: FastifyInstance,
  options: ReportsRoutesOptions,
): Promise<void> {
  const authenticate = createAuthenticate(options.verifier);
  const requireRead = createRequireRole({
    repository: options.profileRepository,
    allowedRoles: OPERATIONAL_ROLES,
  });
  const service = createReportsService(options.reportsRepository);
  const exportService = createReportsExportService({
    repository: options.reportsExportRepository,
    summaryService: service,
  });
  const preHandler = [authenticate, requireRead];

  app.get('/reports/export/excel', { preHandler }, async (request, reply) => {
    const parsed = exportExcelQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query' });
    }

    const token = request.authToken;
    if (!token) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    try {
      const file = await exportService.getExcel(parsed.data, token);
      return sendFile(reply, file);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  app.get('/reports/export/pdf', { preHandler }, async (request, reply) => {
    const parsed = exportPdfQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query' });
    }

    const token = request.authToken;
    if (!token) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    try {
      const file = await exportService.getPdf(parsed.data, token);
      return sendFile(reply, file);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });
}

/** Envia el archivo generado como descarga; nunca se cachea ni se reinterpreta. */
function sendFile(reply: FastifyReply, file: ReportExportFile): FastifyReply {
  return reply
    .header('Content-Type', file.contentType)
    .header(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    )
    .header('Cache-Control', 'no-store')
    .header('X-Content-Type-Options', 'nosniff')
    .send(file.buffer);
}
