export type ProductType = "internal_tool" | "saas" | "other";
export type ProductStage = "idea" | "building" | "beta" | "live" | "paused" | "retired";
export type ProductMemberRole = "owner" | "editor" | "viewer";
export type ProductMilestoneStatus = "planned" | "in_progress" | "done" | "cancelled";
export type ProductWorkStatus = "todo" | "in_progress" | "blocked" | "done" | "cancelled";
export type ProductPriority = "low" | "medium" | "high" | "urgent";
export type ProductReleaseStatus = "planned" | "deploying" | "released" | "failed" | "rolled_back";

export type ProductSummary = {
  id: string;
  name: string;
  description: string;
  slug: string;
  type: ProductType;
  stage: ProductStage;
  ownerId: string;
  ownerName: string;
  openWorkCount: number;
  nextMilestone: { id: string; title: string; targetDate: string | null } | null;
  currentRelease: { id: string; version: string; status: string; releasedAt: string | null } | null;
};
