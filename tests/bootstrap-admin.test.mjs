import test from "node:test";
import assert from "node:assert/strict";
import {
  assertFirstAdminEligible,
  checkedDatabaseHost,
  normalizeBootstrapInput,
} from "../scripts/lib/bootstrap-admin.mjs";

test("bootstrap accepts a new administrator with a strong password", () => {
  const input = normalizeBootstrapInput({
    email: "  OWNER@EXAMPLE.COM ",
    name: "Owner",
    password: "a-long-unique-passphrase",
  });
  assert.equal(input.email, "owner@example.com");
  assert.doesNotThrow(() => assertFirstAdminEligible({ users: [] }, [], input.email));
});

test("bootstrap rejects a second administrator in either storage layer", () => {
  assert.throws(() => assertFirstAdminEligible({ users: [{ role: "admin" }] }, [], "new@example.com"), /already exists/);
  assert.throws(() => assertFirstAdminEligible({ users: [] }, [{ role: "admin" }], "new@example.com"), /already exists/);
});

test("bootstrap refuses to promote an existing identity", () => {
  assert.throws(() => assertFirstAdminEligible({ users: [{ role: "team", email: "A@EXAMPLE.COM" }] }, [], "a@example.com"), /already belongs/);
  assert.throws(() => assertFirstAdminEligible({ users: [] }, [{ role: "client", email: "a@example.com" }], "a@example.com"), /already belongs/);
});

test("bootstrap rejects weak credentials and the wrong database host", () => {
  assert.throws(() => normalizeBootstrapInput({ email: "owner@example.com", name: "Owner", password: "admin123" }), /16/);
  assert.throws(() => checkedDatabaseHost("postgresql://user:pass@staging.example/db", "production.example"), /does not match/);
  assert.equal(checkedDatabaseHost("postgresql://user:pass@staging.example/db", "staging.example"), "staging.example");
});
