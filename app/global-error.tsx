"use client";

import { useEffect } from "react";

/*
 * Replaces the root layout when it fails, so globals.css is not loaded. The
 * few Regatta tokens it needs are inlined here, for both themes, and the
 * stored theme choice is applied the same way the root layout does.
 */
const styles = `
:root { color-scheme: light; --background: #f7f5ef; --surface-raised: #ffffff; --border: #dedacd; --ink: #121826; --ink-muted: #5c6170; --ink-faint: #626776; --brand: #1e3fd6; --brand-strong: #1634b8; --on-brand: #ffffff; --focus-ring: #ff5a1f; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { color-scheme: dark; --background: #0f1320; --surface-raised: #161b2c; --border: #283049; --ink: #eef0f7; --ink-muted: #98a0b6; --ink-faint: #8a91ab; --brand: #6f8cff; --brand-strong: #8ba2ff; --on-brand: #0a0e1c; --focus-ring: #ff9068; } }
:root[data-theme="dark"] { color-scheme: dark; --background: #0f1320; --surface-raised: #161b2c; --border: #283049; --ink: #eef0f7; --ink-muted: #98a0b6; --ink-faint: #8a91ab; --brand: #6f8cff; --brand-strong: #8ba2ff; --on-brand: #0a0e1c; --focus-ring: #ff9068; }
body { margin: 0; min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; background: var(--background); color: var(--ink); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
.card { width: 100%; max-width: 28rem; box-sizing: border-box; padding: 24px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface-raised); text-align: center; }
h1 { margin: 0; font-size: 20px; }
p { margin: 8px 0 0; font-size: 14px; line-height: 1.6; color: var(--ink-muted); }
.ref { font-family: ui-monospace, monospace; font-size: 12px; color: var(--ink-faint); }
.actions { margin-top: 20px; display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
button, a { min-height: 44px; padding: 0 16px; border-radius: 10px; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; text-decoration: none; }
button { border: 0; background: var(--brand); color: var(--on-brand); }
button:hover { background: var(--brand-strong); }
a { border: 1px solid var(--border); color: var(--ink); }
button:focus-visible, a:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
`;

const themeInit = `(function(){try{var t=localStorage.getItem("boatship-theme");if(t==="dark"||t==="light"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})();`;

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>Something went wrong | Boatship</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </head>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <main className="card" role="alert">
          <h1>Boatship did not load</h1>
          <p>Something went wrong while starting the app. Try again, or reload the page.</p>
          {error.digest ? <p className="ref">Reference {error.digest}</p> : null}
          <div className="actions">
            <button type="button" onClick={() => retry()}>Try again</button>
            {/* A full page load: the router may be what failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/">Go to home</a>
          </div>
        </main>
      </body>
    </html>
  );
}
