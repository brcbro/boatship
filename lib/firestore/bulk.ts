import { getFirestore } from "./index";
import type { FirestoreClient, Where, Write } from "./types";

const COMMIT_CHUNK = 400;

/** Applies writes in commit-sized chunks; each chunk is atomic, the whole set is not. */
export async function commitInChunks(writes: Write[], client: FirestoreClient = getFirestore()): Promise<void> {
  for (let index = 0; index < writes.length; index += COMMIT_CHUNK) await client.commit(writes.slice(index, index + COMMIT_CHUNK));
}

/** Deletes every document matching the filters; returns how many were removed. */
export async function deleteWhere(collection: string, where: Where[], client: FirestoreClient = getFirestore()): Promise<number> {
  const docs = await client.query({ collection, where });
  await commitInChunks(docs.map((doc) => ({ delete: { collection, id: doc.id } })), client);
  return docs.length;
}

/** Updates every matching document with the same patch; returns the count. */
export async function updateWhere(collection: string, where: Where[], data: Record<string, unknown>, client: FirestoreClient = getFirestore()): Promise<number> {
  const docs = await client.query({ collection, where });
  await commitInChunks(docs.map((doc) => ({ update: { collection, id: doc.id, data: data as Write extends { update: { data: infer D } } ? D : never } })), client);
  return docs.length;
}
