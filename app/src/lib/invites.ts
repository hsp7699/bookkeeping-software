import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";

// Invite links carry a random token; only its SHA-256 is stored.

export const INVITE_DAYS = 14;

export function newInviteToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

export function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** This server's public address: APP_URL if set, else the address the request came in on. */
export async function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"}`;
}
