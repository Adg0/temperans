import { App } from "obsidian";
import { vi } from "vitest";
import { TFile, TFolder } from "./obsidian-ui";

/** In-memory vault with real file/folder identity for storage and transfer tests. */
export function memoryVault() {
  const entries = new Map<string, TFile | TFolder>();
  const contents = new Map<string, string>();
  function folder(path: string): TFolder {
    const existing = entries.get(path);
    if (existing instanceof TFolder) return existing;
    if (existing) throw new Error("File already exists");
    const result = new TFolder(path);
    entries.set(path, result);
    if (path) folder(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "").children.push(result);
    return result;
  }
  function put(path: string, text: string): TFile {
    let file = entries.get(path);
    if (file instanceof TFolder) throw new Error("Folder already exists");
    if (!file) {
      file = new TFile(path);
      entries.set(path, file);
      folder(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "").children.push(file);
    }
    contents.set(path, text);
    return file;
  }
  const vault = {
    getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
    read: vi.fn(async (file: TFile) => contents.get(file.path)!),
    create: vi.fn(async (path: string, text: string) => { if (entries.has(path)) throw new Error("Already exists"); return put(path, text); }),
    process: vi.fn(async (file: TFile, update: (text: string) => string) => {
      const next = update(contents.get(file.path)!); contents.set(file.path, next); return next;
    }),
    modify: vi.fn(async (file: TFile, text: string) => { contents.set(file.path, text); }),
    createFolder: vi.fn(async (path: string) => folder(path)),
    adapter: { exists: async (path: string) => entries.has(path) }
  };
  return { app: { vault, metadataCache: { getFileCache: () => null } } as unknown as App, vault, entries, contents, put, folder };
}
