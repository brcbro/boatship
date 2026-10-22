import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { IntegrationJob, IntegrationJobOutcome } from "@/lib/integration-job-policy";

// Local-only queue operations share one mutex per file. Hosted Workers use the
// relational queue; this file path is never selected for a database deployment.
const locks = new Map<string, Promise<void>>();

export class LocalIntegrationJobs {
  private readonly path: string;

  constructor(path: string) { this.path = path; }

  private async mutate<T>(change: (jobs: IntegrationJob[]) => T | Promise<T>): Promise<T> {
    const previous = locks.get(this.path) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    locks.set(this.path, current);
    await previous;
    try {
      const jobs = await this.list();
      const result = await change(jobs);
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      const file = await open(temporary, "wx");
      try {
        await file.writeFile(JSON.stringify(jobs));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, this.path);
      return result;
    } finally {
      release();
      if (locks.get(this.path) === current) locks.delete(this.path);
    }
  }

  async list(): Promise<IntegrationJob[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, "utf8"));
      if (!Array.isArray(parsed)) throw new Error("Invalid local integration queue");
      return parsed as IntegrationJob[];
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  }

  async insert(jobs: IntegrationJob[]): Promise<IntegrationJob[]> {
    return this.mutate((existing) => jobs.map((job) => {
      const duplicate = existing.find((entry) => entry.dedupKey === job.dedupKey);
      if (duplicate) return duplicate;
      existing.push(job);
      return job;
    }));
  }

  async claim(limit: number, now: number, leaseMs: number, maxAttempts: number): Promise<IntegrationJob[]> {
    return this.mutate((jobs) => {
      const ready = jobs.filter((job) =>
        (job.status === "pending" && Date.parse(job.nextAttemptAt) <= now) ||
        (job.status === "processing" && job.leaseUntil !== null && Date.parse(job.leaseUntil) <= now)
      ).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const claimed: IntegrationJob[] = [];
      for (const job of ready) {
        if (job.attempts >= maxAttempts) {
          Object.assign(job, { status: "failed", error: "Delivery could not be confirmed after the last attempt.", leaseToken: null, leaseUntil: null, updatedAt: new Date(now).toISOString() });
          continue;
        }
        if (claimed.length >= limit) continue;
        Object.assign(job, { status: "processing", attempts: job.attempts + 1, leaseToken: randomUUID(), leaseUntil: new Date(now + leaseMs).toISOString(), updatedAt: new Date(now).toISOString() });
        claimed.push({ ...job });
      }
      return claimed;
    });
  }

  async finish(id: string, leaseToken: string, outcome: IntegrationJobOutcome, now: number): Promise<boolean> {
    return this.mutate((jobs) => {
      const job = jobs.find((entry) => entry.id === id && entry.status === "processing" && entry.leaseToken === leaseToken);
      if (!job) return false;
      Object.assign(job, outcome, { leaseUntil: null, leaseToken: null, updatedAt: new Date(now).toISOString() });
      return true;
    });
  }

  async retry(id: string, now: number): Promise<boolean> {
    return this.mutate((jobs) => {
      const job = jobs.find((entry) => entry.id === id && (entry.status === "failed" || entry.status === "skipped"));
      if (!job) return false;
      Object.assign(job, { status: "pending", attempts: 0, nextAttemptAt: new Date(now).toISOString(), leaseToken: null, leaseUntil: null, error: null, result: null, updatedAt: new Date(now).toISOString() });
      return true;
    });
  }
}
