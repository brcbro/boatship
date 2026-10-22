import assert from "node:assert/strict";
import test from "node:test";
import { isCrossOriginCookieMutation } from "../lib/request-origin.ts";

const cookie = "boatship_session=example";
const req = (method, headers = {}, url = "https://boatship.example/api/tasks") =>
  new Request(url, { method, headers });

test("blocks cross-site and sibling-origin cookie mutations", () => {
  assert.equal(isCrossOriginCookieMutation(req("POST", { cookie, origin: "https://evil.example" }), "boatship_session"), true);
  assert.equal(isCrossOriginCookieMutation(req("PATCH", { cookie, origin: "https://other.boatship.example", "sec-fetch-site": "same-site" }), "boatship_session"), true);
});

test("allows same-origin browser mutations and bearer-only clients", () => {
  assert.equal(isCrossOriginCookieMutation(req("POST", { cookie, origin: "https://boatship.example", "sec-fetch-site": "same-origin" }), "boatship_session"), false);
  assert.equal(isCrossOriginCookieMutation(req("POST", { authorization: "Bearer example" }), "boatship_session"), false);
});

test("rejects missing origin for cookie mutations, but leaves safe reads alone", () => {
  assert.equal(isCrossOriginCookieMutation(req("POST", { cookie }), "boatship_session"), true);
  assert.equal(isCrossOriginCookieMutation(req("GET", { cookie }), "boatship_session"), false);
});

test("development canonical localhost URLs retain exact loopback browser origin checks", () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "development";
    const headers = { cookie, origin: "http://127.0.0.1:3100", host: "127.0.0.1:3100", "sec-fetch-site": "same-origin" };
    assert.equal(isCrossOriginCookieMutation(req("POST", headers, "http://localhost:3100/api/auth/logout"), "boatship_session"), false);
    assert.equal(isCrossOriginCookieMutation(req("POST", { ...headers, origin: "http://127.0.0.1:3200" }, "http://localhost:3100/api/auth/logout"), "boatship_session"), true);
    assert.equal(isCrossOriginCookieMutation(req("POST", { ...headers, host: "evil.example", origin: "http://evil.example" }, "http://localhost:3100/api/auth/logout"), "boatship_session"), true);
    assert.equal(isCrossOriginCookieMutation(req("POST", { ...headers, "sec-fetch-site": "cross-site" }, "http://localhost:3100/api/auth/logout"), "boatship_session"), true);
    process.env.NODE_ENV = "production";
    assert.equal(isCrossOriginCookieMutation(req("POST", headers, "http://localhost:3100/api/auth/logout"), "boatship_session"), true);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
