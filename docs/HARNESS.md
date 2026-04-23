# Tenex take-home — project harness

This document is the **source of truth** for scope, architecture, engineering preferences, **security requirements**, **test coverage**, and **technical decisions with explicit tradeoffs** (§14).

**Keeping it current:** any merge that changes **auth behavior**, **deployment shape**, **LLM integration**, **persistence**, **public API contracts**, or **test / E2E strategy** should update the matching section here—especially **§14** (add or revise a row) and **§9 / §11 / §13** where applicable. Prefer **tables** over one-off paragraphs so drift is visible in review.

Implementers (human or agent) should read this file before adding code or infrastructure.

---

## 1. Goal

Build the **Calendar Assistant** take-home:

- Users **authenticate with Google** (Workspace / consumer Google — same OAuth) and grant **Calendar** access.
- The **React** web UI **displays calendar data** in a clear, sensible layout (week/month-style views are appropriate) and supports **creating** primary-calendar events via **chat + confirm**: the model emits a **`tenex-event`** JSON fence after an **“Are you sure you want to create this event?”** prompt. If the fence JSON is **fully valid**, the SPA shows **Create on calendar** / **Dismiss** and **`POST /api/calendar/events`** after explicit confirmation. If it is **incomplete or invalid**, the SPA shows an **inline fix form** (read-only for client-valid fields), then **`POST /api/calendar/events/validate`** (**Edit info**) before the final create step.
- A **simple chat** lets users talk to a **calendar-aware assistant** with examples such as:
  - Proposing schedules / **email drafts** to multiple people while respecting constraints (e.g. blocking mornings).
  - **Analytics-style** questions (time in meetings) and **actionable recommendations**.

**Proof-of-concept scale:** about **1–5 concurrent users** at peak. Favor clarity and a defensible architecture over premature scale.

---

## 2. Non-goals and honest constraints

- **No native mobile app** for this project path — **web only (React)**. (Expo is out of scope unless explicitly reopened.)
- **Cross-user calendar availability** (e.g. Joe’s free/busy) is **not** implied by the user’s token alone. The assistant should **draft emails with proposed slots from the signed-in user’s calendar** and state assumptions when external free/busy is unknown.
- **First-class edit/delete of existing events inside this SPA** is **not** in scope for the PoC: the API **`events.list`** + **`events.insert`** on **primary**; **reschedule or cancel** happens in **Google Calendar** (the UI copy and collapsible help explain this). The assistant may still help users **plan** changes or **draft** messages to others.
- **Production enterprise hardening** (SOC2, full DLP, etc.) is not required; **sensible defaults** (secrets not in the client, minimal scopes) are.

---

## 3. Architecture (classical server-backed model)

**Principle:** the **browser is untrusted UI**. **Google refresh tokens**, **Calendar API** access, **aggregation / free-block logic**, and **LLM calls** run on **our Node server**. **Compute cost and custody** intentionally lean on **our infrastructure**, not the end user’s RAM (no in-browser LLM for this path).

```mermaid
flowchart LR
  subgraph browser [Browser]
    React[React SPA]
  end

  subgraph docker [Docker host]
    Nginx[nginx container]
    API[Node API container]
    Ollama[Ollama container]
  end

  Google[Google OAuth / Calendar API]

  React -->|HTTPS same origin| Nginx
  Nginx -->|"/api" "/auth" proxy| API
  API --> Google
  API -->|internal network only| Ollama
```

| Layer | Responsibility |
|--------|----------------|
| **React** | Calendar UI, **plain-text** chat UI, collapsible **`<details>`** “How this app works” copy for end users (create vs change/cancel in Google Calendar). Calls same-origin `/api/*` and `/auth/*` with cookies; sends **client clock + IANA timezone** on each **`POST /api/chat`**. **No** Google refresh tokens in JS storage. |
| **nginx (container)** | Terminate public **HTTP (80)**; serve **static** SPA build; **reverse-proxy** API and OAuth routes to Node. **nginx configuration is baked into the image** (see §7). |
| **Node API** | OAuth callback; **session**; store **Google refresh token** server-side; **Calendar** `events.list`, **`events.insert`** (primary calendar, validated body); **`POST /api/calendar/events/validate`** (same zod as insert, **no** Google call); **build bounded context** for the model (includes optional **`clientClock`** from the browser); call **Ollama**. |
| **Ollama** | Chat completions only; default model **Mistrallite** (§4.1). Receives **sanitized, capped** calendar context — **not** raw unlimited dumps. |

**Agent pattern:** implement a **deterministic layer** in Node (meeting hours, free blocks, “mornings blocked” style rules, pagination/summarization) and use the **LLM for language + planning** on top of **structured facts** you pass in. Avoid stuffing entire calendars into the prompt when ranges are large.

---

## 4. Stack preferences

| Area | Choice |
|------|--------|
| Frontend | **React** (e.g. Vite); calendar display via a reputable library (e.g. FullCalendar / react-big-calendar) is fine. |
| Backend | **Node.js** — **Fastify** or **Express** (either acceptable; pick one and stay consistent). |
| Google APIs | **`googleapis`** package from the npm registry; Calendar **`calendar.events`** + `openid` + **email** for list + create on **primary**; server validates create payloads (**summary**, required **description**, **start**/**end** ISO, **attendees** emails, no duplicates, caps). |
| LLM | **Ollama** HTTP API from Node; **default chat model: Mistrallite** (see §4.1). **`OLLAMA_MODEL`** (or equivalent) and **base URL** from environment variables — always pin the **exact** Ollama registry tag. |
| Validation | **`zod`** (or equivalent) for query/body validation on the API. |
| Auth for “our app” | **httpOnly cookie session** (or JWT **only** if placed in **httpOnly** cookies with explicit expiry/rotation). **Do not** use **bcrypt** unless **first-party passwords** are added — OAuth-only flows have no password verifier. |

### 4.1 LLM choice: Mistrallite — how and why

**Project default:** run the assistant’s chat completions through **Ollama** using a **Mistral-family lite** checkpoint we refer to as **Mistrallite** (spelling matches our deployment and docs convention).

**Why Mistrallite fits this product**

- **Low prompt variance:** the assistant is not a general-purpose chatbot. We intend a **small, stable set of behaviors**—for example: turn **server-computed** free blocks and constraints into **email drafts**, summarize **meeting load** from **server-computed** stats, and offer **short, grounded** recommendations. System prompts and tool-shaped JSON from Node stay **largely fixed** across requests.
- **Truth stays in Node:** calendar facts, slot proposals, and aggregates come from the **deterministic layer** (§3). The model’s job is primarily **language and formatting** on top of **bounded, structured** context, which plays to a **smaller / lite** model.
- **PoC economics:** **Mistrallite** targets **lower RAM and CPU** than large general models on the same droplet (§8), which matters for **1–5 concurrent users** on modest hardware while keeping latency acceptable.

**How we use it**

- **Ollama** remains the only inference surface the **API** calls (internal Docker network; §7).
- Configure **`OLLAMA_MODEL`** (name illustrative — use the **exact** tag your registry ships for the chosen Mistrallite artifact, e.g. the specific `mistral…` / lite variant) plus **`OLLAMA_HOST`** / URL in **`/opt/tenex-take-home/.env`**.
- **First deploy / README:** document the **`ollama pull <exact-tag>`** command so the droplet image has weights before traffic hits chat.
- **Regression:** when the tag or quantization changes, re-run a **small fixed prompt set** (draft + analytics + “unknown in data”) so grounding and tone stay acceptable.

**When to revisit the choice**

- If evals show **hallucinated schedule details** or weak drafts **after** tightening prompts and structured facts, try a **stronger** or **larger** tag before re-architecting the stack.

---

## 5. Session and secrets

- **Google refresh token** and session mapping live **only on the server** (DB or encrypted store — acceptable PoC: filesystem/SQLite with clear README).
- **Browser:** session cookie for **our** app, not Google’s long-lived refresh token.
- **Environment:** production secrets on the droplet in **`/opt/tenex-take-home/.env`** (host path, `chmod 600`). **Not** committed to git.

---

## 6. Security requirements

Security is **required** at a sensible PoC level: explicit **MUST** rules and **SHOULD** recommendations. Full enterprise compliance (SOC2, enterprise DLP) remains out of scope per §2.

### MUST (implement)

| Topic | Requirement |
|--------|-------------|
| **OAuth** | Use a **cryptographic `state` parameter** on authorize start; validate it on callback. Use **PKCE** if any part of the flow treats the OAuth client as public. |
| **Redirect URIs** | Callback URLs must match **allowlisted** values in Google Cloud Console **and** server expectations — never redirect to user-supplied arbitrary URLs. |
| **Google scopes** | **Least privilege:** document and use the **minimal** Calendar + identity scopes for the product (here: **`calendar.events`** for read/write **events** on calendars the user can access, plus **`openid`** / **email** — not the full **`calendar`** scope). |
| **Google refresh tokens** | Stored **only on the server**; never in `localStorage` / `sessionStorage`; **never** log tokens or ship them to client-side analytics. Prefer **encryption at rest** if persisted beyond memory (document PoC tradeoffs if omitted). |
| **Browser session** | Session cookie for **our** app: **`HttpOnly`**, **`Secure`** when HTTPS is enabled, **`SameSite`** appropriate to deployment (`Lax` / `Strict` for same-origin SPA + API). |
| **Session fixation** | Issue a **new** server session identifier after a successful OAuth callback. |
| **Frontend secrets** | **No** Google OAuth **client secret** in the React bundle — web OAuth uses a public client id; any secret stays server-side only. |
| **Authorization** | Calendar and chat handlers resolve identity **only** from the **verified server session**. Never trust a `userId` (or similar) from the request body without binding it to that session. |
| **Chat API trust boundary** | **`POST /api/chat`** accepts **`user`** and **`assistant`** roles in `messages` only; the server builds the single **`system`** message (prompt + calendar JSON). Clients must not be able to inject extra **`system`** lines into the model request. |
| **Abuse / DoS** | **Validate** `timeMin` / `timeMax` (maximum span, max string length for ISO timestamps, sanity checks) before Calendar API calls; **validate** event **create** JSON (**length caps**, **email** shape, **duplicate** attendees, **end > start**, max **14-day** span) on **`POST /api/calendar/events`** and **`POST /api/calendar/events/validate`**. Apply **rate limits** to `/api/chat`, **`POST /api/calendar/events`**, **`POST /api/calendar/events/validate`**, and OAuth initiation. Set **request / body size limits** in nginx and Node. |
| **Ollama exposure** | Ollama reachable **only** on the Docker internal network from **`api`**. **Do not** publish port **11434** to the host publicly; **no** nginx route from the internet to Ollama. Confirm host firewall (UFW / DO) **denies** inbound **11434** from `0.0.0.0/0`. |
| **Runtime secrets** | Production values only in **`/opt/tenex-take-home/.env`** on the host; **not** in git; **not** baked into images via build `ARG` / `ENV` for production secrets. |
| **Logging** | Do not log **refresh tokens**, **access tokens**, **full calendar payloads**, or **raw chat** at default / info levels. Redact or truncate where logs are needed for debugging. |
| **LLM context** | Treat **bounded, sanitized** context to Ollama as both a **quality** and **security** property — reduces accidental inclusion of large PII blobs in prompts and logs. |

### SHOULD (strongly recommended)

| Topic | Recommendation |
|--------|----------------|
| **CSRF** | Prefer **SameSite** cookies; for cookie-authenticated **state-changing** `POST`s, add **anti-CSRF tokens** or equivalent if cross-site flows ever apply. |
| **CSP** | Serve a **Content Security Policy** for the SPA (`default-src`, `script-src`, `connect-src` limited to your own origin where possible). |
| **XSS / chat rendering** | Render assistant output as **plain text** by default, or sanitize any rich formatting; never `dangerouslySetInnerHTML` with model output. |
| **Prompt injection** | Instruct the model not to follow hostile instructions embedded in **event titles / descriptions**; assume **calendar text is untrusted** for policy-bypass and exfiltration narratives. |
| **Logout** | Destroy the **server session**; optionally **revoke** the Google refresh token where supported. |
| **TLS** | Use **HTTPS** in real deployments; enable **HSTS** once stable. |
| **Supply chain** | Commit **`yarn.lock`**; run **`yarn npm audit`** (or registry-native tooling) in CI; enable **Dependabot** or equivalent. |
| **Containers** | Run **`api`** as **non-root** in the image where practical; pin base image **digests** in CI for reproducibility; scan images (e.g. **Trivy**) in CI. |
| **Host** | Key-based **SSH**; disable password login on the droplet; document firewall rules (**22**, **80**, **443**). |
| **Data retention** | Document whether **chat** or **calendar cache** is persisted, for how long, and whether it is deleted on logout. |

### Relationship to other sections

- **§3** — Bounded context to Ollama is **defense in depth**, not an optional nicety.
- **§5** — Host `.env` permissions and server-only Google tokens are part of the **MUST** set above.

---

## 7. Docker and Compose preferences

**Services (conceptual):**

1. **nginx** — public **:80**; SPA static files; proxies `/api/` and `/auth/` to the API service.
2. **api** — Node server on an **internal** port (e.g. 3000), **not** published to the host except via nginx if desired.
3. **ollama** — listens on **11434** on the **Docker network only**; **do not** publish `11434` to `0.0.0.0` on the host.

**`env_file` contract (explicit):** the **`api`** service must load environment from the **host** file:

```yaml
services:
  api:
    env_file:
      - /opt/tenex-take-home/.env
```

Deploy with plain `docker compose up -d` on the droplet; **no** reliance on `docker compose --env-file` for the API container’s runtime env unless compose-file **interpolation** (`${VAR}`) needs the same file.

**nginx configuration:** **inside the image** (`COPY` in Dockerfile). **TLS certificates** (when added) are **mounted** at runtime — keys are not baked into images.

**Ollama networking:** bind / attach so it is reachable as **`http://ollama:11434`** from `api` only on the compose network. **Firewall (UFW / DO):** do not open **11434** to the internet.

---

## 8. Deployment target

- **DigitalOcean droplet** (small PoC; RAM driven mainly by **Ollama** and the **Mistrallite** tag/quantization, not nginx/Node).
- **Docker Engine + Compose plugin** on the droplet.
- **GitHub Actions:** CI builds/tests and builds images; CD pushes images and **SSH**s to the droplet to `docker compose pull && docker compose up -d` (or equivalent). Registry: **GHCR** or Docker Hub — pick one and document it.

---

## 9. API surface (sketch)

Implementers should keep routes predictable for the SPA:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/auth/google` | Start OAuth redirect |
| GET | `/auth/google/callback` | OAuth callback; establish session |
| POST | `/logout` | Clear session (optional but nice) |
| GET | `/api/calendar/events` | Query params `timeMin`, `timeMax` (ISO) |
| POST | `/api/calendar/events` | JSON body: **`summary`**, required **`description`**, **`start`** / **`end`** (ISO-8601 with offset), **`attendees`** (string array of emails; 1–50; unique; validated). **201** returns `{ event }`. Rate-limited. Session required. (SPA: filled from chat **`tenex-event`** proposal + **Create on calendar**.) |
| POST | `/api/calendar/events/validate` | Same body as **`POST /api/calendar/events`**; runs the **same zod** as create but **does not** call Google. **200** `{ ok: true, event }` (normalized); **400** `{ ok: false, error, message, details }`. Session required. SPA: **Edit info** after fixing invalid **`tenex-event`** JSON in the inline form. |
| POST | `/api/chat` | Body: `{ messages: { role: "user" \| "assistant", content }[], optional timeMin/timeMax, optional client clock: clientNowIso + ianaTimeZone (both required if either is sent; optional localCalendarDate YYYY-MM-DD — server derives from the first two when omitted) }` — **no** client `system` role; server prepends system + bounded calendar JSON (includes **clientClock** in the JSON when those fields are present). SPA sends browser clock each turn for **tonight** / relative scheduling. |

**Same origin:** nginx serves the SPA and proxies API/auth so **CORS** is minimal.

**SPA ↔ chat contract:** the web app sends **`clientNowIso`**, **`ianaTimeZone`**, and **`localCalendarDate`** (optional; server can derive) on **every** `POST /api/chat` so relative language (“tonight”, “today”) anchors to the user’s wall clock, not only the visible week **`range`**.

---

## 10. Observability and demo polish

- Centralized **error mapping** (e.g. Google 401 → “reconnect calendar”).
- **README** on the repo: local dev, **Google Cloud** OAuth client setup, redirect URIs for prod, env var list, first-time **`ollama pull`** for the **pinned Mistrallite** tag on the droplet.
- Short **demo script** in README (scheduling + analytics questions).

---

## 11. Checklist before calling the project “done”

- [ ] Google OAuth with **documented** Calendar scopes (**`calendar.events`** for this PoC’s read + create).
- [ ] **OAuth `state`** (and **PKCE** if applicable) implemented and validated on callback.
- [ ] Session cookies: **`HttpOnly`**, **`Secure`** (with HTTPS), **`SameSite`** chosen; **new session** after OAuth.
- [ ] Calendar renders for a real account over a **defined date range**.
- [ ] Chat uses **server-fetched** calendar facts + **bounded** context; **browser clock + timezone** on chat requests for relative dates; **rate limits** + **max calendar span** enforced.
- [ ] **Create path:** valid **`tenex-event`** → confirm → **`POST /api/calendar/events`**; invalid fence → inline form → **`POST /api/calendar/events/validate`** → then confirm → create.
- [ ] End-user **`<details>`** help in the Assistant panel explains create vs reschedule/cancel expectations.
- [ ] **Authorization:** all protected routes use **session-derived** identity only.
- [ ] Ollama **not** exposed publicly; API is the only caller; firewall denies **11434** from the internet.
- [ ] **Mistrallite:** **`OLLAMA_MODEL`** documents the **exact** Ollama registry tag; **`ollama pull`** documented for prod; lite-model eval set re-run after tag changes.
- [ ] **`/opt/tenex-take-home/.env`** documented; **api** `env_file` wired as above; **no secrets** in images or client bundle.
- [ ] nginx config **in image**; **80** (and **443** when TLS is added) documented.
- [ ] **Logging** policy: no tokens / full calendar / raw chat at info by default.
- [ ] **Tests:** **`yarn test`** and **`yarn test:e2e`** green in CI; critical flows in **§13.3** each have an owner spec (or explicit manual gap).
- [ ] CI green (including **lockfile** + **audit** policy if adopted); CD deploy path documented or automated.

---

## 12. Repository layout (suggested)

Not mandatory, but aligns with common review expectations:

```text
apps/web              # React (Vite)
apps/api              # Node API (+ optional E2E hooks under src/e2e/)
e2e/                  # Playwright specs (one file per numbered critical flow)
infra/nginx           # nginx.conf + Dockerfile for edge
docker-compose.yml
playwright.config.ts
.yarnrc.yml           # Yarn 4: node-modules linker
yarn.lock
.github/workflows/
docs/HARNESS.md       # this file
.env.e2e              # committed automation-only env (never production)
```

---

## 13. Test strategy, coverage, and critical user flows

This section is the **contract** between product intent and automated verification. Every **critical user flow** below is **documented separately** with pointers to tests.

### 13.1 Test layers

| Layer | Tooling | What it proves |
|--------|---------|----------------|
| **Unit / service** | Vitest (`apps/api`) | Pure logic: config rules, PKCE hash, calendar span guards, **event create body (`zod`)**, **`clientClock`** local-date helper, schedule engine, OAuth pending TTL, E2E route guards. |
| **API integration** | Vitest + `Fastify.inject` (`apps/api`) | HTTP semantics: health, session, authz, **chat** (incl. client-clock validation), **calendar create + validate**, mocked upstreams without Google/Ollama. |
| **UI smoke** | Vitest + Testing Library (`apps/web`) | Shell renders for anonymous state; **`tenex-event`** parse / draft extraction unit tests (`apps/web/src/tenexEventProposal.test.ts`). |
| **End-to-end (E2E)** | Playwright (`e2e/*.spec.ts`) | Browser + **Vite preview** + **real API process** on one machine; Google Calendar and Ollama are **stubbed** via `E2E_MODE` (see §13.4). |

**Commands:** `yarn test` (unit/UI), `yarn test:e2e` (Playwright), `yarn test:all` (both).

### 13.2 E2E automation harness (non-production)

E2E does **not** hit Google or a real Ollama model:

- **`TENEX_USE_E2E_ENV=1`** causes the API to load **`.env.e2e`** after the root `.env` (see `apps/api/src/index.ts`).
- **`E2E_MODE=1`** turns on **mocked** `listEvents` / **`createCalendarEvent`** / `ollamaChat` and registers **`POST /__e2e/reset`** and **`POST /__e2e/session`** (guarded by header **`X-E2E-Secret`**, value from **`E2E_SECRET`**). These routes **must never** be enabled in production deployment (`E2E_MODE` off).
- Playwright starts **`yarn start:e2e`** (API in E2E env + **`vite preview`** on **127.0.0.1:4173** with the same `/api`, `/auth`, `/logout`, `/health`, `/__e2e` proxy as dev).
- **Worker count is 1** and **`fullyParallel: false`** so a single in-memory session store does not race across tests.

### 13.3 Critical user flows — documented individually

Each row is a **separate** product-critical path. **Spec file** implements the automated check; **“Also covered by”** lists Vitest overlap where applicable.

| ID | User flow (intent) | Spec file (E2E) | Also covered by (Vitest) |
|----|--------------------|-----------------|---------------------------|
| **01** | **First visit, signed out:** user sees product title, explanation that calendar requires sign-in, and primary **Connect Google Calendar** CTA. | `e2e/flow-01-landing-unauthenticated.spec.ts` | `apps/web/src/App.test.tsx` |
| **02** | **Connect affordance:** “Connect” uses same-origin **`/auth/google`** so nginx/dev proxy can reach the API. | `e2e/flow-02-connect-link.spec.ts` | — |
| **03** | **OAuth start:** clicking the flow hits **`GET /auth/google`**, which responds with a **redirect** to Google’s OAuth endpoint and includes **PKCE** (`code_challenge`, `code_challenge_method=S256`) and **`state`**. | `e2e/flow-03-oauth-google-redirect.spec.ts` | — |
| **04** | **Signed-in calendar:** after authentication, **primary calendar events** for the visible range load and render (titles visible). *E2E uses fixture data via mocked Google.* | `e2e/flow-04-calendar-loads.spec.ts` | `apps/api/src/app.test.ts` (mocked calendar + inject) |
| **05** | **Assistant chat:** user sends a message; **assistant** replies with grounded behaviour; *E2E uses canned LLM output.* | `e2e/flow-05-chat-assistant.spec.ts` | `apps/api/src/app.test.ts` (mocked Ollama + inject) |
| **06** | **Sign out:** user ends the app session and returns to **anonymous** landing (Connect visible, identity hidden). | `e2e/flow-06-logout.spec.ts` | `apps/api/src/app.test.ts` (`POST /logout` cookie semantics via inject) |
| **07** | **Abuse guard — calendar span:** API rejects **absurdly large** `timeMin`/`timeMax` windows per **`CALENDAR_MAX_RANGE_DAYS`**. | `e2e/flow-07-calendar-range-validation.spec.ts` | `apps/api/src/lib/calendarRange.test.ts`, `apps/api/src/app.test.ts` |
| **08** | **Authorization — no session:** without a valid app session cookie, **calendar**, **calendar validate**, and **chat** APIs return **401**. | `e2e/flow-08-api-unauthorized.spec.ts` | `apps/api/src/app.test.ts` |
| **09** | **Liveness:** **`GET /health`** returns **`{ ok: true }`** for orchestrators. | `e2e/flow-09-health.spec.ts` | `apps/api/src/app.test.ts` |
| **10** | **OAuth callback with real Google + real tokens** (PKCE `code` exchange, refresh token storage, session cookie issuance). | *Manual or staging-only* (requires real Google project + browser) | `apps/api/src/e2e/register.test.ts` exercises **`__e2e` secrets only**; callback path covered indirectly by code review + manual QA |

### 13.4 Additional automated coverage (not a standalone “flow” row)

| Area | Tests |
|------|--------|
| **Chat body validation** (empty messages, oversized content, rejected `system` role, partial **client clock** fields) | `apps/api/src/app.chatValidation.test.ts` |
| **`POST /api/calendar/events/validate`** (401 / 200 / 400) | `apps/api/src/app.test.ts` |
| **`tenex-event` proposal** (strict parse, draft extract, fence stripping, attendee line parse) | `apps/web/src/tenexEventProposal.test.ts` |
| **`clientClock` IANA date helper** | `apps/api/src/lib/clientClock.test.ts` |
| **`__e2e` route security** (no secret / wrong secret / disabled when `E2E_MODE` off) | `apps/api/src/e2e/register.test.ts` |
| **OAuth pending store** | `apps/api/src/lib/oauthPendingStore.test.ts` |
| **Config / E2E env rules** | `apps/api/src/lib/config.test.ts` |

### 13.5 CI expectations

GitHub Actions enables **Corepack**, runs **`yarn install --immutable`**, then **`yarn test`**, **`yarn build`**, **`yarn exec playwright install chromium --with-deps`**, **`yarn test:e2e`**, and **`docker compose build`**. E2E depends on Playwright’s browser cache on the runner.

---

## 14. Technical decisions & tradeoffs

This section records **why** we chose a path, **what we gave up**, and **when to reconsider**. It is meant to stay **parallel to the codebase**: when the code changes, update the row or subsection here in the same PR.

### 14.1 Architecture & custody

| Decision | Rationale | Tradeoff / cost | Revisit when |
|----------|-----------|-----------------|--------------|
| **Classical server-backed stack** (React → API → Google / Ollama) | Single place for secrets, policy, logging, and **bounded** LLM context; matches common B2B security story (§3, §6). | We **operate** user calendar traffic and inference cost; higher trust bar for our infra. | Strong **data residency** or “zero server custody” becomes a hard requirement. |
| **No in-browser LLM** | Predictable quality, no multi-GB model downloads to end users, simpler CSP surface for model WASM. | Users cannot use the product fully **offline**; all chat requires network + healthy API + Ollama. | Product pivots to local-only or air-gapped demos. |
| **Deterministic “facts” + LLM for prose** | Reduces hallucinated schedule data; smaller models viable (§4.1). | More **Node** code to maintain (stats, caps, free-block heuristics). | Heuristics prove too brittle for user expectations; invest in richer structured calendar APIs or tools. |

### 14.2 Authentication & session design

| Decision | Rationale | Tradeoff / cost | Revisit when |
|----------|-----------|-----------------|--------------|
| **httpOnly signed cookie** (`tenex_sid`) for app session | Mitigates XSS token theft vs `localStorage`; simple revocation by deleting server row. | **CSRF** still a class of issues for cookie-auth POSTs; we rely on **SameSite** + same-origin layout (§6 SHOULD). | Cross-site integrations or third-party embeds require stricter CSRF tokens. |
| **No bcrypt / no first-party passwords** | OAuth-only; nothing to bcrypt (see earlier harness discussion). | Cannot offer “email + password” login without new threat model + storage. | Product adds non-OAuth identity. |
| **Google refresh token in process memory** (in-memory `SessionStore`) | PoC speed; zero migration scripts. | **Restart = logout everyone**; no horizontal scale without sticky sessions + shared store. | Multi-instance API, or compliance requires durable encrypted token vault. |
| **PKCE + `state` on Google OAuth** | Mitigates code interception and login CSRF for public web clients (§6 MUST). | Slightly more moving parts in auth routes. | Google or internal policy mandates different flow (e.g. private-use only). |

### 14.3 Google API & scopes

| Decision | Rationale | Tradeoff / cost | Revisit when |
|----------|-----------|-----------------|--------------|
| **`calendar.events`** (+ `openid` / email) | Lets the API **list** and **insert** events on the user’s calendars (PoC: **primary** only) while avoiding the broader **`calendar`** ACL scope. | Higher impact than **`calendar.readonly`** if a refresh token leaks; users see **write** consent text. | Need **free/busy** only, calendar metadata, or **non-primary** calendars without widening further. |
| **Single canonical `GOOGLE_REDIRECT_URI`** | Simple allowlist; fewer misconfig bugs. | Must maintain **separate** redirect URIs for **Vite dev** (callback on the **SPA port**, e.g. `:5173`) vs **Docker nginx** (`:80`) vs production HTTPS. | Many environments need dynamic redirect handling (then add strict server-side allowlist array). |
| **`PUBLIC_WEB_ORIGIN` for post-OAuth browser redirects** | Google returns to the **OAuth callback** URL; the API then redirects to **`PUBLIC_WEB_ORIGIN` + `/?auth=…`** so users land on the SPA, not **`GET /`** on the API (which 404s). | One more env var to keep aligned with how you host the SPA (port, TLS). | Multi-tenant vanity domains per session. |
| **Local dev: `GOOGLE_REDIRECT_URI` on the Vite origin** | **`GOOGLE_REDIRECT_URI`** should use the **same scheme/host/port as the SPA** (e.g. `http://localhost:5173/auth/google/callback`); Vite proxies `/auth` to the API so Google’s redirect hits the dev server, but **`Set-Cookie` is stored for the SPA origin**—avoiding “OAuth worked on :3000 but `/api/session` from :5174 has no cookie.” | You must add that full callback URI in Google Cloud Console; change the port if Vite is not on 5173. | Advanced dev-only OAuth callback on :3000 with mirrored cookie hacks. |
| **Synthetic event `id` when Google omits it** | `events.list` items without `id` get a **`randomUUID()`** so the SPA / tests never see duplicate empty keys. | UUIDs are not stable across refetches of the same logical event. | Google guarantees ids for your deployment; remove synthesis if redundant. |

### 14.4 LLM integration (Ollama / Mistrallite)

| Decision | Rationale | Tradeoff / cost | Revisit when |
|----------|-----------|-----------------|--------------|
| **Ollama over hosted LLM APIs** | No third-party inference bill; model pinned in our env; good for take-home narrative. | We **own** capacity planning, GPU/RAM sizing, and model updates on the droplet. | Need managed SLAs, faster iteration without ops, or models not available in Ollama. |
| **Default “Mistrallite” (Mistral-family lite) tag** | Low prompt variance + structured JSON → smaller model often enough (§4.1). | Weaker nuance / reasoning vs 70B-class models on messy prompts. | Quality bar not met after prompt + structure tightening. |
| **Cap + sanitize events before prompt** | Token cost, latency, and **PII blast radius** in logs and model context (§6). | Rare long events lose tail detail; edge summaries may omit nuance. | Users need full-body doc Q&A; then add retrieval/RAG with citations (different product shape). |
| **Chat roles restricted to `user` / `assistant`** | Prevents non-browser clients from appending forged **`system`** messages after our real system prompt (prompt-injection / policy bypass). Assistant lines remain client-supplied “history” for multi-turn UX; treat as untrusted text (same as user). | Cannot send a second server-style system block from the client (by design). | Product needs editable system prompt per tenant; drive from server config, not request body. |

### 14.5 API resilience & abuse

| Decision | Rationale | Tradeoff / cost | Revisit when |
|----------|-----------|-----------------|--------------|
| **`CALENDAR_MAX_RANGE_DAYS` guard** | Prevents accidental or hostile huge `events.list` pulls and giant prompts. | Power users cannot request **arbitrary multi-year** views in one shot. | Legitimate use case + paging strategy defined. |
| **ISO timestamp max length (80 chars)** on calendar + chat range fields | Bounds parsing work for `timeMin` / `timeMax` in query strings and JSON. | Extremely exotic encodings might need a higher cap. | Switch to epoch ms with strict int range if clients need non-ISO. |
| **Rate limits** (`@fastify/rate-limit` on chat, **`POST /api/calendar/events`**, **`POST /api/calendar/events/validate`**, and auth start) | Cheap protection for PoC public exposure (including calendar **writes** and repeated **validate** attempts). | Aggressive limits can **429** legitimate bursts; tuning per environment may be needed. | Traffic patterns known; add per-user limits or Redis-backed counters. |
| **Body size limits** (Fastify + nginx) | Reduces DoS via huge chat payloads. | Blocks uploading large attachments (not in scope today). | Chat supports attachments. |
| **Signed session cookie: matching `clearCookie` options** | Clearing stale sessions on **`GET /api/session`** uses the same **`path` / `httpOnly` / `sameSite` / `secure` / `signed`** flags as **`setCookie`** and **`POST /logout`**, so browsers reliably drop invalid cookies. | Duplicated option shape must stay in sync (centralized in **`sessionCookieOpts`**). | Cookie attributes multiply (e.g. `Partitioned`); keep one helper. |
| **OAuth pending map: `prune()` on `consume()`** | Expired `state` rows are removed on lookup attempts, not only on new **`/auth/google`** starts, trimming unbounded growth if OAuth starts stall. | Extra CPU on every consume (including invalid `state`). | Redis-backed store with TTL. |

### 14.6 Frontend & UX

| Decision | Rationale | Tradeoff / cost | Revisit when |
|----------|-----------|-----------------|--------------|
| **react-big-calendar** | Mature week/month views with less custom date math. | Bundle size vs hand-rolled grid; styling tied to library defaults. | Design system demands a fully custom calendar. |
| **Chat + `tenex-event` confirm panel** | Assistant gathers fields, must ask **“Are you sure you want to create this event?”** with details, then emits one Markdown fenced block tagged **`tenex-event`** containing JSON; the SPA strips that fence from chat display. If the fence JSON is **fully valid**, show **Create on calendar** / **Dismiss** before **`POST /api/calendar/events`**. If it is **incomplete or invalid**, show an **inline form** under that assistant turn (read-only for fields that already pass client checks), **Edit info** → **`POST /api/calendar/events/validate`**; on success show **Create on calendar**; on failure unlock server-rejected fields and allow retry or **Cancel**. Typed **yes** / **no** also submit / cancel the fix flow when a draft is pending. | Model JSON can be malformed — client draft + **server zod** gate writes. | Server-side tool loop or structured-output-only model (§14.10 deferred). |
| **Collapsible end-user help (`<details>`)** | **“How this app works”** summarizes **create** (chat + confirm + optional validate step) vs **update/cancel** (do in **Google Calendar**; assistant helps plan or draft). Keeps the chat column uncluttered. | Native disclosure styling varies by browser; not a substitute for full product docs. | i18n, richer onboarding, or contextual tips per screen. |
| **Client clock on `POST /api/chat`** | Browser sends **`clientNowIso`** + **`ianaTimeZone`** (+ optional **`localCalendarDate`**) each turn; server injects **`clientClock`** into assistant JSON + system hint so models anchor **“tonight”** to the user’s zone/day, not only the week **`range`**. | Trusts browser clock (acceptable for PoC UX); malicious skew is bounded by zod + calendar logic. | Server-side NTP truth or explicit user “home timezone” setting if abuse or DST edge cases matter. |
| **Vite dev + preview proxy** to API | Same-origin browser calls → minimal CORS; mirrors nginx path shape. | Two ports in dev (5173 vs 3000) confuse newcomers without README. | Consolidate behind one dev container with labels in UI. |
| **Plain-text chat rendering** | Strong default against XSS from model output (§6 SHOULD). | No rich markdown / links unless we add a vetted sanitizer. | Product needs formatted replies with safe markdown pipeline. |

### 14.7 Docker, nginx, and configuration

| Decision | Rationale | Tradeoff / cost | Revisit when |
|----------|-----------|-----------------|--------------|
| **nginx config baked into image** | Reproducible edge; reviewable in Git (§7). | Changing routing requires **image rebuild** (not a host-only hotfix). | Ops demands live-edited config maps without rebuild. |
| **Default `env_file` path `/opt/tenex-take-home/.env`** | Matches droplet layout from product discussion; explicit contract. | Local dev must set **`TENEX_ENV_FILE=./.env`** or symlink; CI must override similarly. | Standardize on dotenv in repo only + secrets manager injection. |
| **Ollama only on Docker internal network** | Avoids exposing unauthenticated inference (§6 MUST). | Cannot debug Ollama from laptop against prod host without SSH tunnel. | Dedicated private inference VPC with auth. |

### 14.8 Testing & CI tradeoffs

| Decision | Rationale | Tradeoff / cost | Revisit when |
|----------|-----------|-----------------|--------------|
| **`E2E_MODE` + mocked Google/Ollama + `/__e2e` bootstrap** | CI is **deterministic** and free of Google flakiness / quota. | **Does not prove** real OAuth callback, real Calendar quirks, or real model quality (**Flow 10** remains manual / staging—§13.3). | Invest in recorded Google sandbox org or contract tests against staging. |
| **Playwright `workers: 1`, `fullyParallel: false`** | One API process + in-memory sessions → avoids cross-test races. | E2E wall-clock slower as specs grow. | Move sessions to Redis + parallelize safely. |
| **Vitest `Fastify.inject` for API integration** | Fast, no real network sockets; easy mocks. | Not identical to TCP / TLS / nginx buffering edge cases. | Add smoke tests through real nginx in staging. |

### 14.9 Explicit PoC shortcuts (accepted debt)

| Shortcut | Why acceptable now | Pain signal to fix |
|----------|--------------------|----------------------|
| **In-memory** sessions + OAuth pending map | PoC scale (§1); simplest code path. **`consume()` prunes expired rows** to limit growth between OAuth starts. | Any multi-instance deployment or “why did everyone log out?” after deploy; sustained **`/auth/google`** spam can still grow memory until rate limits trip. |
| **No server-side chat history** | Spec did not require persistence; reduces GDPR-ish surface. | Users expect cross-device continuity or audit logs. |
| **No encrypted-at-rest refresh token store** | Harness allows PoC clarity; file/SQLite mentioned as optional upgrade (§5). | Compliance review fails or tokens on disk become a finding. |

### 14.10 Intentionally deferred

| Topic | Status | Trigger to implement |
|-------|--------|------------------------|
| **Horizontal scaling** of API | Not designed | Traffic > single droplet or zero-downtime deploy requirements. |
| **Redis / SQL session store** | Not implemented | Multi-instance or survival across restarts. |
| **Full OAuth callback E2E against Google** | Manual / staging (Flow 10) | Stable Google test org + secret rotation story. |
| **CDN for static assets** | nginx serves locally | Global latency or bandwidth costs dominate. |
| **Structured tool-calling loop** (model calls calendar tools) | Single-shot context today | Model repeatedly misreads JSON; tool loop improves grounding. |
| **API `PATCH`/`DELETE` for calendar events** | Not implemented; users edit/cancel in Google Calendar | Product requires in-app lifecycle for existing events without deep-linking. |

### 14.11 Dependency management (Yarn)

| Decision | Rationale | Tradeoff / cost | Revisit when |
|----------|-----------|-----------------|--------------|
| **Yarn 4 (Berry) + Corepack + `packageManager` in root `package.json`** | Pins the Yarn release team-wide; CI and Docker call **`corepack enable`** then **`yarn install --immutable`** for reproducible installs. | Contributors must use Yarn (or Corepack-resolved Yarn), not ad-hoc npm installs that would fight **`yarn.lock`**. | Monorepo outgrows Yarn or org standardizes on another manager. |
| **`nodeLinker: node-modules` in `.yarnrc.yml`** | Keeps a classic **`node_modules`** tree so tooling (Vitest, Vite, Playwright, Docker) behaves like typical Node repos without PnP-specific config. | Slightly larger disk use vs Plug’n’Play; no “zero-install” cache committed. | Willing to adopt PnP or a stricter linker for install speed or disk wins. |
| **Docker API runner: `yarn workspaces focus @tenex/api --production`** | After copying **`yarn.lock`** and both workspace **`package.json`** files, focuses install to **`@tenex/api`** prod deps only (similar spirit to **`npm ci -w … --omit=dev`**). | Requires both workspace manifests present in the image layer even though the web app source is omitted. | Image size or supply-chain scanning demands a slimmer, single-package install path. |

---

*End of harness — update this file when scope, infra, security posture, tests, or technical tradeoffs (§14) change.*
