export function normalizeBootstrapInput({ email, name, password }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedName = String(name || "").trim();
  const rawPassword = String(password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error("A valid BOATSHIP_ADMIN_EMAIL is required");
  }
  if (normalizedName.length < 2 || normalizedName.length > 120) {
    throw new Error("BOATSHIP_ADMIN_NAME must be 2–120 characters");
  }
  if (rawPassword.length < 16 || rawPassword.length > 1024) {
    throw new Error("BOATSHIP_ADMIN_PASSWORD must be 16–1024 characters");
  }
  if (["admin123", "team123"].includes(rawPassword.toLowerCase())) {
    throw new Error("Demo passwords are not allowed");
  }
  return { email: normalizedEmail, name: normalizedName, password: rawPassword };
}

export function assertFirstAdminEligible(snapshotData, profiles, email) {
  const users = snapshotData?.users ?? [];
  if (!Array.isArray(users)) throw new Error("Snapshot users must be an array");
  if (users.some((user) => user?.role === "admin") || profiles.some((user) => user?.role === "admin")) {
    throw new Error("An administrator already exists; first-admin provisioning is closed");
  }
  if (
    users.some((user) => String(user?.email || "").trim().toLowerCase() === email) ||
    profiles.some((user) => String(user?.email || "").trim().toLowerCase() === email)
  ) {
    throw new Error("That email already belongs to a user; do not promote an existing user with this command");
  }
}

export function checkedDatabaseHost(connectionString, expectedHost) {
  if (!expectedHost) throw new Error("--expect-host is required");
  const url = new URL(connectionString);
  if (!/^postgres(?:ql)?:$/.test(url.protocol)) throw new Error("DIRECT_URL must be PostgreSQL");
  if (url.hostname.toLowerCase() !== expectedHost.toLowerCase()) {
    throw new Error("DIRECT_URL host does not match --expect-host");
  }
  return url.hostname;
}
