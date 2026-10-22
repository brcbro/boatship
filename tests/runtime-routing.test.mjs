import test from "node:test";
import assert from "node:assert/strict";
import { runtimeShard } from "../lib/runtime-routing.ts";

test("one browser session stays on a bounded shard across routes", () => {
  const headers = { cookie: "boatship_session=opaque-session" };
  assert.equal(runtimeShard(new Request("https://example.test/clients", { headers })), runtimeShard(new Request("https://example.test/documents", { headers })));
  assert.match(runtimeShard(new Request("https://example.test", { headers })), /^app-[0-3]$/);
  const expected = runtimeShard(new Request("https://example.test/clients", { headers }));
  assert.equal(runtimeShard(new Request("https://example.test/documents", { headers: { cookie: "analytics=changed; boatship_session=opaque-session; preference=new" } })), expected);
  assert.equal(runtimeShard(new Request("https://example.test/api", { headers: { authorization: "Bearer opaque-session" } })), expected);
});

test("sessions distribute across runtime instances without exposing tokens", () => {
  const shards = new Set(Array.from({ length: 64 }, (_, index) => runtimeShard(new Request("https://example.test/clients", { headers: { authorization: `Bearer private-${index}` } }))));
  assert.equal(shards.size, 4);
  assert.equal(runtimeShard(new Request("https://example.test/"), 0), runtimeShard(new Request("https://example.test/"), 4));
});
