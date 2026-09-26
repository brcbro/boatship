export function providerSyncConfig(provider: "github" | "gitlab", owner: string, repository: string, ref: string | null, env: NodeJS.ProcessEnv) {
  if (!ref || !/^BOATSHIP_GIT_TOKEN_[A-Z0-9_]+$/.test(ref) || !env[ref]) return null;
  return {
    token: env[ref],
    url: provider === "github"
      ? `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`
      : `https://gitlab.com/api/v4/projects/${encodeURIComponent(`${owner}/${repository}`)}`,
  };
}
