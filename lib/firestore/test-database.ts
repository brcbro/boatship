/**
 * Guard for the suites that create and drop tables (`npm run test:postgres`,
 * `npm run test:e2e:postgres`). They read `TEST_DATABASE_URL`, never the
 * application's `DATABASE_URL`, and refuse any host other than this machine
 * unless `QA_ALLOW_REMOTE_DATABASE=1` is set explicitly for that run.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function assertTestDatabaseTarget(url: string, env: Record<string, string | undefined> = process.env): void {
  let host: string;
  try { host = new URL(url).hostname.toLowerCase(); } catch { throw new Error("The test database URL is not a valid postgresql:// URL."); }
  if (!host) throw new Error("The test database URL has no host.");
  if (LOCAL_HOSTS.has(host) || env.QA_ALLOW_REMOTE_DATABASE === "1") return;
  // Only the hostname is printed; the URL carries the password.
  throw new Error(`Refusing to create and drop test tables on ${host}. Point TEST_DATABASE_URL at a local PostgreSQL, or set QA_ALLOW_REMOTE_DATABASE=1 for a disposable remote database.`);
}

/** The guarded `TEST_DATABASE_URL`, or null when the PostgreSQL legs should be skipped. */
export function testDatabaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  const url = env.TEST_DATABASE_URL?.trim();
  if (!url) return null;
  assertTestDatabaseTarget(url, env);
  return url;
}
