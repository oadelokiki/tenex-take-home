import type { AppConfig } from "./config.js";
import { isProduction } from "./config.js";

/** Options for setting / clearing the signed session cookie (must match for browsers to drop it). */
export function sessionCookieOpts(config: AppConfig) {
  return {
    path: "/" as const,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProduction(config),
    signed: true as const,
  };
}
