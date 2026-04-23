# Calendar Assistant

A **Calendar Assistant** demo: connect a **Google** account (**Calendar** read/write for **events** on the primary calendar), browse your week in **react-big-calendar**, and chat with an assistant that uses **server-side context** from your events and **Ollama** for replies (default model tag is configurable; see [`docs/HARNESS.md`](docs/HARNESS.md) §4.1 for the **Mistrallite** convention).

Architecture, security expectations, test-to-flow mapping, and **technical tradeoffs with maintainer notes** live in **[`docs/HARNESS.md`](docs/HARNESS.md)** (see **§14**, including **§14.11** for Yarn / lockfile policy).

**Contents:** [Prerequisites](#prerequisites) · [Run locally](#how-to-run-local-development) · [End-user experience](#how-to-access-the-end-user-experience) · [Host with Docker](#how-to-host-docker-compose) · [Test](#how-to-test) · [E2E automation stack](#e2e-stack-automation-not-for-production-users) · [Build](#build-for-production-artifacts) · [Layout](#repository-layout)

---

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Node.js 20+** and **Yarn** (via **Corepack**; version pinned in root **`packageManager`**) | Used for API, web, tests, and scripts. |
| **Google Cloud project** | Calendar API enabled, OAuth consent screen configured, OAuth **Web client** credentials. |
| **Ollama** (local dev or Docker) | Install [Ollama](https://ollama.com), then `ollama pull <tag>` matching **`OLLAMA_MODEL`** in your `.env`. |
| **Docker** (optional) | For Compose-based hosting and CI image builds. |
| **Playwright browsers** (optional) | Once: `yarn exec playwright install chromium` before `yarn test:e2e`. |

---

## How to run (local development)

Use two terminals from the **repository root**. The API reads **`./.env`** at the repo root (see `apps/api/src/index.ts`).

### 1. Configure environment

```bash
cp .env.example .env
```

Edit **`.env`** and set at least:

- **`GOOGLE_CLIENT_ID`**, **`GOOGLE_CLIENT_SECRET`**
- **`GOOGLE_REDIRECT_URI`** — for **local Vite dev**, use the **same origin and port as the SPA** (Vite proxies `/auth` to the API). Default Vite is port **5173**:  
  **`http://localhost:5173/auth/google/callback`**  
  If Vite uses another port (e.g. **5174**), use that port here **and** in **`PUBLIC_WEB_ORIGIN`**, and register the **exact** URI in Google Cloud Console.  
  **Do not** point the redirect only at `:3000` unless you always open the SPA on `:3000` too — otherwise the session cookie may not be sent for `/api` calls from the dev server port.
- **`PUBLIC_WEB_ORIGIN`** — where the browser goes **after** OAuth (defaults to **`http://localhost:5173`**). Must match the URL you type in the address bar (scheme, host, port). Docker/nginx on port 80: use **`http://localhost`** (or your public origin with scheme).
- **`SESSION_SECRET`** — at least 32 characters.
- **`OLLAMA_MODEL`** — must match a model you have pulled in Ollama (e.g. `mistral:7b-instruct-v0.3-q4_K_M`).

Start **Ollama** on the host and pull the model:

```bash
ollama pull mistral:7b-instruct-v0.3-q4_K_M
```

### 2. Install dependencies

From the repo root, enable Corepack (ships with Node 20+) so the **`packageManager`** field selects Yarn, then install:

```bash
corepack enable
yarn install
```

### 3. Start the API (port 3000)

```bash
yarn workspace @tenex/api dev
```

Leave this process running.

### 4. Start the web app (port 5173)

```bash
yarn workspace @tenex/web dev
```

The Vite dev server **proxies** `/api`, `/auth`, `/logout`, `/health`, and `/__e2e` to **`http://localhost:3000`** (keep **`localhost` vs `127.0.0.1`** consistent with **`GOOGLE_REDIRECT_URI`** / how you open the app).

---

## How to access the end-user experience

### URL (local development)

Open **`http://localhost:5173`** in your browser.

### What you will see

1. **Before sign-in**  
   You see the app title, a short note that the calendar loads after sign-in, and a **Connect Google Calendar** button (same-origin link to `/auth/google`).

2. **Sign-in**  
   Click **Connect Google Calendar**. You are redirected to Google, approve Calendar + email scopes, then redirected back to the app with a session cookie. Your **email** appears in the header when signed in.

3. **Calendar**  
   The main panel shows a **week calendar** (Monday-start week) for the visible range. Events come from Google Calendar **primary** via the API.

4. **Assistant**  
   The right-hand panel is a **plain-text chat**. A collapsible **“How this app works”** section (nested **`<details>`** controls) explains **creating** events via chat, **rescheduling or canceling** in Google Calendar, and how the assistant can still help with planning or wording. Ask about your week, meeting load, or request **email drafts** grounded in your availability (see demo prompts below).

   **Creating events:** describe the meeting in chat; when the assistant asks **“Are you sure you want to create this event?”**, confirm with **Create on calendar** or send **yes** / **create on calendar** (**no** / **Dismiss** cancels). If the model’s **`tenex-event`** block is incomplete, an **inline form** appears (fields that already look valid stay read-only); use **Edit info** to run **`POST /api/calendar/events/validate`** (same rules as create, no Google write). When validation succeeds, **Create on calendar** appears for the final **`POST /api/calendar/events`**.

   **Relative times (“tonight”, “today”):** each chat request sends the browser’s **clock and IANA timezone** to **`POST /api/chat`** so the server can anchor the model (see harness §9).

   Replies are generated by **Ollama** using **bounded** calendar JSON built on the server.

5. **Sign out**  
   **Sign out** clears the app session and returns you to the anonymous state.

### If something goes wrong

- **Redirect URI mismatch** — Google error pages almost always mean **`GOOGLE_REDIRECT_URI`** in `.env` does not exactly match a URI in the Google Cloud Console (including `http` vs `https`, port, and path).
- **Signed in at Google but SPA still anonymous** — Use **`GOOGLE_REDIRECT_URI`** on the **Vite origin** (e.g. `http://localhost:5173/auth/google/callback`), not only `http://localhost:3000/...`, so the **session cookie** is stored for the same host:port as the UI. Match **`PUBLIC_WEB_ORIGIN`** to the URL you open; avoid mixing **`localhost`** and **`127.0.0.1`**. With **`NODE_ENV=development`**, the API **refuses to start** if those two origins differ, so misconfiguration is obvious.
- **`DNS_PROBE_FINISHED_NXDOMAIN` for `accounts.google.com`** — Your environment cannot resolve or reach Google (DNS, VPN, firewall, or **WSL2 DNS**). This is not fixable in app code. From the same machine run **`getent hosts accounts.google.com`** or **`nslookup accounts.google.com`**; on WSL2, search for “WSL2 DNS resolution” / fix **`/etc/resolv.conf`** or **`generateResolvConf`** if nameservers are wrong.
- **Chat errors** — Ensure Ollama is running and **`OLLAMA_URL`** / **`OLLAMA_MODEL`** match your setup (`OLLAMA_URL` defaults to `http://127.0.0.1:11434`).
- **Empty calendar** — Check the week navigation; confirm the account has events in that range and that Calendar API is enabled.

---

## How to host (Docker Compose)

The stack is **nginx** (port **80**) → **API** (internal) → **Ollama** (internal only; **not** exposed on the host). Production-style env is documented in the harness (`/opt/tenex-take-home/.env` on a droplet).

### Local or server with Compose

1. Create an **`.env`** file (same variables as [`.env.example`](.env.example)). For Compose on **localhost port 80**, set:

   **`GOOGLE_REDIRECT_URI=http://localhost/auth/google/callback`**  
   **`PUBLIC_WEB_ORIGIN=http://localhost`**

   and add the redirect URI in Google Cloud Console.

2. Point Compose at your env file. By default the compose file expects **`/opt/tenex-take-home/.env`** on the machine. For a laptop or CI, override:

   ```bash
   TENEX_ENV_FILE=./.env docker compose up --build -d
   ```

3. Open **`http://localhost`** (no port; nginx listens on **80**).

4. **First run only** — pull the LLM inside the Ollama container (match **`OLLAMA_MODEL`**):

   ```bash
   docker compose exec ollama ollama pull mistral:7b-instruct-v0.3-q4_K_M
   ```

### DigitalOcean (or any VPS) checklist

- Install **Docker Engine** and the **Compose plugin**.
- Place secrets in **`/opt/tenex-take-home/.env`** with **`chmod 600`** (see harness).
- Open firewall ports **22**, **80**, and **443** when you add TLS.
- Do **not** expose Ollama’s port **11434** publicly; only the API talks to it on the Docker network.
- Use **HTTPS** and update **`GOOGLE_REDIRECT_URI`** for production when you terminate TLS on nginx.

---

## How to test

| Command | Purpose |
|---------|---------|
| **`yarn test`** | **Vitest**: API unit/integration (`Fastify.inject`, mocked Google/Ollama where needed) + web smoke test. |
| **`yarn test:e2e`** | **Playwright**: full browser flows against **Vite preview** + API in **E2E mode** (stubbed calendar/LLM; secured `/__e2e` bootstrap). |
| **`yarn test:all`** | Runs **`yarn test`** then **`yarn test:e2e`**. |

**First time only (E2E):**

```bash
yarn exec playwright install chromium
```

**CI** (`.github/workflows/ci.yml`) runs **`corepack enable`**, **`yarn install --immutable`**, **`yarn test`**, **`yarn build`**, Playwright browser install, **`yarn test:e2e`**, and **`docker compose build`**.

For a **per-flow** map of what each E2E spec covers, see **[`docs/HARNESS.md` §13](docs/HARNESS.md)**.

---

## E2E stack (automation, not for production users)

To run the same stack Playwright uses:

```bash
yarn start:e2e
```

This builds the web app, starts the API with **`TENEX_USE_E2E_ENV=1`** (loads committed **`.env.e2e`**), and serves **`http://127.0.0.1:4173`**. There is no real Google sign-in; sessions are created via internal **`/__e2e`** routes protected by **`X-E2E-Secret`**. Do **not** deploy with **`E2E_MODE=1`** on a public internet host.

---

## Build for production artifacts

```bash
yarn build
```

Produces **`apps/api/dist`** and **`apps/web/dist`**. Dockerfiles consume these layouts when building images.

---

## Repository layout

| Path | Role |
|------|------|
| `apps/api` | Fastify: OAuth + PKCE, sessions, Calendar list/create + **validate** route, chat → Ollama |
| `apps/web` | Vite + React + react-big-calendar; chat (**client clock**), **`tenex-event`** confirm + inline fix form |
| `infra/nginx` | Static SPA + reverse proxy to API |
| `e2e/` | Playwright specs (one file per numbered flow in harness §13) |
| `docker-compose.yml` | `nginx`, `api`, `ollama` |
| `.env.example` | Template for human `.env` |
| `.env.e2e` | Automation-only env for `TENEX_USE_E2E_ENV=1` |

---

## Demo prompts (after real sign-in)

- “Summarize how much of my week is in meetings and suggest one change.”
- “Draft short emails to Alice and Bob proposing two meeting times from my free blocks this week; I want to keep mornings free before 10:00 if possible.”
- “Schedule a 45-minute sync **tonight** at 8pm Eastern titled ‘Handoff’—I’m the only attendee; description: review open items.” *(Exercises client clock + timezone in chat.)*

---

## Data retention (PoC)

- **Sessions** and OAuth pending data are **in-memory** on the API process (lost on restart).
- **Chat** is not stored server-side; refreshing the page clears the in-browser thread unless you add persistence later.
