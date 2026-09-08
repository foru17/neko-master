/**
 * Node Manager (nodemgr) — Fastify plugin that proxies node hot-update
 * operations to the host-side node-tool service.
 *
 * Why a proxy: adding / removing / switching mihomo nodes requires writing the
 * mihomo config file on the *host* and reloading the process (SIGHUP), which a
 * container cannot do. The node-tool service on the host (default
 * http://172.17.0.1:8008) performs those privileged steps; this module exposes
 * it to the dashboard under /api/nt/* with the panel's normal auth applied
 * (the global auth hook covers every non-public route).
 *
 * Endpoints (mirror the node-tool API):
 *   GET    /state          -> combined status: mihomo health, main group selection, nodes
 *   GET    /nodes          -> list of self-managed nodes
 *   POST   /nodes          -> add node(s): { text: string, auto_select?: boolean }
 *   POST   /select         -> switch main group selection: { name: string, group?: string }
 *   DELETE /nodes/:name    -> remove a node by name
 */

import type { FastifyPluginAsync } from 'fastify';

const NODE_TOOL_URL = (process.env.NODE_TOOL_URL || 'http://172.17.0.1:8008').replace(/\/+$/, '');

const TIMEOUT_MS = 20_000;

async function proxy(
  method: string,
  upstreamPath: string, // 含可选的 query string，如 'diag/connections?limit=50'
  body?: unknown,
  timeoutMs: number = TIMEOUT_MS,
): Promise<{ status: number; payload: unknown }> {
  const url = `${NODE_TOOL_URL}/api/${upstreamPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let payload: unknown = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }
    return { status: res.status, payload };
  } finally {
    clearTimeout(timer);
  }
}

const nodemgrController: FastifyPluginAsync = async (fastify) => {
  // GET /api/nt/state
  fastify.get('/state', async (_request, reply) => {
    const { status, payload } = await proxy('GET', 'state');
    return reply.status(status).send(payload);
  });

  // GET /api/nt/nodes
  fastify.get('/nodes', async (_request, reply) => {
    const { status, payload } = await proxy('GET', 'nodes');
    return reply.status(status).send(payload);
  });

  // POST /api/nt/nodes  body: { text, auto_select }
  fastify.post<{ Body: { text?: string; auto_select?: boolean } }>(
    '/nodes',
    async (request, reply) => {
      const body = (request.body ?? {}) as { text?: string; auto_select?: boolean };
      if (!body.text || typeof body.text !== 'string' || !body.text.trim()) {
        return reply.status(400).send({ error: 'text is required' });
      }
      const { status, payload } = await proxy('POST', 'nodes', {
        text: body.text,
        auto_select: body.auto_select !== false,
      });
      return reply.status(status).send(payload);
    },
  );

  // POST /api/nt/select  body: { name, group? }
  fastify.post<{ Body: { name?: string; group?: string } }>(
    '/select',
    async (request, reply) => {
      const body = (request.body ?? {}) as { name?: string; group?: string };
      if (!body.name || typeof body.name !== 'string') {
        return reply.status(400).send({ error: 'name is required' });
      }
      const { status, payload } = await proxy('POST', 'select', {
        name: body.name,
        ...(body.group ? { group: body.group } : {}),
      });
      return reply.status(status).send(payload);
    },
  );

  // DELETE /api/nt/nodes/:name
  fastify.delete<{ Params: { name: string } }>('/nodes/:name', async (request, reply) => {
    const name = request.params.name;
    const { status, payload } = await proxy('DELETE', `nodes/${encodeURIComponent(name)}`);
    return reply.status(status).send(payload);
  });

  // ---- daemon (服务端生命周期) 代理 ----
  const DAEMON_ACTIONS = new Set(['install', 'update', 'start', 'restart', 'stop', 'uninstall']);

  // GET /api/nt/daemon/status
  fastify.get('/daemon/status', async (_request, reply) => {
    const { status, payload } = await proxy('GET', 'daemon/status');
    return reply.status(status).send(payload);
  });

  // POST /api/nt/daemon/:action  body: { engine, url?, purge?, confirm? }
  fastify.post<{ Params: { action: string }; Body: Record<string, unknown> }>(
    '/daemon/:action',
    async (request, reply) => {
      const action = request.params.action;
      if (!DAEMON_ACTIONS.has(action)) {
        return reply.status(400).send({ error: `unsupported daemon action: ${action}` });
      }
      const body = (request.body ?? {}) as Record<string, unknown>;
      const { status, payload } = await proxy('POST', `daemon/${action}`, {
        engine: typeof body.engine === 'string' ? body.engine : 'mihomo',
        url: typeof body.url === 'string' ? body.url : undefined,
        purge: body.purge === true,
        confirm: body.confirm === true,
      });
      return reply.status(status).send(payload);
    },
  );

  // ---- 分流规则 CRUD 代理 (node-tool /api/rules*) ----
  // GET /api/nt/rules -> { rules: [{index,text,match,rule_set}], targets, groups, types }
  fastify.get('/rules', async (_request, reply) => {
    const { status, payload } = await proxy('GET', 'rules');
    return reply.status(status).send(payload);
  });

  // POST /api/nt/rules  body: { text, position?: 'top' | 'bottom' }
  fastify.post<{ Body: { text?: string; position?: string } }>(
    '/rules',
    async (request, reply) => {
      const body = (request.body ?? {}) as { text?: string; position?: string };
      if (!body.text || typeof body.text !== 'string' || !body.text.trim()) {
        return reply.status(400).send({ error: 'text is required' });
      }
      const { status, payload } = await proxy('POST', 'rules', {
        text: body.text,
        position: body.position === 'top' ? 'top' : 'bottom',
      });
      return reply.status(status).send(payload);
    },
  );

  // PUT /api/nt/rules/:index  body: { text }
  fastify.put<{ Params: { index: string }; Body: { text?: string } }>(
    '/rules/:index',
    async (request, reply) => {
      const body = (request.body ?? {}) as { text?: string };
      if (!body.text || typeof body.text !== 'string' || !body.text.trim()) {
        return reply.status(400).send({ error: 'text is required' });
      }
      const { status, payload } = await proxy(
        'PUT',
        `rules/${encodeURIComponent(request.params.index)}`,
        { text: body.text },
      );
      return reply.status(status).send(payload);
    },
  );

  // POST /api/nt/rules/:index/move  body: { direction: 'up' | 'down' }
  fastify.post<{ Params: { index: string }; Body: { direction?: string } }>(
    '/rules/:index/move',
    async (request, reply) => {
      const body = (request.body ?? {}) as { direction?: string };
      const { status, payload } = await proxy(
        'POST',
        `rules/${encodeURIComponent(request.params.index)}/move`,
        { direction: body.direction === 'down' ? 'down' : 'up' },
      );
      return reply.status(status).send(payload);
    },
  );

  // DELETE /api/nt/rules/:index
  fastify.delete<{ Params: { index: string } }>('/rules/:index', async (request, reply) => {
    const { status, payload } = await proxy(
      'DELETE',
      `rules/${encodeURIComponent(request.params.index)}`,
    );
    return reply.status(status).send(payload);
  });

  // ---- 规则集(rule-providers)代理 ----
  // GET /api/nt/providers -> 规则集清单(本地可编辑/远程只读)
  fastify.get('/providers', async (_request, reply) => {
    const { status, payload } = await proxy('GET', 'providers');
    return reply.status(status).send(payload);
  });

  // GET /api/nt/providers/:name -> 本地规则集内容
  fastify.get<{ Params: { name: string } }>('/providers/:name', async (request, reply) => {
    const { status, payload } = await proxy(
      'GET',
      `providers/${encodeURIComponent(request.params.name)}`,
    );
    return reply.status(status).send(payload);
  });

  // POST /api/nt/providers  body: { name, behavior, lines }
  fastify.post<{ Body: { name?: string; behavior?: string; lines?: string[] } }>(
    '/providers',
    async (request, reply) => {
      const body = (request.body ?? {}) as { name?: string; behavior?: string; lines?: string[] };
      if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
        return reply.status(400).send({ error: 'name is required' });
      }
      if (!Array.isArray(body.lines)) {
        return reply.status(400).send({ error: 'lines must be an array' });
      }
      const { status, payload } = await proxy('POST', 'providers', {
        name: body.name,
        behavior: typeof body.behavior === 'string' ? body.behavior : 'domain',
        lines: body.lines,
      });
      return reply.status(status).send(payload);
    },
  );

  // PUT /api/nt/providers/:name  body: { behavior, lines }
  fastify.put<{ Params: { name: string }; Body: { behavior?: string; lines?: string[] } }>(
    '/providers/:name',
    async (request, reply) => {
      const body = (request.body ?? {}) as { behavior?: string; lines?: string[] };
      if (!Array.isArray(body.lines)) {
        return reply.status(400).send({ error: 'lines must be an array' });
      }
      const { status, payload } = await proxy(
        'PUT',
        `providers/${encodeURIComponent(request.params.name)}`,
        {
          behavior: typeof body.behavior === 'string' ? body.behavior : 'domain',
          lines: body.lines,
        },
      );
      return reply.status(status).send(payload);
    },
  );

  // DELETE /api/nt/providers/:name
  fastify.delete<{ Params: { name: string } }>('/providers/:name', async (request, reply) => {
    const { status, payload } = await proxy(
      'DELETE',
      `providers/${encodeURIComponent(request.params.name)}`,
    );
    return reply.status(status).send(payload);
  });

  // ---- 诊断/运维 (diag) 通配代理: /api/nt/diag/* -> node-tool /api/diag/*
  // 覆盖: egress/speed/trace/connections/backups/config (含 query 与路径参数)
  const DIAG_TIMEOUT_MS = 60_000; // 测速/追踪较慢, 放宽超时
  fastify.all('/diag/*', async (request, reply) => {
    const rest = String((request.params as Record<string, string>)['*'] ?? '');
    const rawUrl = request.raw.url ?? '';
    const qIdx = rawUrl.indexOf('?');
    const query = qIdx >= 0 ? rawUrl.slice(qIdx) : '';
    const pathSegs = rest.split('/').filter(Boolean).map((s) => encodeURIComponent(s));
    const upstream = `diag/${pathSegs.join('/')}${query}`;
    const body = request.body !== undefined && request.body !== null ? request.body : undefined;
    const { status, payload } = await proxy(
      request.method,
      upstream,
      body as Record<string, unknown> | undefined,
      DIAG_TIMEOUT_MS,
    );
    return reply.status(status).send(payload);
  });
};

export default nodemgrController;
