import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

type CsvRow = Record<string, string>;

function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    // skip empty trailing lines
    if (row.length === 1 && row[0] === "" && rows.length === 0) {
      row = [];
      return;
    }
    if (row.every((c) => c.trim() === "") && rows.length > 0) {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };

  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    const next = src[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      pushField();
      continue;
    }
    if (ch === "\n") {
      pushField();
      pushRow();
      continue;
    }
    if (ch === "\r") {
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }

  if (!rows.length) return { headers: [], rows: [] };

  const headers = rows[0]!.map((h) => h.trim());
  const dataRows: CsvRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]!;
    const obj: CsvRow = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]!] = (cells[c] ?? "").trim();
    }
    dataRows.push(obj);
  }
  return { headers, rows: dataRows };
}

function headerLookup(headers: string[], ...aliases: string[]) {
  const lower = headers.map((h) => h.toLowerCase().replace(/[\s_]+/g, ""));
  for (const alias of aliases) {
    const key = alias.toLowerCase().replace(/[\s_]+/g, "");
    const idx = lower.indexOf(key);
    if (idx >= 0) return headers[idx]!;
  }
  return null;
}

async function readCsvBody(req: Request): Promise<string> {
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file") ?? form.get("csv") ?? form.get("upload");
    if (typeof file === "string") return file;
    if (file && typeof file === "object" && "text" in file) {
      return await (file as File).text();
    }
    throw jsonError("multipart body must include file or csv field", 400);
  }

  if (contentType.includes("text/csv") || contentType.includes("text/plain")) {
    return await req.text();
  }

  const body = (await req.json().catch(() => ({}))) as { csv?: string };
  if (typeof body.csv === "string") return body.csv;
  throw jsonError("Provide { csv: string } or multipart/text CSV body", 400);
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const csvText = await readCsvBody(req);
    if (!csvText.trim()) throw jsonError("CSV is empty", 400);

    const { headers, rows } = parseCsv(csvText);
    if (!headers.length) throw jsonError("CSV has no header row", 400);

    const nameKey = headerLookup(headers, "name");
    const companyKey = headerLookup(headers, "companyName", "company");
    const emailKey = headerLookup(headers, "primaryContactEmail", "email");
    const tagsKey = headerLookup(headers, "tags");
    const imoKey = headerLookup(headers, "imo", "vesselImo", "vesselimo");
    const flagKey = headerLookup(headers, "flag");

    if (!nameKey || !companyKey || !emailKey) {
      throw jsonError(
        "CSV must include name, companyName, and primaryContactEmail columns",
        400
      );
    }

    const store = await getStore();
    let created = 0;
    const errors: { row: number; error: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const rowNum = i + 2; // 1-indexed + header
      try {
        const name = (row[nameKey] || "").trim();
        const companyName = (row[companyKey] || "").trim();
        const primaryContactEmail = (row[emailKey] || "").trim().toLowerCase();
        if (!name || !companyName || !primaryContactEmail) {
          throw new Error("name, companyName, and primaryContactEmail are required");
        }

        const tags =
          tagsKey && row[tagsKey]
            ? row[tagsKey]!
                .split(/[,|;]/)
                .map((t) => t.trim())
                .filter(Boolean)
            : [];

        const customFields: Record<string, string> = {};
        if (imoKey && row[imoKey]) customFields["Vessel IMO"] = row[imoKey]!;
        if (flagKey && row[flagKey]) customFields.Flag = row[flagKey]!;

        const client = await store.createClient({
          name,
          companyName,
          primaryContactEmail,
          assignedTeamMemberId: session.uid,
          templateId: "seed_standard",
          tags,
          customFields,
          pipelineStage: "intake",
        });

        const tasks = await store.generateTasksFromTemplate(
          client.id,
          "seed_standard",
          client.assignedTeamMemberId
        );

        await store.addActivity({
          clientId: client.id,
          actorId: session.uid,
          actorName: session.name,
          action: "client.imported",
          meta: { source: "csv", taskCount: tasks.length },
        });

        created++;
      } catch (err) {
        errors.push({
          row: rowNum,
          error: err instanceof Error ? err.message : "Failed to import row",
        });
      }
    }

    return { created, errors };
  });
}
