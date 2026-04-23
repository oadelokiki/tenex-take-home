import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type UserConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Monorepo root — same place the API loads `.env` from. */
const repoRoot = path.resolve(__dirname, "../..");

/** Match Vite dev port to `PUBLIC_WEB_ORIGIN` so OAuth cookies and `/api` stay same-origin. */
function devServerPortFromPublicWebOrigin(origin: string | undefined): number {
  if (!origin) return 5173;
  try {
    const u = new URL(origin);
    if (u.port !== "") return Number.parseInt(u.port, 10);
  } catch {
    /* ignore */
  }
  return 5173;
}

/** Match the hostname you use in the browser (`localhost` vs `127.0.0.1`) so cookies and OAuth stay consistent. */
const apiTarget = "http://localhost:3000";

const apiProxy = {
  "/api": { target: apiTarget, changeOrigin: true },
  "/auth": { target: apiTarget, changeOrigin: true },
  "/logout": { target: apiTarget, changeOrigin: true },
  "/health": { target: apiTarget, changeOrigin: true },
  "/__e2e": { target: apiTarget, changeOrigin: true },
} as const;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "PUBLIC_");
  const port = devServerPortFromPublicWebOrigin(env.PUBLIC_WEB_ORIGIN);

  const config: UserConfig = {
    /** Load repo-root `.env` so `PUBLIC_WEB_ORIGIN` matches API + Google redirect configuration. */
    envDir: repoRoot,
    // Hoisted root `vite` vs `apps/web/vite` types can disagree in the workspace; runtime is correct.
    plugins: [react()] as UserConfig["plugins"],
    server: {
      port,
      strictPort: true,
      proxy: { ...apiProxy },
    },
    preview: {
      port: 4173,
      strictPort: true,
      proxy: { ...apiProxy },
    },
    build: {
      outDir: "dist",
      sourcemap: true,
    },
  };
  return config;
});
