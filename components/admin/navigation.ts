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
import type { StaffPermission } from "@/types";

export type NavItem = { href: string; label: string; icon: LucideIcon; adminOnly?: boolean; permission?: StaffPermission; description?: string };
export type NavGroup = { label: string; items: readonly NavItem[] };

/** Primary rail: the screens staff open every day. */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Work",
    items: [
      { href: "/dashboard", label: "Today", icon: LayoutDashboard },
      { href: "/tasks", label: "Inbox", icon: Inbox },
      { href: "/messages", label: "Messages", icon: MessageSquare },
      { href: "/calendar", label: "Calendar", icon: CalendarDays },
      { href: "/clients", label: "Clients", icon: Users },
      { href: "/projects", label: "Projects", icon: FolderKanban },
    ],
  },
  {
    label: "Operate",
    items: [
      { href: "/products", label: "Products", icon: Boxes },
      { href: "/team", label: "Team", icon: UsersRound },
      { href: "/workload", label: "Workload", icon: Gauge },
      { href: "/analytics", label: "Analytics", icon: BarChart3, permission: "analytics.view" },
      { href: "/accounting", label: "Accounting", icon: WalletCards, adminOnly: true },
    ],
  },
  {
    label: "Hodi",
    items: [
      { href: "/agent", label: "Assistant", icon: Bot },
      { href: "/hodi", label: "Work queue", icon: ListTodo },
    ],
  },
] as const;

/** Everything configured occasionally lives under Settings. */
export const SETTINGS_ITEMS: readonly NavItem[] = [
  { href: "/settings", label: "Overview", icon: Settings2, description: "Everything you can configure, in one place." },
  { href: "/account", label: "Account", icon: UserRound, description: "Your profile, password and appearance." },
  { href: "/workspace", label: "Workspace policies", icon: UsersRound, description: "Defaults and rules that apply to every client." },
  { href: "/templates", label: "Service templates", icon: ClipboardCheck, description: "Reusable engagement and task templates." },
  { href: "/forms", label: "Forms", icon: FileText, description: "Form definitions clients fill in." },
  { href: "/reminders", label: "Reminders", icon: BellRing, description: "Scan for overdue work and send nudges." },
  { href: "/automations", label: "Automations", icon: Sparkles, description: "Rules Hodi runs on your behalf." },
  { href: "/integrations", label: "Integrations", icon: Plug, description: "Connected apps and delivery jobs." },
  { href: "/webhooks", label: "Webhooks", icon: Webhook, adminOnly: true, description: "Outbound events for other systems." },
  { href: "/mcp", label: "MCP access", icon: KeyRound, description: "Keys for agents and tools that call Boatship." },
  { href: "/compliance", label: "Compliance", icon: ShieldCheck, description: "Audit trail and retention controls." },
] as const;

export const SETTINGS_PATHS = SETTINGS_ITEMS.map((item) => item.href);

export function isActivePath(pathname: string, href: string) {
  if (href === "/dashboard" || href === "/settings") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isSettingsPath(pathname: string) {
  return SETTINGS_PATHS.some((href) => isActivePath(pathname, href));
}
