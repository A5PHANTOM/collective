# Collective

An iPhone-first AI workspace using React/Vite, FastAPI, and SQLite. My Day brings assigned work together; Today, AI, Workspaces, and Inbox are the main tabs. Orders, projects, tasks, and team conversation live inside each workspace.

## Run

```sh
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
# Copy .env.example to .env only for a new installation; keep existing credentials.
npm start
```

`npm start` now starts the durable AI and notification worker automatically with the web server. No second terminal is needed for normal use. Add your API key to the existing `.env` file, then restart `npm start`:

```dotenv
GROQ_API_KEY=your_actual_groq_api_key
GROQ_MODEL=llama-3.3-70b-versatile
```

Do not put the key in chat, browser code, or a `VITE_` variable. The AI screen reports when the server has no key configured.

For a dedicated production worker, set `EMBEDDED_WORKER=false` on the web process and run `.venv/bin/python -m backend.worker` under a process supervisor. Both processes must use the same database and AI configuration. Queues and receipts survive restarts.

## Vercel deployment

The repository includes Vercel configuration for the Vite build and the FastAPI ASGI function:

```sh
npm install
vercel deploy
```

Set these server-side environment variables in the Vercel project before using the app:

```dotenv
GROQ_API_KEY=...
GROQ_MODEL=llama-3.3-70b-versatile
COOKIE_SECURE=true
DATABASE_PATH=/tmp/collective.sqlite3
EMBEDDED_WORKER=false
```

Vercel function storage is ephemeral, so the SQLite database is suitable only for a preview or single-instance demo. For production, migrate `DATABASE_PATH` to a durable hosted PostgreSQL or SQLite-compatible service, and run `backend.worker` separately as a durable worker or scheduled queue consumer. Do not upload `.env` or the local database; `.vercelignore` excludes both.

Admins can create a workspace directly from **Workspaces → New workspace**, then select its people under **Members → Save members**. To create accounts, open **People & spaces → Add member**. Member accounts can view workspace members but cannot change access or create workspaces.

For local development, run `npm run backend` and `npm run dev` separately. Set `DEV_ORIGIN=http://localhost:5173` when using that origin. Vite proxies API and PWA files. The production server serves the built frontend at http://localhost:3000. API docs: `/api/docs`.

Fresh-install login defaults are `admin@gmail.com` / `1234`; set `ADMIN_EMAIL` and `ADMIN_PASSWORD` before initializing a production database. Existing account credentials are preserved.

## Membership and existing data

All members can assign and update tasks in their workspace. AI, task home, task links, search, notifications, and channel tools require **explicit membership**, including for administrators. Administrators can manage membership through Account → People & spaces, including their own membership. Administrative access to legacy order management does not provide AI knowledge.

Existing identifiers, orders, tasks, activity, accounts, memberships, and shared AI history are preserved. Additive tables, indexes, and repeatable migrations run on startup. Shared AI history stays shared and is available through the existing workspace history API; it is never converted into private history. The old shared AI request endpoint is now read-only, with bounded recent context. Actions use private AI or structured channel mentions.

On the first database initialization only, the legacy `data/store.json` is imported transactionally. Later edits through the old Node application are not synchronized. Use `npm start`, not `node server.mjs`. Back up SQLite using its online backup API, or stop both server and worker before copying the database and WAL files.

## AI

Set these server-only values in `.env` and restart both processes:

```dotenv
GROQ_API_KEY=your_api_key
GROQ_MODEL=llama-3.3-70b-versatile
```

Keys never enter browser bundles. Provider calls use Groq’s chat completions API, with JSON mode for action plans. Override `GROQ_MODEL` to use another Groq model that supports JSON mode. If the model is retired or unavailable, the server checks Groq’s authenticated model catalogue and retries with an available supported text model. Reference: https://console.groq.com/docs/openai. Live documentation/provider access could not be verified in this environment because external DNS is unavailable; integration tests use mocked provider responses.

Use the microphone beside the AI message box to dictate in a supported browser (Chrome or Safari). Allow microphone permission, stop recording, then review and send the text. Voice recognition uses the browser’s speech service and requires HTTPS or localhost; keyboard input remains available.

Personal conversations belong to one account. Search covers authorized text in tasks, projects, orders, team messages, task activity, and order updates. SQLite FTS indexes update in the same transaction as source records. Requests use bounded search results, a limited attention list, and member/project directories. They do not send entire workspace histories or images. Summaries should cite retrieved source links and acknowledge incomplete search results.

Derived turns and drafts carry source-workspace references. If any source membership is revoked, the turn disappears from history and future model context. This deliberately conservative rule can hide a whole multi-workspace turn. Run status and draft saving also recheck access. Shared mutations get a fresh destination-only generation pass without private conversation history. Stored text is information, never authorization.

Supported actions: create/assign tasks, update deadlines/status/feedback, create/update projects, and draft captions or briefs. Drafts stay private until explicitly saved. Saving a draft derived from multiple workspaces is rejected; regenerate with the destination workspace selected. Select a workspace or identify its exact name/project name when there are multiple possible destinations. Ambiguous assignees and past deadlines prompt clarification. “This evening” is 6 PM in the browser timezone (Asia/Kolkata fallback), with an explicit receipt assumption.

AI requests use client-generated request IDs, durable queued/planned/completed states, leases, and reconnect polling. The worker persists its plan before execution. Each run commits mutations, activity, inbox events, receipts, and final result together. Failed actions roll back to savepoints and are reported separately. Reusing the same request ID returns the same run. Retry controls retain the ID; worker restarts resume saved plans without recreating completed tasks.

Team messages invoke AI only through the structured `AI` mention field (the @AI checkbox). Ordinary text containing “@AI” is insufficient. Bot replies carry their parent message ID and use only that workspace. Team drafts and personal chat are separate.

## PWA, HTTPS, and push

The manifest and 192/512px icons support Home Screen installation. The service worker caches only content-hashed JavaScript/CSS assets; authenticated API responses, uploaded images, HTML, and account data are not cached. This is not an offline task editor. Unsent text survives tab navigation; logout clears account-specific session state.

Use a trusted HTTPS reverse proxy for production. Set `COOKIE_SECURE=true` and forward the correct scheme/host to Uvicorn from a trusted proxy. HTTPS is required for push and service workers except localhost development. On iPhone, use Safari → Share → Add to Home Screen, then launch the installed app before enabling notifications. Supported iOS versions, installation, and user permission are required.

Install `pywebpush` from requirements, generate a P-256 VAPID key pair using trusted Web Push tooling, and configure:

```dotenv
VAPID_PUBLIC_KEY=base64url_uncompressed_public_key
VAPID_PRIVATE_KEY=/absolute/path/to/private_key.pem
VAPID_SUBJECT=mailto:your-operations-address@example.com
```

Keep the private key outside the public tree. The public key is exposed by the notification-preferences endpoint. Inbox → Enable notifications registers the current device. Assignment and reminder preferences apply per account; subscriptions apply per device. Signing out removes this browser’s subscription. Permission denial does not disable the inbox.

Assignment/reassignment events enqueue durable delivery jobs. The worker generates deadline reminders one hour before and at the deadline, suppresses completed tasks and stale deadlines, rechecks membership/preferences/subscription ownership before delivery, retries up to five attempts with bounded backoff, and removes expired subscriptions. A long outage skips an obsolete one-hour reminder. Push previews are generic. Tapping opens a task URL, which requires a valid session and current workspace membership. Push transport is at-least-once; stable notification tags coalesce a possible duplicate after a worker crash.

The push dependency could not be installed in this restricted environment. Install requirements on the deployment host before enabling push. Delivery logic is tested with a fake transport; real push needs device verification.

## Interfaces

- `GET /api/me/tasks`: pagination, assigned-by-me/completed filters, timezone grouping, workspace labels, counts.
- `GET /api/me/workspaces`, `GET /api/search?q=...&space=...`.
- `POST/GET /api/me/conversations`, `GET /api/me/conversations/{id}`.
- `POST /api/me/ai/runs`, `GET /api/me/ai/runs/{id}`, `POST /api/me/ai/runs/{id}/retry`.
- `POST /api/me/drafts/{id}/save`: explicit destination task ID.
- `GET/POST /api/spaces/{space}/thread`: structured mentions and parent references.
- `GET/PUT /api/me/notification-preferences`, `POST/DELETE /api/me/push-subscriptions`.
- Existing task/project/order/activity/notification APIs remain available.

## Verification and release checks

```sh
npm test
npm run build
```

Backend tests cover the nine existing behaviors plus task deduplication, transactional rollback, clarification, ambiguous assignment, revocation, scoped model context, private draft saving, channel isolation, provider failure/retry, worker restart, and reminders. A DOM integration test exercises the actual React app against an isolated FastAPI database. It is not a substitute for browser layout checks.

Still required on deployment: real provider smoke test; browser checks at 375, 390, 430px and desktop; physical iPhone Safari/Home Screen keyboard, landscape, and push checks; permission denial and expired real subscription checks; production LCP/CLS measurements. Targets are LCP <2.5s and CLS <0.1. Workspace/order/admin screens are lazy-loaded. No browser engine or physical iPhone is exposed in this session, so these targets are not claimed as verified.

Image generation, Instagram publishing, external Slack, and native apps are outside this release.

To repeat the DOM smoke test, install `jsdom` in your test environment, then run `node scripts/check-ui.mjs`. If it is installed outside this project, set `JSDOM_PATH` to its package directory. The script uses `scripts/ui_bridge.py` and a temporary SQLite database; it does not modify live data. Current verification: **25 backend tests, production build, and DOM integration pass**.

## AI retrieval and performance

The backend uses SQLite FTS5 for text retrieval, not a vector database. Structured task and membership data stays in SQL so access checks, counts, deadlines, and assignments remain exact.

- Common greetings, pending-task questions, and member-list questions use a conservative exact-intent route with no Groq call. Compound or unfamiliar wording goes to the planner. Every lookup applies current workspace memberships.
- Generative context contains at most eight 700-character search snippets, 15 personal tasks, 20 pending tasks, and four compact conversation turns. The serialized retrieval context and history are capped at 24,000 characters; this is a character limit, not an exact token limit. The system prompt and current request are additional. Truncation is explicitly reported to the model. Large member directories require selecting a workspace rather than silently dropping identities.
- Database projections and partial indexes limit the cost of pending-task lookups. Exact counts are separate from bounded lists. No answer cache is used, so task changes and access revocation are read fresh.
- Shared actions still receive a destination-only generation pass when private history or multiple workspaces were involved. A single-workspace request without private history avoids that redundant call. Mutation validation, transactional receipts, and idempotency remain in place.
- The worker reuses Groq HTTPS connections, immediately drains available queue items, and checks an idle queue every 250 ms. Notification processing runs separately from AI processing. AI runs remain serial per worker; UI polling and provider latency still affect visible response time.
- Successful model selection is cached for five minutes, keyed by a SHA-256 digest of the API key and configured model, with at most 128 entries. Unavailable-model responses invalidate the selection. Responses and workspace content are not cached.
- The `backend.groq_api` INFO logger records model, elapsed provider time, and Groq-reported prompt/completion tokens, without logging keys or prompt content. Enable that logger in your deployment logging configuration to measure real usage.

For a future large document corpus, add asynchronous chunking and embeddings, then hybrid FTS/vector retrieval with workspace filtering before ranking and a final membership check. Vector search is useful for semantic recall, but should not replace SQL for task counts, membership, deadlines, or action authorization. No embedding provider or vector service is required by the current application.
