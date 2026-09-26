import assert from "node:assert/strict";
import test from "node:test";
import { providerSyncConfig } from "../lib/git-provider-sync.ts";

test("sync accepts only configured Git token references and fixed provider hosts", () => {
  const env = { BOATSHIP_GIT_TOKEN_TEST: "secret", DATABASE_URL: "private" };
  assert.equal(providerSyncConfig("github", "owner", "repo", "DATABASE_URL", env), null);
  assert.equal(providerSyncConfig("github", "owner", "repo", "BOATSHIP_GIT_TOKEN_MISSING", env), null);
  const github = providerSyncConfig("github", "owner", "repo", "BOATSHIP_GIT_TOKEN_TEST", env);
  assert.equal(github?.url, "https://api.github.com/repos/owner/repo");
  const gitlab = providerSyncConfig("gitlab", "group", "repo", "BOATSHIP_GIT_TOKEN_TEST", env);
  assert.equal(gitlab?.url, "https://gitlab.com/api/v4/projects/group%2Frepo");
});
