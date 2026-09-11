/** Convert a Google Forms view URL into an embeddable URL when possible. */
export function toGoogleFormEmbedUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase();
    // Short links can't be rewritten client-side without resolving redirect
    if (host === "forms.gle" || host.endsWith(".forms.gle")) {
      return trimmed;
    }
    if (!host.includes("docs.google.com") || !u.pathname.includes("/forms/")) {
      return trimmed;
    }
    if (u.searchParams.get("embedded") === "true") return u.toString();
    if (u.pathname.includes("/viewform")) {
      u.searchParams.set("embedded", "true");
      return u.toString();
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}

export function isGoogleFormsUrl(url: string) {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.toLowerCase();
    if (host === "forms.gle" || host.endsWith(".forms.gle")) return true;
    return host.includes("docs.google.com") && u.pathname.includes("/forms/");
  } catch {
    return false;
  }
}
