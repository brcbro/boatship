import {
  BarChart3,
  BellRing,
  Bot,
  Boxes,
  CalendarDays,
  ClipboardCheck,
  FileText,
  FolderKanban,
  Gauge,
  Inbox,
  KeyRound,
  LayoutDashboard,
  ListTodo,
  MessageSquare,
  Plug,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  UsersRound,
  WalletCards,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { hasPermission } from "@/lib/rbac";
import type { AuthSession, StaffPermission } from "@/types";

export type NavItem = { href: string; label: string; icon: LucideIcon; adminOnly?: boolean; permission?: StaffPermission; description?: string };
export type NavGroup = { label: string; items: readonly NavItem[] };

/*
 * Each item's `permission` (and `adminOnly`) matches what the API behind the
 * page demands: `staffRequestPermissionRules` in lib/rbac.ts and the routes'
 * own role checks. A team member is not offered a page whose requests return
 * 403. Today and Inbox stay visible as the landing pages.
 */

/** Primary rail: the screens staff open every day. */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Work",
    items: [
      { href: "/dashboard", label: "Today", icon: LayoutDashboard },
      { href: "/tasks", label: "Inbox", icon: Inbox },
      { href: "/messages", label: "Messages", icon: MessageSquare, permission: "clients.view" },
      { href: "/calendar", label: "Calendar", icon: CalendarDays, permission: "clients.view" },
      { href: "/clients", label: "Clients", icon: Users, permission: "clients.view" },
      { href: "/projects", label: "Projects", icon: FolderKanban, permission: "clients.view" },
    ],
  },
  {
    label: "Operate",
    items: [
      { href: "/products", label: "Products", icon: Boxes },
      { href: "/team", label: "Team", icon: UsersRound },
      { href: "/workload", label: "Workload", icon: Gauge, permission: "clients.view" },
      { href: "/analytics", label: "Analytics", icon: BarChart3, permission: "analytics.view" },
      { href: "/accounting", label: "Accounting", icon: WalletCards, adminOnly: true },
    ],
  },
  {
    label: "Hodi",
    items: [
      { href: "/agent", label: "Assistant", icon: Bot, permission: "clients.view" },
      { href: "/hodi", label: "Work queue", icon: ListTodo, permission: "clients.view" },
    ],
  },
] as const;

/** Everything configured occasionally lives under Settings. */
export const SETTINGS_ITEMS: readonly NavItem[] = [
  { href: "/settings", label: "Overview", icon: Settings2, description: "Everything you can configure, in one place." },
  { href: "/account", label: "Account", icon: UserRound, description: "Your profile, password and appearance." },
  { href: "/workspace", label: "Workspace policies", icon: UsersRound, permission: "clients.view", description: "Defaults and rules that apply to every client." },
  { href: "/templates", label: "Service templates", icon: ClipboardCheck, description: "Reusable engagement and task templates." },
  { href: "/forms", label: "Forms", icon: FileText, description: "Form definitions clients fill in." },
  { href: "/reminders", label: "Reminders", icon: BellRing, permission: "clients.view", description: "Scan for overdue work and send nudges." },
  { href: "/automations", label: "Automations", icon: Sparkles, permission: "clients.view", description: "Rules Hodi runs on your behalf." },
  { href: "/integrations", label: "Integrations", icon: Plug, permission: "integrations.manage", description: "Connected apps and delivery jobs." },
  { href: "/webhooks", label: "Webhooks", icon: Webhook, adminOnly: true, permission: "webhooks.manage", description: "Outbound events for other systems." },
  { href: "/mcp", label: "MCP access", icon: KeyRound, description: "Keys for agents and tools that call Boatship." },
  { href: "/compliance", label: "Compliance", icon: ShieldCheck, permission: "audit.export", description: "Audit trail and retention controls." },
] as const;

export const SETTINGS_PATHS = SETTINGS_ITEMS.map((item) => item.href);

/** Whether this session may open a nav item. AdminShell, the settings hub and the command palette share it. */
export function canOpenNavItem(item: NavItem, session: AuthSession | null) {
  if (item.adminOnly && session?.role !== "admin") return false;
  return !item.permission || (!!session && hasPermission(session, item.permission));
}

export function visibleNavItems(items: readonly NavItem[], session: AuthSession | null) {
  return items.filter((item) => canOpenNavItem(item, session));
}

export function isActivePath(pathname: string, href: string) {
  if (href === "/dashboard" || href === "/settings") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isSettingsPath(pathname: string) {
  return SETTINGS_PATHS.some((href) => isActivePath(pathname, href));
}
