import { createHash } from "node:crypto";

/**
 * Pure planning for `scripts/backfill-account-foundations.mjs`, kept separate
 * so the unit suite can exercise it without a database.
 *
 * Input: every UserProfile document ({ ...data, uid: id }) and every existing
 * IdentityEmailClaim document ({ ...data, id }).
 *
 * Output: the writes that bring records written before 2026-10-23 up to the
 * account foundations (explicit status, authz version, email claim) and the
 * problems that stop the backfill. The planner never guesses: a duplicate
 * address, a claim that points at another user, or a user whose status cannot
 * be derived is reported, and `apply` refuses while any problem exists.
 */
export function emailClaimId(email) {
  return createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex");
}

export function deriveStatus(profile) {
  if (profile.status) return profile.status;
  if (profile.mustResetPassword && !profile.passwordHash && !profile.password) return "invited";
  return "active";
}

export function planAccountBackfill({ profiles, claims }) {
  const problems = [];
  const writes = [];
  const summary = { profiles: profiles.length, statusAdded: 0, versionAdded: 0, claimsAdded: 0, legacyLinks: 0, duplicateEmails: 0, missingEmails: 0 };
  const stamp = new Date().toISOString();

  const byEmail = new Map();
  for (const profile of profiles) {
    const email = String(profile.email || "").trim().toLowerCase();
    if (!email) { summary.missingEmails += 1; problems.push({ uid: profile.uid, problem: "profile has no email" }); continue; }
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email).push(profile);
  }
  const claimById = new Map(claims.map((claim) => [claim.id, claim]));

  for (const [email, owners] of byEmail) {
    if (owners.length > 1) {
      summary.duplicateEmails += 1;
      problems.push({ email, problem: `address owned by ${owners.length} profiles: ${owners.map((owner) => owner.uid).join(", ")}` });
      continue;
    }
    const [profile] = owners;
    const patch = {};
    if (!["invited", "active", "suspended", "deactivated"].includes(profile.status)) {
      if (profile.status !== undefined) { problems.push({ uid: profile.uid, problem: `unknown status ${JSON.stringify(profile.status)}` }); continue; }
      patch.status = deriveStatus(profile);
      patch.statusChangedAt = profile.statusChangedAt ?? null;
      patch.statusReason = profile.statusReason ?? null;
      summary.statusAdded += 1;
    }
    if (!Number.isSafeInteger(profile.authzVersion)) { patch.authzVersion = 0; summary.versionAdded += 1; }
    if (profile.inviteToken) summary.legacyLinks += 1;
    if (Object.keys(patch).length) {
      patch.updatedAt = profile.updatedAt ?? stamp;
      writes.push({ update: { collection: "UserProfile", id: profile.uid, data: patch, precondition: { exists: true } } });
    }
    const claimId = emailClaimId(email);
    const claim = claimById.get(claimId);
    if (!claim) {
      writes.push({ set: { collection: "IdentityEmailClaim", id: claimId, data: { email, userId: profile.uid, createdAt: stamp, updatedAt: stamp }, precondition: { exists: false } } });
      summary.claimsAdded += 1;
    } else if (claim.userId !== profile.uid) {
      problems.push({ email, problem: `claim belongs to ${claim.userId} but the profile is ${profile.uid}` });
    }
  }

  for (const claim of claims) {
    const owner = profiles.find((profile) => profile.uid === claim.userId);
    if (!owner) problems.push({ email: claim.email, problem: `claim points at missing user ${claim.userId}` });
  }

  return { writes, problems, summary };
}
