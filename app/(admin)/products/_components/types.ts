export type ProductType = "internal_tool" | "saas" | "other";
export type ProductStage = "idea" | "building" | "beta" | "live" | "paused" | "retired";

export type Product = {
  id: string;
  name: string;
  slug: string;
  type: ProductType;
  stage: ProductStage;
  description: string | null;
  ownerId: string | null;
  ownerName?: string | null;
  visibility: string;
  websiteUrl: string | null;
  openWorkCount?: number;
  nextMilestone?: { id: string; title: string; targetDate: string | null } | null;
  currentRelease?: { version: string; status: string; releasedAt: string | null } | null;
};

export type ProductMember = { id: string; userId: string; role: "owner" | "editor" | "viewer"; user?: { uid: string; name: string; email: string } | null; name?: string; email?: string };
export type ProductMilestone = { id: string; title: string; description: string | null; targetDate: string | null; status: string; ownerId: string | null };
export type ProductWorkItem = { id: string; title: string; description: string | null; status: string; priority: string; milestoneId: string | null; assigneeId: string | null; dueDate: string | null };
export type ProductRelease = { id: string; version: string; environment: string; status: string; releasedAt: string | null; notes: string | null; deploymentUrl: string | null; commitSha: string | null; repositoryId: string | null; workItemIds: string[]; repository?: { id: string; name: string; provider: string; owner: string; repository: string } | null };
export type ProductActivity = { id: string; productId: string; actorId: string; actorName: string; action: string; metadata: Record<string, unknown> | null; createdAt: string };
export type ProductDetail = { product: Product; members: ProductMember[]; milestones: ProductMilestone[]; workItems: ProductWorkItem[]; releases: ProductRelease[]; activities: ProductActivity[]; currentUserRole?: "owner" | "editor" | "viewer" | null };

export const TYPE_OPTIONS: { value: ProductType; label: string }[] = [
  { value: "internal_tool", label: "Internal tool" },
  { value: "saas", label: "SaaS" },
  { value: "other", label: "Other product" },
];
export const STAGE_OPTIONS: { value: ProductStage; label: string }[] = [
  { value: "idea", label: "Idea" },
  { value: "building", label: "Building" },
  { value: "beta", label: "Beta" },
  { value: "live", label: "Live" },
  { value: "paused", label: "Paused" },
  { value: "retired", label: "Retired" },
];
export function label(value: string) { return value.replaceAll("_", " ").replace(/^\w/, (char) => char.toUpperCase()); }
export function dateLabel(value?: string | null) { return value ? new Date(value).toLocaleDateString() : "No date"; }
