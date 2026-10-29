/**
 * Backend Controller - Fastify routes for /api/backends
 */

import { errorCodes } from 'fastify';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { BackendService } from './backend.service.js';
import type {
  CreateBackendInput,
  UpdateBackendInput,
  TestConnectionInput,
} from './backend.types.js';

// Extend Fastify instance to include backendService
declare module 'fastify' {
  interface FastifyInstance {
    backendService: BackendService;
  }
}

interface BackendParams {
  id: string;
}

interface ListeningBody {
  listening: boolean;
}

const backendController: FastifyPluginAsync = async (fastify: FastifyInstance): Promise<void> => {
  const service = fastify.backendService;

  // Get all backends
  fastify.get('/', async () => {
    return service.getAllBackends();
  });

  // Get active backend
  fastify.get('/active', async () => {
    return service.getActiveBackend();
  });

  // Get listening backends
  fastify.get('/listening', async () => {
    return service.getListeningBackends();
  });

  // Create new backend
  fastify.post<{ Body: CreateBackendInput }>('/', async (request, reply) => {
    if (fastify.authService.isShowcaseMode()) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { name, url, token, type } = request.body;
    
    if (!name || !url) {
      return reply.status(400).send({ error: 'Name and URL are required' });
    }
    
    try {
      const result = service.createBackend({ name, url, token, type });
      return result;
    } catch (error: any) {
      if (error.message?.includes('UNIQUE constraint failed')) {
        return reply.status(409).send({ error: 'Backend name already exists' });
      }
      throw error;
    }
  });

  // Update backend
  fastify.put<{ Params: BackendParams; Body: UpdateBackendInput }>('/:id', async (request, reply) => {
    if (fastify.authService.isShowcaseMode()) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { id } = request.params;
    const backendId = parseInt(id);
    
    const backend = service.getBackend(backendId);
    if (!backend) {
      return reply.status(404).send({ error: 'Backend not found' });
    }
    
    const result = service.updateBackend(backendId, request.body);
    return result;
  });

  // Delete backend
  fastify.delete<{ Params: BackendParams }>('/:id', async (request, reply) => {
    if (fastify.authService.isShowcaseMode()) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { id } = request.params;
    const backendId = parseInt(id);
    
    const backend = service.getBackend(backendId);
    if (!backend) {
      return reply.status(404).send({ error: 'Backend not found' });
    }
    
    const result = await service.deleteBackend(backendId);
    return result;
  });

  // A proxy can forward an empty HTTP/2 request as chunked HTTP/1.1, without
  // a Content-Type. Scope the parser to endpoints that do not require a body.
  await fastify.register(async (bodylessRoutes) => {
    bodylessRoutes.addContentTypeParser('*', { parseAs: 'buffer' }, (request, body, done) => {
      if (request.headers['content-type'] === undefined && body.length === 0) {
        done(null, undefined);
        return;
      }
      done(new errorCodes.FST_ERR_CTP_INVALID_MEDIA_TYPE());
    });

    // Set active backend
    bodylessRoutes.post<{ Params: BackendParams }>('/:id/activate', async (request, reply) => {
      // fastify.authService.isShowcaseMode() check removed to allow switching in demo mode

      const { id } = request.params;
      const backendId = parseInt(id);

      const backend = service.getBackend(backendId);
      if (!backend) {
        return reply.status(404).send({ error: 'Backend not found' });
      }

      const result = service.setActiveBackend(backendId);
      return result;
    });

    // Test existing backend connection (uses stored token)
    bodylessRoutes.post<{ Params: BackendParams }>('/:id/test', async (request, reply) => {
      if (fastify.authService.isShowcaseMode()) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const { id } = request.params;
      const backendId = parseInt(id);

      const backend = service.getBackend(backendId);
      if (!backend) {
        return reply.status(404).send({ error: 'Backend not found' });
      }

      const result = await service.testExistingBackendConnection(backendId);
      return result;
    });

    // Rotate agent token for a backend
    bodylessRoutes.post<{ Params: BackendParams }>('/:id/rotate-agent-token', async (request, reply) => {
      if (fastify.authService.isShowcaseMode()) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const { id } = request.params;
      const backendId = parseInt(id);

      const backend = service.getBackend(backendId);
      if (!backend) {
        return reply.status(404).send({ error: 'Backend not found' });
      }

      const result = service.rotateAgentToken(backendId);
      return result;
    });

    // Clear all data for a specific backend
    bodylessRoutes.post<{ Params: BackendParams }>('/:id/clear-data', async (request, reply) => {
      if (fastify.authService.isShowcaseMode()) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const { id } = request.params;
      const backendId = parseInt(id);

      const backend = service.getBackend(backendId);
      if (!backend) {
        return reply.status(404).send({ error: 'Backend not found' });
      }

      const result = await service.clearBackendData(backendId);
      return result;
    });
  });

  // Set listening state for a backend
  fastify.post<{ Params: BackendParams; Body: ListeningBody }>('/:id/listening', async (request, reply) => {
    if (fastify.authService.isShowcaseMode()) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { id } = request.params;
    const { listening } = request.body;
    const backendId = parseInt(id);
    
    const backend = service.getBackend(backendId);
    if (!backend) {
      return reply.status(404).send({ error: 'Backend not found' });
    }
    
    const result = service.setBackendListening(backendId, listening);
    return result;
  });

  // Test backend connection
  fastify.post<{ Body: TestConnectionInput }>('/test', async (request, reply) => {
    if (fastify.authService.isShowcaseMode()) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const result = await service.testConnection(request.body);
    return result;
  });

  // Get health history for all (or a specific) backend
  fastify.get<{ Querystring: { from?: string; to?: string; backendId?: string } }>(
    '/health/history',
    async (request, reply) => {
      const { from, to, backendId } = request.query;

      const toISO = (to ?? new Date().toISOString()).slice(0, 16);
      const fromISO = (from ?? new Date(Date.now() - 24 * 3600_000).toISOString()).slice(0, 16);

      let parsedBackendId: number | undefined;
      if (backendId !== undefined) {
        parsedBackendId = parseInt(backendId, 10);
        if (Number.isNaN(parsedBackendId)) {
          return reply.status(400).send({ error: 'Invalid backendId' });
        }
      }

      return service.getHealthHistory(fromISO, toISO, parsedBackendId);
    },
  );

};

export default backendController;
