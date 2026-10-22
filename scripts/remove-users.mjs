import { config } from "dotenv";
import { getFirestore, serviceAccountProjectId } from "./lib/firestore-cli.mjs";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const requestedEmails = String(process.env.BOATSHIP_REMOVE_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
if (!requestedEmails.length) throw new Error("BOATSHIP_REMOVE_EMAILS is required");

const projectId = process.env.FIRESTORE_EMULATOR_HOST ? "emulator" : serviceAccountProjectId();
const firestore = getFirestore();

const removed = await firestore.runTransaction(async (tx) => {
  const [meta, usersSlice, notificationsSlice] = await Promise.all([
    tx.get("StoreSnapshot", "main"), tx.get("StoreSnapshot", "main:users"), tx.get("StoreSnapshot", "main:notifications"),
  ]);
  if (!meta) throw new Error("StoreSnapshot(main) does not exist");
  const users = usersSlice ? JSON.parse(usersSlice.data.json) : [];
  const profiles = (await tx.query({ collection: "UserProfile" })).map((doc) => ({ ...doc.data, uid: doc.id }));
  const known = new Map();
  for (const user of [...users, ...profiles]) known.set(String(user.email || "").toLowerCase(), user);
  const missing = requestedEmails.filter((email) => !known.has(email));
  if (missing.length) throw new Error(`No account found for: ${missing.join(", ")}`);
  const targets = requestedEmails.map((email) => known.get(email));
  const targetIds = new Set(targets.map((user) => user.uid));
  const version = meta.data.version + 1;
  tx.write({ set: { collection: "StoreSnapshot", id: "main:users", data: { json: JSON.stringify(users.filter((user) => !targetIds.has(user.uid))), version } } });
  if (notificationsSlice) {
    const notifications = JSON.parse(notificationsSlice.data.json).filter((item) => !targetIds.has(item.userId));
    tx.write({ set: { collection: "StoreSnapshot", id: "main:notifications", data: { json: JSON.stringify(notifications), version } } });
  }
  tx.write({ set: { collection: "StoreSnapshot", id: "main", data: { version, updatedAt: new Date().toISOString() } } });
  for (const uid of targetIds) tx.write({ delete: { collection: "UserProfile", id: uid } });
  return targets;
});

// Sessions and notification records are separate collections; remove them after the snapshot commit.
for (const user of removed) {
  for (const collection of ["AuthSession", "NotificationRecord"]) {
    const docs = await firestore.query({ collection, where: [{ field: "userId", op: "==", value: user.uid }] });
    if (docs.length) await firestore.commit(docs.map((doc) => ({ delete: { collection, id: doc.id } })));
  }
  console.log(`Removed ${user.name} <${user.email}> from ${projectId}`);
}
