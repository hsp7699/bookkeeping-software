import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

// Attachments live on the server's disk under STORAGE_DIR (default ./storage),
// under random keys. Back this directory up with the database.

const ROOT = path.resolve(process.env.STORAGE_DIR ?? "./storage");

export const MAX_BYTES = 25 * 1024 * 1024;
export const ALLOWED: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/heic": "heic",
  "image/webp": "webp",
  "text/csv": "csv",
  "application/x-ofx": "ofx",
  "application/vnd.intu.qfx": "qfx",
};

function resolveKey(key: string) {
  if (!/^[a-z0-9-]+\/[0-9a-f-]{36}\.[a-z0-9]+$/.test(key)) throw new Error("bad storage key");
  return path.join(ROOT, key);
}

export async function putFile(companyId: string, ext: string, data: Buffer): Promise<string> {
  const key = `${companyId}/${randomUUID()}.${ext}`;
  const file = resolveKey(key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data, { flag: "wx" });
  return key;
}

export function getFile(key: string): Promise<Buffer> {
  return readFile(resolveKey(key));
}

export async function removeFile(key: string) {
  await unlink(resolveKey(key)).catch(() => {});
}
