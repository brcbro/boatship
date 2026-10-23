import { handleApi, jsonError } from "@/lib/api";
import { accountStatus } from "@/lib/account-status";
import { describeCapabilities, type AccessGroup } from "@/lib/account-access";
import { requireSession } from "@/lib/auth";
import { PRODUCTS, PRODUCT_MEMBERS } from "@/lib/products";
import { effectiveStaffPermissions } from "@/lib/rbac";
import { getStore } from "@/lib/store";
import type { AccountStatus, StaffPermission, UserRole } from "@/types";

export const runtime = "nodejs";

const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };

export type AccessSummary = {
  role: UserRole;
  status: AccountStatus;
  /** Team users: whether their capability list is explicit (true), or the role default (false). Null for other roles. */
  permissionsExplicit: boolean | null;
  capabilities: AccessGroup[];
  effective: StaffPermission[];
  /** Team users only: the clients currently assigned to them. */
  assignedClients: Array<{ id: string; name: string; companyName: string }> | null;
  /** Staff only: product memberships held in their own right. */
  products: Array<{ id: string; name: string; role: string }> | null;
  /** Client users only: their own organization. */
  organization: { id: string; name: string; companyName: string; assignedTeamMemberName: string | null } | null;
};

/**
 * The signed-in person's effective access, explained. Reads only what the
 * person is entitled to see: their own profile, the clients assigned to them,
 * their own product memberships, or their own organization. It never loads
 * the general client list for team users and grants nothing.
 */
export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const store = await getStore();
    const user = await store.getUser(session.uid);
    if (!user) throw jsonError("User not found", 404);

    const summary: AccessSummary = {
      role: user.role,
      status: accountStatus(user),
      permissionsExplicit: null,
      capabilities: [],
      effective: [],
      assignedClients: null,
      products: null,
      organization: null,
    };

    if (user.role === "client") {
      const client = user.clientId ? await store.getClient(user.clientId) : null;
      if (client) {
        const contact = client.assignedTeamMemberId ? await store.getUser(client.assignedTeamMemberId) : null;
        summary.organization = { id: client.id, name: client.name, companyName: client.companyName, assignedTeamMemberName: contact?.name ?? null };
      }
      return { access: summary };
    }

    const effective = effectiveStaffPermissions(user);
    summary.effective = effective;
    summary.capabilities = describeCapabilities(effective);
    summary.permissionsExplicit = user.role === "team" ? Array.isArray(user.permissions) : null;

    if (user.role === "team") {
      const assigned = await store.listClients({ assignedTeamMemberId: user.uid });
      summary.assignedClients = assigned.map((client) => ({ id: client.id, name: client.name, companyName: client.companyName }));
    }

    const memberships = await PRODUCT_MEMBERS.find([{ field: "userId", op: "==", value: user.uid }]);
    const products = await PRODUCTS.getMany(memberships.map((member) => member.productId));
    const names = new Map(products.map((product) => [product.id, product.name]));
    summary.products = memberships
      .filter((member) => names.has(member.productId))
      .map((member) => ({ id: member.productId, name: names.get(member.productId)!, role: member.role }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { access: summary };
  }, NO_STORE);
}
