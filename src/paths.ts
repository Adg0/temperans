import { normalizePath } from "obsidian";

export function hasInvalidPathChar(segment: string): boolean {
  for (let i = 0; i < segment.length; i++) {
    const code = segment.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
    const char = segment[i];
    if (char === "<" || char === ">" || char === ":" || char === '"' || char === "|" || char === "?" || char === "*" || char === "\\") return true;
  }
  return false;
}

/** Portable, explicit vault-relative paths. Validate before normalizing. */
export function operationFolder(value: string): string {
  const path = value.trim().replace(/\\/g, "/");
  const parts = path.split("/");
  if (!path || parts.some(part => !part || part.startsWith(".") || hasInvalidPathChar(part)
    || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error("Choose an operation folder inside this vault, without absolute paths, hidden folders, or parent traversal.");
  }
  return normalizePath(path);
}
