import fs from "node:fs";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";

// OpenNext's traced dependency copier creates directory symlinks without a
// Windows type. Junctions preserve link discovery without elevated privileges.
// This preload affects only the adapter build child process on Windows.
if (process.platform === "win32") {
  const originalLink = fs.symlinkSync;
  const originalRead = fs.readlinkSync;
  fs.symlinkSync = function (target, destination, type) {
    if (typeof target === "string" && (type === undefined || type === "dir")) {
      const resolved = path.resolve(path.dirname(String(destination)), target);
      if (fs.statSync(resolved, { throwIfNoEntry: false })?.isDirectory()) {
        return originalLink(resolved, destination, "junction");
      }
    }
    return originalLink(target, destination, type);
  };
  // OpenNext's Turbopack external-module matcher expects forward slashes.
  fs.readlinkSync = function (...args) {
    const value = originalRead(...args);
    return typeof value === "string" ? value.replaceAll("\\", "/") : value;
  };
  syncBuiltinESMExports();
}
