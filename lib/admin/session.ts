// Admin session for the review queue. Viewing is public; every write action (approve,
// edit, reject, apply) must call requireAdmin() itself, because Server Actions are reachable
// by direct POST, not only through the UI.
//
// The cookie holds an expiry signed with HMAC keyed by ADMIN_TOKEN, so rotating the token
// logs everyone out. With ADMIN_TOKEN unset, admin mode is off entirely.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "sr_admin";
const SESSION_SECONDS = 12 * 60 * 60;

const token = () => process.env.ADMIN_TOKEN || null;

function sign(expires: number, key: string) {
  return createHmac("sha256", key).update(`admin:${expires}`).digest("base64url");
}

/** Compares digests so length differences don't leak through timing. */
function safeEqual(a: string, b: string) {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function checkPasscode(passcode: string): boolean {
  const key = token();
  return !!key && passcode.length > 0 && safeEqual(passcode, key);
}

/** Call only from a Server Action, after checkPasscode. */
export async function startAdminSession() {
  const key = token();
  if (!key) throw new Error("Admin mode is not configured");
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  (await cookies()).set(ADMIN_COOKIE, `${expires}.${sign(expires, key)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function endAdminSession() {
  (await cookies()).delete(ADMIN_COOKIE);
}

export async function isAdmin(): Promise<boolean> {
  const key = token();
  const value = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!key || !value) return false;
  const [expiresRaw, signature] = value.split(".");
  const expires = Number(expiresRaw);
  if (!signature || !Number.isFinite(expires) || expires < Date.now() / 1000) return false;
  return safeEqual(signature, sign(expires, key));
}

export async function requireAdmin() {
  if (!(await isAdmin())) throw new Error("Admin passcode required");
}
