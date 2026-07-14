import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const PROXY_PATH = '/__provider_proxy';
const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Dev proxy: accept self-signed / internal TLS certs. */
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
  timeout: 60_000,
});

/**
 * True for hostnames that resolve to the local machine or a private LAN — the
 * only http targets the dev proxy forwards to. This keeps the proxy from being
 * turned into an open relay to arbitrary public http hosts (SSRF via the dev
 * server) while still reaching local LLM tooling (LM Studio, Ollama) that a
 * developer runs on their own network over plain http.
 */
function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (LOCALHOST_HOSTS.has(hostname) || host === 'localhost') return true;
  if (host.endsWith('.localhost') || host.endsWith('.local')) return true;

  // IPv4 private / loopback / link-local ranges (RFC 1918 + 127/8 + 169.254/16).
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1, 3).map(Number);
    if (a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }

  // IPv6 loopback (::1), unique-local (fc00::/7 → fc/fd), and link-local (fe80::/10).
  if (host === '::1') return true;
  if (host.startsWith('fc') || host.startsWith('fd')) return true;
  if (host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb'))
    return true;

  return false;
}

export function isAllowedTarget(target: string): boolean {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  // https is allowed to any host; http is restricted to local/LAN targets only.
  if (url.protocol === 'http:') {
    return isPrivateOrLocalHost(url.hostname);
  }
  return true;
}

function formatFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause;
  if (cause instanceof Error && cause.message) {
    return `${err.message} (${cause.message})`;
  }
  if (typeof cause === 'string' && cause) {
    return `${err.message} (${cause})`;
  }
  return err.message;
}

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

function forwardRequest(
  req: IncomingMessage,
  res: ServerResponse,
  target: string,
  body: Buffer | undefined,
): void {
  const targetUrl = new URL(target);
  const isHttps = targetUrl.protocol === 'https:';
  const client = isHttps ? https : http;

  const headers: Record<string, string | string[] | undefined> = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  delete headers['x-proxy-target'];

  const proxyReq = client.request(
    {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method: req.method,
      headers,
      agent: isHttps ? httpsAgent : undefined,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.statusCode = 502;
      res.end(`Proxy error: ${formatFetchError(err)}`);
    }
  });

  if (body && body.length > 0) proxyReq.end(body);
  else proxyReq.end();
}

async function forward(req: IncomingMessage, res: ServerResponse, target: string): Promise<void> {
  try {
    const body = await readBody(req);
    forwardRequest(req, res, target, body);
  } catch (err) {
    if (!res.headersSent) {
      res.statusCode = 502;
      res.end(`Proxy error: ${formatFetchError(err)}`);
    }
  }
}

/** Dev-only middleware: forwards GET/POST /__provider_proxy to X-Proxy-Target. */
export function providerDevProxyPlugin(): Plugin {
  return {
    name: 'provider-dev-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(PROXY_PATH)) return next();

        if (req.method === 'OPTIONS') {
          const requested = req.headers['access-control-request-headers'];
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers':
              typeof requested === 'string'
                ? requested
                : 'Content-Type, Authorization, X-Proxy-Target',
            'Access-Control-Max-Age': '86400',
          });
          res.end();
          return;
        }

        if (req.method !== 'GET' && req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        const target = req.headers['x-proxy-target'];
        if (typeof target !== 'string' || !isAllowedTarget(target)) {
          res.statusCode = 400;
          res.end('Missing or invalid X-Proxy-Target');
          return;
        }

        void forward(req, res, target);
      });
    },
  };
}
