import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().default(3000),
    HOST: z.string().default("0.0.0.0"),
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    /** Must exactly match an entry in Google Cloud Console. Local dev: same origin as the Vite app (e.g. …:5173/auth/google/callback) so the session cookie applies to the SPA. */
    GOOGLE_REDIRECT_URI: z.string().url(),
    /**
     * Browser-facing SPA base URL (no path). After Google OAuth, users are redirected here
     * (e.g. `/?auth=success`) so they do not land on the API’s `/` (which has no route).
     */
    PUBLIC_WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
    /** Allowlist: callback URI must equal this (single canonical redirect) */
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
    OLLAMA_URL: z.string().url().default("http://127.0.0.1:11434"),
    /** Exact Ollama registry tag for Mistrallite / Mistral-family lite (e.g. mistral:7b-instruct-q4_K_M) */
    OLLAMA_MODEL: z.string().min(1).default("mistral:7b-instruct-v0.3-q4_K_M"),
    /** Max calendar query span in days (abuse / DoS guard) */
    CALENDAR_MAX_RANGE_DAYS: z.coerce.number().int().positive().max(90).default(32),
    /** When true, registers `__e2e/*` routes and expects E2E_SECRET (local/CI automation only). */
    E2E_MODE: z.preprocess((v) => v === "1" || v === "true", z.boolean()).default(false),
    /** Shared secret for `X-E2E-Secret` on `__e2e` routes (required if E2E_MODE). */
    E2E_SECRET: z.string().min(16).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.E2E_MODE && !data.E2E_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "E2E_SECRET is required when E2E_MODE is enabled",
        path: ["E2E_SECRET"],
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment: ${JSON.stringify(msg)}`);
  }
  return parsed.data;
}

export function isProduction(config: AppConfig): boolean {
  return config.NODE_ENV === "production";
}
