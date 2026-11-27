# Architecture

This document describes the architecture of the Handoff monorepo. For coding rules, see `RULES.md`. For product context, see `PRODUCT.md`.

---

## Overview

Handoff is a full-stack TypeScript monorepo using Bun as the runtime and Nx as the orchestrator. The backend is an Elysia REST API that compiles to a standalone binary. The frontend is a TanStack Start SPA (client-side rendered, no SSR) that runs on Nitro.

**End-to-end type safety** is provided by Elysia's Eden Treaty — no code generation, no shared types package. The API exports `type App = typeof app`, and the frontend imports it as a type-only dependency.

---

## Directory Structure

```
ultra-handoff/
├── apps/
│   ├── api/                    # Backend (Elysia, Bun)
│   │   └── src/
│   │       ├── index.ts        # App entry, route registration, type export
│   │       ├── db/
│   │       │   ├── index.ts    # Drizzle client
│   │       │   └── schema.ts   # Database schema (single source of truth)
│   │       ├── routes/         # Route handlers (one file per resource)
│   │       ├── services/       # Business logic (no HTTP concerns)
│   │       ├── middleware/     # Auth, logging, error handling
│   │       └── lib/            # Shared utilities (validation, helpers)
│   └── web/                    # Frontend (TanStack Start, React 19)
│       └── src/
│           ├── routes/         # File-based routes (TanStack Router)
│           ├── components/     # Shared app-specific components (used by 2+ features)
│           ├── features/       # Feature modules: each owns its components, hooks, store, api calls
│           │   └── <feature>/
│           │       ├── api.ts       # Feature API calls (endpoints, fetch wrappers)
│           │       ├── store.ts     # Feature state (TanStack Store)
│           │       ├── hooks.ts     # Feature hooks
│           │       └── *.tsx        # Feature components
│           ├── hooks/          # Shared custom React hooks
│           ├── lib/
│           │   ├── api.ts      # Eden Treaty client (all API calls go here)
│           │   └── utils.ts    # Helpers
│           └── types/          # Web-specific types (extends API types)
├── packages/
│   ├── ui/                     # shadcn/ui component library
│   ├── biome-config/           # Shared Biome config
│   └── tsconfig/               # Shared TypeScript configs
├── compose.yaml                # Production Docker stack (project: ultra)
├── compose.dev.yaml            # Development Docker stack with watch (project: ultra-dev)
├── opencode.json               # MCP server config + permissions
├── RULES.md                    # All coding rules (25 rules)
├── PRODUCT.md                  # Product overview and vision
├── AGENTS.md                   # Architecture, tech stack, conventions
└── README.md                   # Project overview and quick start
```

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Runtime | Bun | 1.4.3 (isolated linker) |
| Orchestration | Nx | 23.2 |
| Backend framework | Elysia | 1.4.30 |
| ORM | Drizzle ORM | 0.45.4 |
| Database | PostgreSQL | 18.6 |
| DB driver | postgres (postgres-js) | 3.4.9 |
| Frontend framework | TanStack Start | 1.169.3 |
| React | React | 19.3.1 |
| Build tool | Vite | 8.3.4 |
| Production server (web) | Nitro | 3.0.260903-beta |
| Styling | Tailwind CSS | 4.3.3 |
| UI library | shadcn/ui | aria-sera style |
| Linter/Formatter | Biome | 2.4.5 |
| TypeScript | TypeScript | 6.0.3 |
| Container base | oven/bun | 1.4.3-slim (Debian 13 trixie) |

---

## Type Safety — Eden Treaty

End-to-end type safety is provided by Elysia's Eden Treaty (`@elysia/eden`). No code generation, no shared types package.

### Backend (apps/api/src/index.ts)

```typescript
const app = new Elysia()
  .get("/", () => "Hello Elysia")
  .get("/health", () => ({ status: "ok" }))
  .get("/users", async () => db.select().from(users))
  .listen({ port, hostname });

export type App = typeof app;  // export the type for frontend consumption
```

### Frontend (apps/web/src/lib/api.ts)

```typescript
import { treaty } from "@elysia/eden";
import type { App } from "@org/api";  // type-only import, erased at compile time

export const api = treaty<App>("http://localhost:3001");
```

### Usage in components

```typescript
const { data, error } = await api.users.get();
// data: { id: number; name: string; email: string; createdAt: Date }[]
// error: typed by status code (400, 401, 404, etc.)
```

### How the type import works

1. `@org/api` is added to `apps/web/package.json` as a devDependency (`workspace:*`).
2. The API's `package.json` has `"types": "src/index.ts"` so TypeScript resolves the `App` type.
3. Bun's isolated linker creates the workspace symlink.
4. The import is `import type` — completely erased at compile time. The web bundle has zero runtime dependency on the API.

---

## Data Flow

```
Browser (React component)
  │
  ▼
apps/web/src/lib/api.ts  (Eden Treaty client)
  │  HTTP fetch to localhost:3001
  ▼
apps/api/src/index.ts    (Elysia app)
  │  route handler
  ▼
apps/api/src/services/   (business logic)
  │
  ▼
apps/api/src/db/         (Drizzle ORM)
  │
  ▼
PostgreSQL 18
```

### Request/Response Cycle

1. Component calls `api.users.get()` (typed by Eden Treaty).
2. Treaty serializes the request and sends an HTTP fetch to the API.
3. Elysia route handler receives the request, validates input.
4. Service layer executes business logic.
5. Drizzle ORM queries PostgreSQL.
6. Response flows back through the same chain, fully typed.

---

## Module Boundaries

| Concern | Location | Rule |
|---|---|---|
| Database schema | `apps/api/src/db/schema.ts` | Only place for DB table definitions |
| Business logic | `apps/api/src/services/` | No HTTP concerns (no request/response objects) |
| HTTP routes | `apps/api/src/routes/` | Thin handlers, delegate to services |
| Validation | `apps/api/src/lib/validation.ts` | Zod schemas for request validation |
| Shared UI components | `packages/ui/src/components/ui/` | Reusable across apps |
| Shared app-specific components | `apps/web/src/components/` | Used by 2+ features, web only |
| Feature modules | `apps/web/src/features/<feature>/` | Each feature owns its components, hooks, store, and API calls |
| Custom hooks (shared) | `apps/web/src/hooks/` | React hooks shared across features |
| API client | `apps/web/src/lib/api.ts` | All API calls go through here |
| Web-specific types | `apps/web/src/types/` | Extends API types if needed |

### Rules

- **No shared runtime code between apps.** Only types are shared via Eden Treaty. Apps never import from each other's source code.
- **Database is single source of truth.** Drizzle schema is the canonical data model. Types are derived via `$inferSelect` and `$inferInsert`.
- **No direct DB access from web.** All data flows through the API.

---

## Notifications, Reminders and Push

Notifications are workspace scoped and addressed to one person. The
`notification` table stores the recipient, the subject ids and a dedupe key.
The bell reads only that person's rows through a recipient-scoped RLS policy.
Writing is cross-user by nature, so the insert policy is workspace scoped while
reads, updates and deletes stay recipient scoped. The writer temporarily scopes
the transaction to the recipient for the insert so `RETURNING` can echo the new
row, then restores the actor before the rest of the transaction runs.

Message read state is a monotonic cursor per thread root in
`comment_thread_read`. The oldest unread message is derived from the cursor and
the person's project membership date, so joining a project with history does
not create a backlog.

Reminder sweeps run hourly. Each recipient's `user.timezone` decides their
local day and the 09:00 eligibility window. Overdue reminders fire on day 1, 7,
14 and 21.

Browser alerts use the page Notification API while the app is open and Web Push
with `apps/web/public/sw.js` when the tab is closed. Push subscriptions live in
`push_subscription`, which is personal data protected by a user-only policy and
`withUser`, not the tenant policy.

## Direct Messages

Conversations are workspace scoped, not project scoped, and they are stored
apart from milestone comments.

- `conversation` holds the scope (`direct` today, `group` and `project` later),
  an optional project, a title, the canonical `pair_key` for a direct pair, and
  the denormalised newest message.
- `conversation_participant` holds one row per person with their read cursor.
  The unique `(conversation_id, user_id)` index is the participation check.
- `conversation_message` holds the Plate body and its plain text mirror, plus a
  `client_nonce` with a unique index. A retried send returns the original row
  instead of posting twice.

Why not reuse `comment`: a comment is a milestone timeline entry. It carries
events, one level of replies and a required milestone id. A conversation has
participants, a sequential read cursor and no events. Sharing the table would
have forced a scope column, a relaxed target check and two index families on
the hottest discussion table.

Access is enforced by Postgres, not only by the service:

- `conversation` insert is workspace scoped; select and update require an
  existing participant row for the current user.
- `conversation_participant` select is workspace scoped so a reader can see the
  other person's cursor for the read receipt; update and delete are self only.
  Explicit policies per command are used instead of `tenantIsolation`, because
  a permissive `for all` policy OR-ed with the self rule would widen it.
- `conversation_message` select and insert require participation; update and
  delete require the author.

Unread is computed, never stored. A stored counter would have to be written by
the sender into the recipient's row, which the self-only participant update
policy forbids. The list does a capped count over the message index, prefixed by
`conversation.last_message_at > participant.last_read_at`, so a fully read chat
costs no message scan.

### Threads

A message with `conversation_message.parent_id` set is a reply. Replies are one
level deep and never appear in the main timeline; the timeline shows roots with
a reply count and an unread reply dot. The focused thread route
`/messages/:conversationId/threads/:rootId` renders the root and its replies,
and open threads are kept as tabs in local storage.

Read state uses two cursors. The conversation cursor covers roots. A thread
cursor in `conversation_thread_read` covers one root and its replies, so opening
the conversation never marks a thread read. Unread is the count of roots after
the conversation cursor plus replies after their thread cursor. Both writes copy
the message's exact `created_at` inside SQL, because a JavaScript `Date`
round-trip truncates microseconds and leaves a message unread forever.

Realtime rides the existing personal socket. `conversation.message.created`,
`.updated`, `.deleted` and `conversation.read` are published to every active
participant, so the author's other tabs stay in sync. Typing is ephemeral: an
inbound `dm.typing.start` is validated against participation and relayed to the
other participant, or to every other member of a channel. Milestone typing uses
the same event names on the project socket.

Notifications use one bell row per conversation per recipient, dedupe key
`dm:{conversationId}`. The writer scopes the transaction to the recipient for
the upsert, the same cross-user pattern the comment writer uses, and bumps
`created_at` so an active conversation rises in the bell. Reading the
conversation clears that row when the cursor covers the newest message. Push is
coalesced per conversation because the notification row id is stable across
refreshes.

Search uses a trigram GIN index on `body_text` for both conversations and
milestone comments. The message list supports `before`, `after` and `around`
cursors, so a search hit opens the page that contains it.

## Group Channels

A channel is the same `conversation` row with `scope = 'group'`, so it reuses
the message, thread, search and read cursor code without a second model. It adds
four columns: `visibility` (`public` or `private`), `description` (the topic),
`archived_at` and `member_count`.

Membership is a `conversation_participant` row. The creator is an `owner`, the
people they add are `member`, and `left_at` marks a row that left the channel.
A left row keeps its read cursor, so a rejoin restores the same history position
instead of starting over or marking everything read.

Rules enforced by the service, with RLS as the backstop:

- Any workspace member may create a channel. Channel members are always current
  workspace members, never guests.
- A public channel is readable by the whole workspace for the directory and
  self joinable. A private channel is readable only by its participants and is
  joinable only by being added.
- The last active owner cannot leave or be removed. Archiving is the escape.
- Owners manage the name, topic, visibility, members and archive state. Authors
  alone edit or delete a message, in a channel and in a direct chat alike.
- An archived channel is read only and leaves the rail and browse. It stays
  listed under `/channels/archived` so an owner can find it again and restore
  it. It is never hard deleted, so the delivery record survives.
- A channel name is unique per workspace and visibility, case insensitive,
  among channels that are not archived. Visibility is part of the key so a
  public create cannot confirm that a private channel already uses a name. The
  partial unique index is the concurrency guard.
- Removing a person from the workspace detaches them from every group channel
  they were in, recomputes the counts, promotes the earliest remaining member
  when they were the last owner, and archives a room that nobody is left in.
  Direct conversations keep their row so the other person still sees the read
  only "no longer in this workspace" state.

The directory is three reads: `/channels` returns every joined channel
including one with no messages yet, `/channels/browse` returns public channels
with a member count and a joined flag, and `/channels/archived` returns the
channels the viewer still belongs to that an owner archived. Browse is paged
with a keyset cursor over member count, name and id, so a big workspace cannot
silently truncate. The direct message list stays on `/conversations`, which now
returns direct conversations only.

Realtime adds `conversation.updated` for metadata changes and
`conversation.member.changed` for an add or a removal. Message events still fan
out to every active participant on the personal socket, and typing is relayed
to every active participant except the sender.

Notifications use type `group_message` and dedupe key
`channel:{conversationId}`, one row per channel per recipient. A muted
participant still accrues unread but receives no bell or push. The copy and the
href read the channel title from the joined row, so a rename is reflected in an
old bell entry. A message notification is hidden from the list and from the
unread count once the recipient is no longer an active participant, so leaving
or being removed cannot strand an unread row that opens a 404.

Participant rows are workspace readable because a policy that read that table to
check the caller would recurse. The service is therefore the read boundary, and
the policy comments in `db/schema/conversation.ts` state it as an invariant.
Insert is self only: a cross user row is written by switching the transaction
user with `withTargetUser`, the same pattern the notification writer uses.

A channel accepts at most 100 members. That cap is the notification fan out
boundary: the send transaction writes one bell upsert per notifiable recipient,
so raising the cap needs a batched writer first.

## Project Messages

A project room is the same `conversation` row with `scope = 'project'`, so it
reuses the message, thread, search, read cursor and realtime code. It adds one
rule: membership is derived from the project, never managed by hand.

- One room per project. The id is derived as `project-<projectId>` and a partial
  unique index on `project_id` where `scope = 'project'` is the concurrency
  guard. A project that never opens the tab has no room.
- The first open creates the room and reconciles the participant list. That list
  is the project Overview list: explicit `project_member` rows plus organization
  owners, who always own every project. Clients are included.
- Adding a project member adds or reactivates their participant row. Removing a
  project member sets `left_at`, so history stays but access is revoked. A
  reactivated row keeps its read cursor.
- An archived project mirrors `archived_at` onto its room. The room is read only
  until the project is restored. Deleting a project cascades the room and its
  messages.
- `GET /projects/:projectId/conversation` opens or ensures the room. It is
  idempotent, and the derived id means a concurrent open has no row to look up
  before the caller is a participant. `GET .../conversation/unread` returns the
  tab dot count without creating the room.
- Message access is still the participant row, with `requireConversation`
  re-checking project visibility for a project scope as a safety net against a
  missed sync. The room metadata is also readable by project members so a
  project admin can reconcile the roster before they hold a participant row.
  Message bodies stay participant only.
- Notifications use type `project_message` and dedupe key
  `project:{conversationId}`, one row per project per recipient. The row carries
  `project_id`, so project visibility hides it with the project, and its href
  opens the project Messages tab with `?thread=` for a reply.
- The room appears in the project tab only, not in the `/messages` inbox. The
  tab dot is read from the unread endpoint and refreshed by the personal socket.

## Authentication Flow (Planned)

When authentication is added:

1. Better Auth will be integrated into the Elysia API (`apps/api`).
2. The web app will use Better Auth's client SDK for session management.
3. Protected routes in TanStack Start will check auth state before rendering.
4. API routes will use middleware to verify auth tokens.

---

## Organization Switch Safety

> **IMPORTANT:** Every change of the active organization must go through `useSwitchOrganization` in `apps/web/src/features/organization/switch.ts`. Never call `authClient.organization.setActive` directly. Long running organization work must be wrapped with `beginOrganizationOperation`.

Better Auth stores `activeOrganizationId` on the shared session, not per tab. Two tabs therefore share one active organization, and a long operation in one tab can be interrupted when the user switches organization in another tab.

### Operation registry

`apps/web/src/features/organization/switch-guard.ts` records long running operations in localStorage:

- One key per operation, never one shared registry key, so two tabs starting at the same time cannot overwrite each other.
- Every entry carries `organizationId`, a user facing `reason`, `startedAt` and `expiresAt`.
- A heartbeat refreshes `expiresAt` while the operation runs.
- Expired entries are pruned on read, so a crashed or closed tab stops blocking after the TTL.
- The block is scoped to the organization that owns the operation. An operation in one workspace never blocks a switch between two other workspaces.
- Only leaving the busy workspace is blocked. Entering it from another workspace is not dangerous for the operation.

### Guarded flows

- The organization switcher.
- Creating an organization, specifically the switch that follows it.
- Leaving an organization.
- Deleting an organization.
- Logo upload and removal.

The guard is evaluated when the user acts. The switcher and create flow call `useSwitchOrganization`; leaving and deleting call `getBlockingOperation` first. A blocked action opens `SwitchBlockedDialog` with the operation's reason instead of proceeding.

### Rules for new features

Wrap any long running organization operation:

```ts
const operation = beginOrganizationOperation({
  organizationId,
  organizationSlug,
  reason: "Sending invitations to 12 people",
});

try {
  await doWork();
} finally {
  operation.end();
}
```

- Use `useSwitchOrganization` for every active organization change, including accepting an invitation.
- Always pass an explicit `organizationId` to organization scoped mutations. The guard is a UX safety net, not the data correctness mechanism.
- Move bulk work to a server job when it must survive a tab reload, a crash, or another device. localStorage is local to one browser profile.
- Keep the `reason` user facing. It is shown in the blocked dialog.

### Limits

- The registry is browser local, not cross device.
- It does not replace server side authorization.
- A switch that bypasses the helper bypasses the guard.

---

## Deployment Architecture

```
┌─────────────────────────────────────────────────┐
│  Docker Compose (project: ultra)                │
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ postgres │  │ migrate  │  │    api        │  │
│  │ (18.6)   │  │ (one-shot│  │ (compiled    │  │
│  │          │  │  job)     │  │  binary)     │  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
│       │             │               │          │
│       └─────────────┴───────────────┘          │
│                     │                          │
│              ┌──────┴──────┐                   │
│              │     web     │                   │
│              │  (Nitro)    │                   │
│              └─────────────┘                   │
└─────────────────────────────────────────────────┘
```

- **API:** Single compiled binary (~96 MB), no node_modules, runs as non-root `bun` user.
- **Web:** Nitro bundle (`.output/`), no node_modules, serves SPA shell + static assets.
- **Postgres:** Official `postgres:18.6-alpine3.24` image with named volume.
- **Migrate:** One-shot job using the `dev` stage (needs drizzle-kit), runs before API starts.

---

## Development Workflow

1. `bun run docker:dev` — starts all services with hot reload.
2. Edit source files → Compose `develop.watch` syncs changes into containers.
3. Edit `package.json` or `bun.lock` → triggers image rebuild (deps layer cached).
4. `bun run db:generate` — generate migration from schema changes.
5. `bun run db:migrate` — apply migrations (runs automatically in dev compose).
6. `bun run db:studio` — open Drizzle Studio for visual DB browsing.

### Local development (without Docker)

```bash
bun install
cd apps/api && bun run dev    # port 3001
cd apps/web && bun run dev    # port 3000
```

---

## Conventions

- **SPA mode** — no SSR. All rendering on client. Server functions are thin proxies.
- **Conventional commits** — `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `style:`
- **Import order** — external → internal (`@org/*`) → relative
- **No em dashes** in any text
- **Comment everything** — file headers + logic blocks
- **Never commit to `main`** — always use a feature branch
- **Biome** handles formatting, linting, import sorting
- **Nx** for task running: `bunx nx run-many -t build`, `bunx nx run api:build`
- **Eden Treaty** for type safety — no shared types package, no code generation
