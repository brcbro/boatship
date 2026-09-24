console.error(
  "The local-store importer is retired. It could replace a populated snapshot " +
    "and copy fixed demo credentials into a hosted database. Keep demo data " +
    "in ALLOW_LOCAL_STORE mode; use a reviewed, version-aware migration for real data."
);
process.exitCode = 1;
