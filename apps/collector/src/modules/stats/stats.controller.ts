/**
 * Stats Controller - Fastify routes for /api/stats
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { StatsService } from './stats.service.js';
import type { TimeRange } from './stats.types.js';

// Extend Fastify instance to include statsService
declare module 'fastify' {
  interface FastifyInstance {
    statsService: StatsService;
  }
}

function parseOffset(raw: string | undefined): number {
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) return 0;
  return parsed;
}

// Helper function to get backend ID from request
function getBackendId(request: FastifyRequest, service: StatsService): number | null {
  const query = request.query as Record<string, string | undefined>;
  return service.resolveBackendId(query.backendId);
}

// Helper function to parse time range
function getTimeRange(request: FastifyRequest, reply: FastifyReply, isShowcaseMode = false): TimeRange | null {
  const query = request.query as Record<string, string | undefined>;
  const { start, end } = query;

  if (isShowcaseMode) {
    // In showcase mode, we clamp the start time to be no older than 24 hours ago
    const now = new Date();
    const minStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // Default to last 24h if no params
    if (!start) {
      return {
        start: minStart.toISOString(),
        end: now.toISOString(),
        active: true,
      };
    }

    // Parse provided start/end
    let startDate = new Date(start);
    let endDate = end ? new Date(end) : now;

    if (Number.isNaN(startDate.getTime())) {
       // If invalid start, default to 24h
       startDate = minStart;
       endDate = now;
    }

    if (Number.isNaN(endDate.getTime())) {
      endDate = now;
    }

    // Clamp start
    if (startDate < minStart) {
      startDate = minStart;
    }
    
    // Ensure start <= end
    if (startDate > endDate) {
      startDate = minStart;
      endDate = now;
    }

    return {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      active: true,
    };
  }

  if (!start && !end) {
    return { active: false };
  }
  if (!start || !end) {
    reply.status(400).send({ error: 'Both start and end must be provided together' });
    return null;
  }

  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    reply.status(400).send({ error: 'Invalid time range format, expected ISO datetime' });
    return null;
  }
  if (startDate > endDate) {
    reply.status(400).send({ error: 'start must be less than or equal to end' });
    return null;
  }

  return {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    active: true,
  };
}

const statsController: FastifyPluginAsync = async (fastify: FastifyInstance): Promise<void> => {
  const service = fastify.statsService;

  // Get summary statistics for a specific backend
  fastify.get('/summary', async (request, reply) => {
    const backendId = getBackendId(request, service);
    const timeRange = getTimeRange(request, reply, fastify.authService.isShowcaseMode());
    
    if (timeRange === null) {
      return;
    }

    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    try {
      const result = await service.getSummaryWithRouting(backendId, timeRange);
      return result;
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'Backend not found') {
        return reply.status(404).send({ error: 'Backend not found' });
      }
      throw error;
    }
  });

  // Get global summary across all backends
  fastify.get('/global', async () => {
    return service.getGlobalSummaryWithRouting();
  });

  // Get domain statistics for a specific backend (paginated)
  fastify.get('/domains', async (request, reply) => {
    const backendId = getBackendId(request, service);
    const timeRange = getTimeRange(request, reply, fastify.authService.isShowcaseMode());

    if (timeRange === null) {
      return;
    }

    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    const query = request.query as Record<string, string | undefined>;
    const { offset, limit, sortBy, sortOrder, search } = query;
    const parsedOffset = parseOffset(offset);
    const parsedLimit = service.parseLimit(limit, 50, 200);

    return await service.getDomainStatsPaginatedWithRouting(backendId, timeRange, {
      offset: parsedOffset,
      limit: parsedLimit,
      sortBy,
      sortOrder,
      search,
    });
  });

  // Get IP statistics for a specific backend (paginated)
  fastify.get('/ips', async (request, reply) => {
    const backendId = getBackendId(request, service);
    const timeRange = getTimeRange(request, reply, fastify.authService.isShowcaseMode());

    if (timeRange === null) {
      return;
    }

    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    const query = request.query as Record<string, string | undefined>;
    const { offset, limit, sortBy, sortOrder, search } = query;
    const parsedOffset = parseOffset(offset);
    const parsedLimit = service.parseLimit(limit, 50, 200);

    return await service.getIPStatsPaginatedWithRouting(backendId, timeRange, {
      offset: parsedOffset,
      limit: parsedLimit,
      sortBy,
      sortOrder,
      search,
    });
  });

  // Get per-proxy traffic breakdown for a specific domain
  fastify.get('/domains/proxy-stats', async (request, reply) => {
    const backendId = getBackendId(request, service);
    const timeRange = getTimeRange(request, reply, fastify.authService.isShowcaseMode());

    if (timeRange === null) {
      return;
    }
    
    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    const query = request.query as Record<string, string | undefined>;
    const { domain, sourceIP, sourceChain } = query;
    if (!domain) {
      return reply.status(400).send({ error: 'Domain parameter is required' });
    }

    return await service.getDomainProxyStatsWithRouting(
      backendId,
      domain,
      timeRange,
      sourceIP,
      sourceChain,
    );
  });

  // Get IP details for a specific domain
  fastify.get('/domains/ip-details', async (request, reply) => {
    const backendId = getBackendId(request, service);
    const timeRange = getTimeRange(request, reply, fastify.authService.isShowcaseMode());

    if (timeRange === null) {
      return;
    }
    
    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    const query = request.query as Record<string, string | undefined>;
    const { domain, sourceIP, sourceChain, limit } = query;
    if (!domain) {
      return reply.status(400).send({ error: 'Domain parameter is required' });
    }

    const effectiveLimit = service.parseLimit(limit, 100, 2000);
    return await service.getDomainIPDetailsWithRouting(
      backendId,
      domain,
      timeRange,
      effectiveLimit,
      sourceIP,
      sourceChain,
    );
  });

  // Get per-proxy traffic breakdown for a specific IP
  fastify.get('/ips/proxy-stats', async (request, reply) => {
    const backendId = getBackendId(request, service);
    const timeRange = getTimeRange(request, reply, fastify.authService.isShowcaseMode());

    if (timeRange === null) {
      return;
    }
    
    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    const query = request.query as Record<string, string | undefined>;
    const { ip, sourceIP, sourceChain } = query;
    if (!ip) {
      return reply.status(400).send({ error: 'IP parameter is required' });
    }

    return await service.getIPProxyStatsWithRouting(
      backendId,
      ip,
      timeRange,
      sourceIP,
      sourceChain,
    );
  });

  // Get domain details for a specific IP
  fastify.get('/ips/domain-details', async (request, reply) => {
    const backendId = getBackendId(request, service);
    const timeRange = getTimeRange(request, reply, fastify.authService.isShowcaseMode());

    if (timeRange === null) {
      return;
    }

    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    const query = request.query as Record<string, string | undefined>;
    const { ip, sourceIP, sourceChain, limit } = query;
    if (!ip) {
      return reply.status(400).send({ error: 'IP parameter is required' });
    }

    const effectiveLimit = service.parseLimit(limit, 100, 2000);
    return await service.getIPDomainDetailsWithRouting(
      backendId,
      ip,
      timeRange,
      effectiveLimit,
      sourceIP,
      sourceChain,
    );
  });

  // Get domains for a specific proxy/chain
  fastify.get('/proxies/domains', async (request, reply) => {
    const backendId = getBackendId(request, service);
    const timeRange = getTimeRange(request, reply, fastify.authService.isShowcaseMode());

    if (timeRange === null) {
      return;
    }
    
    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    const query = request.query as Record<string, string | undefined>;
    const { chain, limit } = query;
    if (!chain) {
      return reply.status(400).send({ error: 'Chain parameter is required' });
    }
    const effectiveLimit = service.parseLimit(limit, 5000, 20000);

    return await service.getProxyDomainsWithRouting(
      backendId,
      chain,
      timeRange,
      effectiveLimit,
    );
  });

  // Get IPs for a specific proxy/chain
  fastify.get('/proxies/ips', async (request, reply) => {
    const backendId = getBackendId(request, service);
    const timeRange = getTimeRange(request, reply, fastify.authService.isShowcaseMode());

    if (timeRange === null) {
      return;
    }
    
    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    const query = request.query as Record<string, string | undefined>;
    const { chain, limit } = query;
    if (!chain) {
      return reply.status(400).send({ error: 'Chain parameter is required' });
    }
    const effectiveLimit = service.parseLimit(limit, 5000, 20000);

    return await service.getProxyIPsWithRouting(
      backendId,
      chain,
      timeRange,
      effectiveLimit,
    );
  });

  // Get proxy/chain statistics for a specific backend
  fastify.get('/proxies', async (request, reply) => {
    const backendId = getBackendId(request, service);
    const timeRange = getTimeRange(request, reply, fastify.authService.isShowcaseMode());
    
    if (timeRange === null) {
      return;
    }

    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    return await service.getProxyStatsWithRouting(backendId, timeRange);
  });

  // Get rule statistics for a specific backend
  fastify.get('/rules', async (request, reply) => {
    const backendId = getBackendId(request, service);
    const timeRange = getTimeRange(request, reply, fastify.authService.isShowcaseMode());
    
    if (timeRange === null) {
      return;
    }

    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    const result = await service.getRuleStatsWithRouting(backendId, timeRange);
    // Stats API response logging removed
    return result;
  });

  // Get domains for a specific rule
  fastify.get('/rules/domains', async (request, reply) => {
    const backendId = getBackendId(request, service);
    const timeRange = getTimeRange(request, reply, fastify.authService.isShowcaseMode());

    if (timeRange === null) {
      return;
    }
    
    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    const query = request.query as Record<string, string | undefined>;
    const { rule, limit } = query;
    if (!rule) {
      return reply.status(400).send({ error: 'Rule parameter is required' });
    }
    const effectiveLimit = service.parseLimit(limit, 5000, 20000);

    return await service.getRuleDomainsWithRouting(
      backendId,
      rule,
      timeRange,
      effectiveLimit,
    );
  });

  // Get IPs for a specific rule
  fastify.get('/rules/ips', async (request, reply) => {
    const backendId = getBackendId(request, service);
    const timeRange = getTimeRange(request, reply, fastify.authService.isShowcaseMode());

    if (timeRange === null) {
      return;
    }
    
    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    const query = request.query as Record<string, string | undefined>;
    const { rule, limit } = query;
    if (!rule) {
      return reply.status(400).send({ error: 'Rule parameter is required' });
    }
    const effectiveLimit = service.parseLimit(limit, 5000, 20000);

    return await service.getRuleIPsWithRouting(
      backendId,
      rule,
      timeRange,
      effectiveLimit,
    );
  });

  // Get per-proxy traffic breakdown for a specific domain under a specific rule
  fastify.get('/rules/domains/proxy-stats', async (request, reply) => {
    const backendId = getBackendId(request, service);
    const timeRange = getTimeRange(request, reply, fastify.authService.isShowcaseMode());

    if (timeRange === null) {
      return;
    }

    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    const query = request.query as Record<string, string | undefined>;
    const { rule, domain } = query;
    if (!rule || !domain) {
      return reply.status(400).send({ error: 'Rule and domain parameters are required' });
    }

    return await service.getRuleDomainProxyStatsWithRouting(
      backendId,
      rule,
      domain,
      timeRange,
    );
  });

  // Get IP details for a specific domain under a specific rule
  fastify.get('/rules/domains/ip-details', async (request, reply) => {
    const backendId = getBackendId(request, service);
    const timeRange = getTimeRange(request, reply, fastify.authService.isShowcaseMode());

    if (timeRange === null) {
      return;
    }

    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    const query = request.query as Record<string, string | undefined>;
    const { rule, domain, limit } = query;
    if (!rule || !domain) {
      return reply.status(400).send({ error: 'Rule and domain parameters are required' });
    }
    const effectiveLimit = service.parseLimit(limit, 100, 2000);

    return await service.getRuleDomainIPDetailsWithRouting(
      backendId,
      rule,
      domain,
      timeRange,
      effectiveLimit,
    );
  });

  // Get per-proxy traffic breakdown for a specific IP under a specific rule
  fastify.get('/rules/ips/proxy-stats', async (request, reply) => {
    const backendId = getBackendId(request, service);
    const timeRange = getTimeRange(request, reply, fastify.authService.isShowcaseMode());

    if (timeRange === null) {
      return;
    }

    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    const query = request.query as Record<string, string | undefined>;
    const { rule, ip } = query;
    if (!rule || !ip) {
      return reply.status(400).send({ error: 'Rule and IP parameters are required' });
    }

    return await service.getRuleIPProxyStatsWithRouting(
      backendId,
      rule,
      ip,
      timeRange,
    );
  });

  // Get domain details for a specific IP under a specific rule
  fastify.get('/rules/ips/domain-details', async (request, reply) => {
    const backendId = getBackendId(request, service);
    const timeRange = getTimeRange(request, reply, fastify.authService.isShowcaseMode());

    if (timeRange === null) {
      return;
    }

    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    const query = request.query as Record<string, string | undefined>;
    const { rule, ip, limit } = query;
    if (!rule || !ip) {
      return reply.status(400).send({ error: 'Rule and IP parameters are required' });
    }
    const effectiveLimit = service.parseLimit(limit, 100, 2000);

    return await service.getRuleIPDomainDetailsWithRouting(
      backendId,
      rule,
      ip,
      timeRange,
      effectiveLimit,
    );
  });

  // Get rule chain flow for a specific rule
  fastify.get('/rules/chain-flow', async (request, reply) => {
    const backendId = getBackendId(request, service);
    const timeRange = getTimeRange(request, reply, fastify.authService.isShowcaseMode());

    if (timeRange === null) {
      return;
    }
    
    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    const query = request.query as Record<string, string | undefined>;
    const { rule } = query;
    if (!rule) {
      return reply.status(400).send({ error: 'Rule parameter is required' });
    }

    return service.getRuleChainFlowWithRouting(backendId, rule, timeRange);
  });

  // Get all rule chain flows merged into unified DAG
  fastify.get('/rules/chain-flow-all', async (request, reply) => {
    const backendId = getBackendId(request, service);
    const timeRange = getTimeRange(request, reply, fastify.authService.isShowcaseMode());

    if (timeRange === null) {
      return;
    }

    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    return service.getAllRuleChainFlowsWithRouting(backendId, timeRange);
  });

  // Get rule to proxy mapping for a specific backend
  fastify.get('/rule-proxy-map', async (request, reply) => {
    const backendId = getBackendId(request, service);
    
    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    return service.getRuleProxyMapWithRouting(backendId);
  });

  // Get country traffic statistics for a specific backend
  fastify.get('/countries', async (request, reply) => {
    const backendId = getBackendId(request, service);
    const timeRange = getTimeRange(request, reply, fastify.authService.isShowcaseMode());
    
    if (timeRange === null) {
      return;
    }

    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    const query = request.query as Record<string, string | undefined>;
    const { limit } = query;
    const limitNum = service.parseLimit(limit, 50, 2000);

    return await service.getCountryStatsWithRouting(backendId, timeRange, limitNum);
  });

  // Get device statistics for a specific backend
  fastify.get('/devices', async (request, reply) => {
    const backendId = getBackendId(request, service);
    const timeRange = getTimeRange(request, reply, fastify.authService.isShowcaseMode());
    
    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }
    if (timeRange === null) {
      return;
    }

    const query = request.query as Record<string, string | undefined>;
    const { limit } = query;
    const effectiveLimit = service.parseLimit(limit, 50, 2000);

    return await service.getDeviceStatsWithRouting(
      backendId,
      timeRange,
      effectiveLimit,
    );
  });

  // Get domains for a specific device
  fastify.get('/devices/domains', async (request, reply) => {
    const backendId = getBackendId(request, service);
    const timeRange = getTimeRange(request, reply, fastify.authService.isShowcaseMode());
    
    if (timeRange === null) {
      return;
    }
    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    const query = request.query as Record<string, string | undefined>;
    const { sourceIP, limit } = query;
    const effectiveLimit = service.parseLimit(limit, 5000, 20000);

    return await service.getDeviceDomainsWithRouting(
      backendId,
      sourceIP || '',
      timeRange,
      effectiveLimit,
    );
  });

  // Get IPs for a specific device
  fastify.get('/devices/ips', async (request, reply) => {
    const backendId = getBackendId(request, service);
    const timeRange = getTimeRange(request, reply, fastify.authService.isShowcaseMode());
    
    if (timeRange === null) {
      return;
    }
    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    const query = request.query as Record<string, string | undefined>;
    const { sourceIP, limit } = query;
    const effectiveLimit = service.parseLimit(limit, 5000, 20000);

    return await service.getDeviceIPsWithRouting(
      backendId,
      sourceIP || '',
      timeRange,
      effectiveLimit,
    );
  });

  // Get hourly statistics for a specific backend
  fastify.get('/hourly', async (request, reply) => {
    const backendId = getBackendId(request, service);
    const timeRange = getTimeRange(request, reply, fastify.authService.isShowcaseMode());
    
    if (timeRange === null) {
      return;
    }

    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    const query = request.query as Record<string, string | undefined>;
    const { hours = '24' } = query;
    const hoursNum = service.parseLimit(hours, 24, 24 * 30);
    return await service.getHourlyStatsWithRouting(backendId, timeRange, hoursNum);
  });

  // Get traffic trend for a specific backend
  fastify.get('/trend', async (request, reply) => {
    const backendId = getBackendId(request, service);
    const timeRange = getTimeRange(request, reply, fastify.authService.isShowcaseMode());
    
    if (timeRange === null) {
      return;
    }

    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    const query = request.query as Record<string, string | undefined>;
    const { minutes = '30' } = query;
    const windowMinutes = service.parseLimit(minutes, 30, 60 * 24 * 7);
    return await service.getTrafficTrendWithRouting(backendId, timeRange, windowMinutes);
  });

  // Get traffic trend aggregated by time buckets for chart display
  fastify.get('/trend/aggregated', async (request, reply) => {
    const backendId = getBackendId(request, service);
    const timeRange = getTimeRange(request, reply, fastify.authService.isShowcaseMode());
    
    if (timeRange === null) {
      return;
    }

    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    const query = request.query as Record<string, string | undefined>;
    const { minutes = '30', bucketMinutes = '1', tzOffsetMinutes } = query;
    const windowMinutes = service.parseLimit(minutes, 30, 60 * 24 * 7);
    const bucket = service.parseLimit(bucketMinutes, 1, 24 * 60);
    const parsedOffset = typeof tzOffsetMinutes === 'string' ? Number(tzOffsetMinutes) : 0;
    const timezoneOffset = Number.isFinite(parsedOffset)
      ? Math.max(-840, Math.min(840, Math.trunc(parsedOffset)))
      : 0;
    return await service.getTrafficTrendAggregatedWithRouting(
      backendId,
      timeRange,
      windowMinutes,
      bucket,
      timezoneOffset,
    );
  });

  // Get recent connections for a specific backend
  fastify.get('/connections', async (request, reply) => {
    const backendId = getBackendId(request, service);
    
    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    const query = request.query as Record<string, string | undefined>;
    const { limit = '100' } = query;
    const limitNum = service.parseLimit(limit, 100, 2000);
    return service.getRecentConnectionsWithRouting(backendId, limitNum);
  });

};

export default statsController;
