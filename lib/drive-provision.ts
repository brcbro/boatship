import {
  executeTool,
  isComposioConfigured,
  listBoatshipConnections,
} from "@/lib/composio";
import { getStore } from "@/lib/store";
import type { Client } from "@/types";

export type ProvisionedDriveFolder = {
  folderId: string;
  folderUrl: string;
  folderName: string;
};

function digString(obj: unknown, keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  const record = obj as Record<string, unknown>;
  for (const key of keys) {
    const val = record[key];
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") {
      const hit = digString(nested, keys);
      if (hit) return hit;
    }
  }
  return null;
}

function extractFolderInfo(result: unknown): { id: string; url: string } | null {
  const id =
    digString(result, ["id", "folderId", "folder_id", "fileId", "file_id"]) || null;
  if (!id) return null;
  const url =
    digString(result, ["webViewLink", "web_view_link", "alternateLink", "url"]) ||
    `https://drive.google.com/drive/folders/${id}`;
  return { id, url };
}

/** Folder name: `[Boatship] {companyName} — {clientName}` */
export function clientDriveFolderName(client: Pick<Client, "name" | "companyName">) {
  return `[Boatship] ${client.companyName} — ${client.name}`;
}

/**
 * Create a Google Drive folder for a client via Composio when Drive is connected.
 * Soft-fails: returns null (never throws) if Composio/Drive is missing or the tool errors.
 */
export async function provisionClientDriveFolder(
  boatshipUid: string,
  client: Pick<Client, "id" | "name" | "companyName" | "driveFolderId" | "driveFolderUrl">
): Promise<ProvisionedDriveFolder | null> {
  try {
    if (!isComposioConfigured()) return null;
    if (client.driveFolderId) {
      return {
        folderId: client.driveFolderId,
        folderUrl:
          client.driveFolderUrl ||
          `https://drive.google.com/drive/folders/${client.driveFolderId}`,
        folderName: clientDriveFolderName(client),
      };
    }

    const connections = await listBoatshipConnections(boatshipUid);
    const drive = connections.find((c) => c.slug === "googledrive" && c.connected);
    if (!drive) return null;

    const folderName = clientDriveFolderName(client);
    const parentId = process.env.COMPOSIO_DRIVE_PARENT_FOLDER_ID?.trim();
    const args: Record<string, unknown> = { name: folderName };
    if (parentId) args.parent_id = parentId;

    const result = await executeTool({
      boatshipUid,
      toolSlug: "GOOGLEDRIVE_CREATE_FOLDER",
      arguments: args,
    });

    const extracted = extractFolderInfo(result);
    if (!extracted) {
      console.error("[drive-provision] create folder returned no id", result);
      return null;
    }

    const store = await getStore();
    await store.updateClient(client.id, {
      driveFolderId: extracted.id,
      driveFolderUrl: extracted.url,
    });

    return {
      folderId: extracted.id,
      folderUrl: extracted.url,
      folderName,
    };
  } catch (err) {
    console.error("[drive-provision] failed", err);
    return null;
  }
}
