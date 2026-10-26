/** Cron endpoint authentication (SPEC §9). SERVER ONLY. */
import { createHash, timingSafeEqual } from "node:crypto";

/** Timing-safe comparison of the Authorization header with `Bearer <secret>`. */
export function isAuthorizedCron(header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  // Hash both sides so lengths match and the secret length does not leak.
  const a = createHash("sha256").update(header).digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}
