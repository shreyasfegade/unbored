/**
 * Dev-only: serve the Vercel functions in api/ from the Vite dev server, so
 * `npm run dev` has the AI endpoints without the Vercel CLI. Each route file
 * exports GET/POST handlers taking a Web Request; this adapts Node's request to
 * one and streams the Response back. Production uses Vercel's own runtime.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';
import { loadEnv } from 'vite';

type Handler = (req: Request) => Promise<Response>;

async function toRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(', '));
  }
  headers.set('x-forwarded-for', req.socket.remoteAddress ?? '127.0.0.1');
  const body = chunks.length && req.method !== 'GET' && req.method !== 'HEAD' ? Buffer.concat(chunks) : undefined;
  return new Request(origin + (req.url ?? '/'), { method: req.method, headers, body });
}

export function devApi(): Plugin {
  return {
    name: 'unbored-dev-api',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      // Function env (GEMINI_API_KEY, SUPABASE_*) from .env files, unprefixed.
      Object.assign(process.env, loadEnv(server.config.mode, server.config.root, ''));
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const path = (req.url ?? '').split('?')[0];
        const m = /^\/api\/(ai\/[a-z]+)$/.exec(path);
        if (!m) return next();
        try {
          const mod = (await server.ssrLoadModule(`/api/${m[1]}.ts`)) as Record<string, Handler>;
          const handler = mod[req.method ?? 'GET'];
          if (!handler) {
            res.statusCode = 405;
            return res.end();
          }
          const out = await handler(await toRequest(req, `http://${req.headers.host}`));
          res.statusCode = out.status;
          out.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await out.arrayBuffer()));
        } catch (err) {
          server.config.logger.error(`[dev-api] ${path}: ${(err as Error).message}`);
          res.statusCode = 500;
          res.end(JSON.stringify({ detail: 'dev function failed' }));
        }
      });
    },
  };
}
