/**
 * Resolve the URL of the FastAPI service from a server-side context (i.e.
 * inside a Next.js API route or server component).
 *
 * Precedence:
 *   1. SERVICE_URL              docker-network hostname (e.g. http://service:8000)
 *   2. NEXT_PUBLIC_API_URL      browser-facing URL, used as a fallback when running
 *                               the webapp on the same host as the service
 *   3. http://localhost:8000    last-resort default
 *
 * Use this in EVERY route under src/app/api/* that proxies to the service.
 * Never hard-code http://localhost:8000 in route handlers.
 */
export function getServiceUrl(): string {
  const raw =
    process.env.SERVICE_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:8000';
  return raw.replace(/\/+$/, '');
}
