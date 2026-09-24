console.error("This legacy command is retired because it could overwrite concurrent data and promote every user. Use scripts/provision-first-admin.mjs for a new environment or authenticated account management for existing users.");
process.exitCode = 1;
