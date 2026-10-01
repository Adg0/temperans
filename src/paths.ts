import { normalizePath } from "obsidian";

/** Portable, explicit vault-relative paths. Validate before normalizing. */
export function operationFolder(value: string): string {
  const path = value.trim().replace(/\\/g, "/");
  const parts = path.split("/");
  if (!path || parts.some(part => !part || part.startsWith(".") || /[<>:"|?*\u0000-\u001f]/.test(part)
    || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error("Choose an operation folder inside this vault, without absolute paths, hidden folders, or parent traversal.");
  }
  return normalizePath(path);
}
