/**
 * Scheduled jobs call the app in-process through the AppRuntime Durable Object,
 * so the host is never resolved over the network. It still becomes the request
 * origin the routes see, so prefer the configured public origin and otherwise
 * use a reserved internal name rather than a domain someone else may own.
 */
export function internalCronUrl(appUrl: string | undefined, path: string): string {
  let origin = "https://app-runtime.internal";
  try {
    if (appUrl?.trim()) origin = new URL(appUrl.trim()).origin;
  } catch {
    // Fall back to the internal origin when APP_URL is malformed.
  }
  return `${origin}/api/internal/${path}`;
}
