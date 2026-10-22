import {
  executeTool,
  isComposioConfiguredForUser,
  listBoatshipConnections,
} from "@/lib/composio";
import { getStore } from "@/lib/store";
import type { Client } from "@/types";
import { integrationDriveFolderName, integrationProviderConfirmed, integrationProviderData, integrationProviderItems } from "@/lib/integration-job-policy";

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

/** Include the stable account ID so uncertain creates can be found on retry. */
export function clientDriveFolderName(client: Pick<Client, "id" | "name" | "companyName">) {
  return integrationDriveFolderName(client);
}

/**
 * Create a Google Drive folder for a client via Composio when Drive is connected.
 * Missing connections return null. Provider or persistence failures throw so
 * the durable integration queue can retry rather than report a false success.
 */
export async function provisionClientDriveFolder(
  boatshipUid: string,
  client: Pick<Client, "id" | "name" | "companyName" | "driveFolderId" | "driveFolderUrl">
): Promise<ProvisionedDriveFolder | null> {
  if (!(await isComposioConfiguredForUser(boatshipUid))) return null;
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
  const escapeQuery = (value: string) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const parentQuery = `'${escapeQuery(parentId || "root")}' in parents`;
  const found = await executeTool({
    boatshipUid,
    toolSlug: "GOOGLEDRIVE_FIND_FILE",
    arguments: { q: `mimeType = 'application/vnd.google-apps.folder' and name = '${escapeQuery(folderName)}' and trashed = false and ${parentQuery}`, fields: "id,name,webViewLink", pageSize: 2 },
  });
  if (!integrationProviderConfirmed(found)) throw new Error("Drive folder lookup did not succeed");
  const folders = integrationProviderItems(found, ["files", "items", "results"]);
  if (!folders) throw new Error("Drive folder lookup returned no confirmed result list");
  const matchingFolder = folders.find((folder) => folder.name === folderName);
  const existingFolder = matchingFolder ? extractFolderInfo(matchingFolder) : null;
  if (matchingFolder && !existingFolder) throw new Error("Drive lookup returned a folder without its ID");
  const args: Record<string, unknown> = { name: folderName };
  if (parentId) args.parent_id = parentId;

  const result = existingFolder ? null : await executeTool({
    boatshipUid,
    toolSlug: "GOOGLEDRIVE_CREATE_FOLDER",
    arguments: args,
  });

  if (!existingFolder && !integrationProviderConfirmed(result)) throw new Error("Drive folder creation did not succeed");
  const extracted = existingFolder || extractFolderInfo(integrationProviderData(result));
  if (!extracted) {
    throw new Error("Drive folder creation returned no confirmed folder ID");
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
}
