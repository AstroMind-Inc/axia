// Request checks used by middleware.ts, kept separate so they can be unit tested.

const PUBLIC_PATHS = new Set(["/login"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/api/auth")) return true;
  if (pathname.startsWith("/_next")) return true;
  if (pathname === "/favicon.ico" || pathname === "/site-favicon.ico") return true;
  // Static images only. API routes never qualify, whatever they end in:
  // `/api/datasets/sources.png` must still require a session.
  if (pathname.startsWith("/api/")) return false;
  return /\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?)$/i.test(pathname);
}

/**
 * Reject state-changing API requests sent by another site.
 *
 * The session cookie is SameSite=Lax, which stops most cross-site POSTs, but
 * "site" means the registrable domain: any page on another *.astromind.com
 * host counts as same-site and its POSTs carry our cookie. Route handlers
 * parse bodies with request.json() whatever the Content-Type, so a plain HTML
 * form could drive them. Browsers always send Origin on POST/PUT/DELETE, so
 * requiring it to be ours closes that. Requests without Origin come from
 * non-browser clients, which cannot carry a victim's cookie, and are let
 * through to the normal session check.
 */
export function isCrossOriginWrite(req: { method: string; headers: Headers; nextUrl: URL }): boolean {
  if (SAFE_METHODS.has(req.method)) return false;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const expected = process.env.AUTH_URL
    ? new URL(process.env.AUTH_URL).origin
    : req.nextUrl.origin;
  return origin !== expected;
}
