/**
 * Response headers applied to every route through `headers()` in next.config.ts.
 *
 * script-src keeps 'unsafe-inline': App Router streams its RSC payload through
 * inline <script> tags, and the root layout's theme-init script runs before
 * paint. A hash cannot cover the per-request payload scripts (and a hash makes
 * browsers ignore 'unsafe-inline'), while nonces would force every page into
 * dynamic rendering. External script hosts stay blocked. img-src excludes
 * remote hosts so rendered markdown cannot exfiltrate data through image URLs.
 */
export function contentSecurityPolicy(isDev: boolean): string {
  const directives = [
    "default-src 'self'",
    // React uses eval for dev-only stack reconstruction; production does not.
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // Realtime messages use a same-origin WebSocket; dev HMR uses ws: on localhost.
    `connect-src 'self' wss:${isDev ? " ws:" : ""}`,
    // Document previews render blob: URLs; published form templates embed Google Forms.
    "frame-src 'self' blob: https://docs.google.com",
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  // No upgrade-insecure-requests: `npm run preview` serves a production build
  // over http://localhost, and HSTS already keeps deployed hosts on HTTPS.
  return directives.join("; ");
}

export function securityHeaders(isDev: boolean): Array<{ key: string; value: string }> {
  const headers = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(isDev) },
    { key: "X-Frame-Options", value: "DENY" },
    // Reset and invite tokens travel in URLs; never leak them to other origins.
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  ];
  // Browsers ignore HSTS over plain HTTP, so local previews are unaffected.
  if (!isDev) headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
  return headers;
}
