import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { getRedisCacheVersion, withRedisCache } from "@/lib/redis-cache";
import { effectiveStaffPermissions, parseStaffPermissions } from "@/lib/rbac";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    await requireRoles(req, ["admin", "team"]);
    const store = await getStore();
    const cacheVersion = await getRedisCacheVersion();

    return withRedisCache("team-users", cacheVersion, 30, async () => {
      const users = await store.listUsers();
      const team = users
        .filter((u) => u.role === "admin" || u.role === "team")
        .map((u) => ({
          uid: u.uid,
          email: u.email,
          name: u.name,
          role: u.role,
          permissions: u.permissions,
          effectivePermissions: effectiveStaffPermissions(u),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      return { users: team };
    });
  });
}

/** Update team member permissions (admin only). */
export async function PATCH(req: Request) {
  return handleApi(async () => {
    await requireRoles(req, ["admin"]);
    const body = (await req.json().catch(() => ({}))) as {
      uid?: string;
      permissions?: unknown;
    };

    const uid = (body.uid || "").trim();
    if (!uid) throw jsonError("uid is required", 400);
    let permissions;
    try { permissions = parseStaffPermissions(body.permissions); }
    catch { throw jsonError("permissions must be an array of known staff permissions", 400); }

    const store = await getStore();
    const user = await store.getUser(uid);
    if (!user) throw jsonError("User not found", 404);
    if (user.role !== "admin" && user.role !== "team") {
      throw jsonError("Can only update staff permissions", 400);
    }

    const updated = await store.upsertUser({
      ...user,
      permissions,
    });

    return {
      user: {
        uid: updated.uid,
        email: updated.email,
        name: updated.name,
        role: updated.role,
        permissions: updated.permissions,
        effectivePermissions: effectiveStaffPermissions(updated),
      },
    };
  });
}
