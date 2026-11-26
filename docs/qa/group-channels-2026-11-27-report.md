# QA Report: Group Channels

Date: 27 Nov 2026
Branch: `feature/group-messages`
Commit tested: `e703b6e docs: document group channels and add the QA plan`
Environment: Docker dev stack (`ultra-dev-*`), web on `localhost:3000`, API on
`localhost:3001`, PostgreSQL 18, Redis 8, Chrome DevTools MCP
Migrations applied: `0035_last_mastermind.sql`, `0036_needy_dracula.sql`,
`0037_special_havok.sql`

## Verdict

Not release ready. The core channel model, access rules, messaging, realtime fan
out and UI all work in the tested flows, but the pass found four functional
defects and three product or security gaps that need a decision before merge.
The functional defects are QA-GC-001 (schema defaults), QA-GC-002 (restore
collision), QA-GC-004 (stale bell) and QA-GC-007 (member count drift). The gaps
are QA-GC-003 (archived channels cannot be found again), QA-GC-005 (RLS
participant visibility) and QA-GC-006 (private name disclosure).

The most important defect is in the request schemas: Elysia's `t.UnionEnum`
injects its first value as a default, so a visibility or role field that the
caller leaves out is silently replaced with `"public"` or `"owner"`. In testing
that made an empty settings PATCH turn a private channel public, an empty role
PATCH promote a member to owner, and a create without `visibility` produce a
public channel. The same helper is already handled correctly in
`apps/api/src/routes/milestones/schemas.ts`, so the fix is small and proven.

No production code was changed in this pass. This is a report only.

## Scope

Reviewed and exercised:

- Channel creation, public and private, with and without members
- Name rules: length, control characters, leading hash, case-insensitive
  uniqueness, whitespace collapse, duplicate names, freed archived names
- Channel directory: joined list, public browse, search, joined flag
- Join, leave, rejoin, cursor retention, removed member, workspace removal
- Owner management: rename, topic, visibility, add, remove, promote, demote,
  archive, restore, mute, unmute, last owner protection
- Message send, idempotent nonce retry, edit, delete, thread root and reply,
  reply to deleted, author-only rules
- Unread counting across roots and replies, read cursor, thread cursor, bell
  clearing
- Notification coalescing, mute suppression, rename copy, thread deep link,
  stale bell after leave or removal
- Realtime: typing across several members, message fan out, metadata events
- Member cap of 100, validation boundaries, rate limiting
- RLS policies for conversation, participant and message rows
- UI at 1440x900 and 390x844: empty state, create, browse, join, settings,
  archive, restore, unread badges, mute, bell, thread panel

## Approach

1. Code review of the schema, channel services, channel routes, message send
   and notification writers, realtime gateway, web API layer, cache reducers,
   hooks, and every channel component.
2. A scripted end-to-end suite against the live API as real Better Auth users
   in a dedicated workspace (101 assertions across two passes).
3. Targeted probes for the suspected schema default behaviour, name reuse,
   stale notifications, and RLS boundaries.
4. Two user testing: the Chrome session acted as the owner while a second
   member sent messages and typing frames over HTTP and WebSocket.
5. Live UI testing through Chrome DevTools at desktop and mobile widths, with
   screenshots, console and network checks.
6. Database verification of participants, member counts, messages, read cursors
   and notification rows.

## Automated checks

| Suite | Result |
|---|---|
| API unit suite (`bun test`) | 534 pass, 151 skip, 0 fail |
| Web unit suite (`bun test`) | 142 pass, 0 fail |
| API typecheck | clean |
| Web typecheck | clean |
| Biome check and format | clean |

The unit suites do not cover the channel routes end to end. The scripted suite
below is the first pass that exercised the real HTTP surface, the RLS policies
and the realtime gateway together.

## Scripted end-to-end results

101 assertions were executed. The first pass ran 85: 80 passed, 5 failed. Of the
5, two were genuine defects, two were mistakes in the harness expectation (a
mistyped search term, and a rejoin check that also counted an unread thread
reply), and one was an acceptable 404 instead of 400 for joining an archived
channel that is hidden from browse. The second pass added 15 targeted
confirmations of the suspected gaps, and one follow-up probe confirmed the role
default.

### Passed areas

| Area | Examples that passed |
|---|---|
| Create | Public and private creation, member count, participants, `canManage`, leading hash stripped, blank name rejected, 81 characters rejected, invalid visibility rejected, outsider id rejected |
| List and browse | Joined list includes empty channels, private channel absent from browse, public row with `joined=false`, case-insensitive search, LIKE wildcard escaped |
| Access | Private channel hidden from a non-member on detail, messages and search, public join, public detail after join |
| Permissions | Plain member blocked from rename, archive, add, remove and role change with 403 |
| Settings | Duplicate rename rejected, case-only rename allowed, topic set and cleared, 281 character topic rejected, 100 member ids rejected, name of only hashes rejected |
| Messages | Root send, nonce retry returns the original row, three unread, delete preview, deleted message not unread, author edit and delete, foreign edit and delete 403, reply to deleted 400 |
| Read state | Mark read clears unread and the bell, opening a thread clears reply unread and the bell |
| Mute | Unread still rises, no new bell row, unmute restores the setting |
| Leave and rejoin | Left member loses read and send access, rejoin restores history and cursor |
| Owner rules | Last owner cannot leave, owner cannot remove themselves, removing a non-member is 404, promote, demote, last owner cannot demote themselves |
| Archive | Leaves the joined list and browse, read only, join blocked, settings blocked, non-owner restore 403, restore works, sending works after restore |
| Cap | Join at 100 rejected, add past the cap rejected, join works after a slot frees |
| Workspace removal | Tenant blocks the removed person, send still succeeds for the rest, no bell row for the removed person |
| Isolation | Another workspace cannot read a channel by id, non-member cannot use the slug |
| Rate limit | The 11th create in a minute is 429 |
| Realtime | Typing start and stop reach another member, a message reaches another member, archive publishes `conversation.updated` |
| UI | Create, browse, join, rename, topic, promote, remove, mute, archive, restore, unread badge, bell, deep link, thread panel, mobile layout |

## RLS probes

Run as `app_tenant` with `app.current_org_id` and `app.current_user_id` set to a
workspace member who is not in the target private channel.

| Probe | Expected | Actual |
|---|---|---|
| Select a private channel row | 0 rows | 0 rows |
| Select a public channel row | 1 row | 1 row |
| Select the participant rows of a private channel | 0 rows in the old QA plan | 1 row, workspace visible by design |
| Update another member's role as a non-owner | 0 rows | 0 rows |
| Select messages of a channel after removal | 0 rows | 0 rows |
| Insert a participant row for a private channel as a non-owner | Service only | Allowed by RLS, service blocks the route |

## Findings

### QA-GC-001: `t.UnionEnum` defaults defeat required and optional fields (High)

Files: `apps/api/src/routes/channels/schemas.ts:44`, `:58`, `:71`

Elysia's `t.UnionEnum` sets `default: values[0]`. TypeBox then materialises that
default before the handler runs. In the channel schemas this produced three
symptoms, all verified against the live API:

| Request | Expected | Actual |
|---|---|---|
| `PATCH /orgs/:s/conversations/:id` with `{}` | 400 "There is nothing to change." | 200, private channel became public |
| `PATCH /orgs/:s/conversations/:id/members/:uid` with `{}` | 422, role is required | 200, member promoted to owner |
| `POST /orgs/:s/channels` without `visibility` | 422, visibility is required | 200, channel created public |

The "nothing to change" guard in `updateChannel` is therefore unreachable. The
web UI always sends both fields, so the current UI flows are safe, but the API
contract is not. Any future client, integration or hand written request can
silently widen a private channel.

Fix: pass an explicit `default: undefined` to every `t.UnionEnum` in this file,
and wrap the optional one in `t.Optional`. This is the same fix already
documented in `apps/api/src/routes/milestones/schemas.ts:87-93`.

```ts
visibility: t.UnionEnum(["public", "private"], { default: undefined }),
// settings:
visibility: t.Optional(t.UnionEnum(["public", "private"], { default: undefined })),
// role:
role: t.UnionEnum(["owner", "member"], { default: undefined }),
```

Add a route test that sends `{}` and a create without visibility.

### QA-GC-002: Restoring a channel whose name was reused returns 500 (High)

File: `apps/api/src/services/conversation/channels/settings.ts:140-168`

Steps that reproduce it:

1. Create public channel `reuse-name`.
2. Archive it. The partial unique index stops covering it, so the name is free.
3. Create another public channel named `reuse-name`. This succeeds.
4. Restore the first channel. `setChannelArchived` clears `archived_at` with no
   title check, the partial unique index rejects the update with `23505`, and the
   route answers 500 with "Could not restore the channel."

The same collision is possible if the name is reused by a rename. Fix: before
clearing `archived_at`, call `assertTitleAvailable(tx, org, currentTitle, id)`,
and catch `isUniqueViolation` around the update to answer 409 or 400. A route
test should archive, reuse, then restore.

### QA-GC-003: An archived channel cannot be found again (High, product gap)

Files: `apps/api/src/services/conversation/channels/directory.ts:60-65`,
`apps/web/src/components/app-sidebar/nav-messages.tsx`

Archiving removes the channel from the joined list and from browse. No endpoint
or UI lists archived channels. The open pane keeps working, and its settings
dialog shows Restore, so restore works only while the tab is still on that
channel. Navigate away or reload the app and the channel is gone from every
list. Verified in the browser: after archive the sidebar said "No channels yet"
while the archived channel was still open in the main pane.

This makes the archive action effectively one way for normal users. Fix one of:

- Include archived channels in `listChannels` with `archivedAt` set, sorted
  after active ones, and let the existing read only state and Restore button do
  the rest. This is the smallest change because the UI already renders it.
- Add `GET /orgs/:slug/channels/archived` and an "Archived" disclosure in the
  rail or a tab in the channel dialog.

Either way add a UI case: archive, navigate to Messages, find the channel,
restore.

### QA-GC-004: A bell row outlives the channel membership (Medium)

Files: `apps/api/src/services/conversation/channels/membership.ts` (leave and
remove), `apps/api/src/services/notification-query/scope.ts`

Clearing a channel bell row happens only when the reader marks the channel read.
Leaving or being removed never clears it, and the notification query does not
check that the reader is still an active participant. Verified:

- Outsider left `public-hub`, `GET /channels` returned 0 channels and
  `unreadTotal` 0, but the bell still reported `unread: 1` with a
  `group_message` row for that channel.
- The owner removed a member, the member got 404 on the channel, and their bell
  row stayed unread.

Clicking the stale row opens a channel that answers 404, and the pane redirects
back to Messages. Fix: add a conversation visibility predicate to
`notificationScope` for `direct_message` and `group_message` (an `EXISTS` on an
active participant row for the recipient), mirroring `projectVisibility`. That
hides stale rows from both the list and the unread count without a delete. A
second option is to mark the row read during leave and removal with the target
scope, but the query predicate also covers workspace removal.

### QA-GC-005: Participant rows are workspace visible and insertable (Medium, RLS risk)

Files: `apps/api/src/db/schema/conversation.ts:355-373`

The select policy on `conversation_participant` is workspace wide. That was a
deliberate fix for Postgres recursion, and the comment explains it. The risk is
that the RLS layer no longer protects the private channel roster or the
participant insert: the probe above showed a workspace member can read another
private channel's participant rows and can insert themselves as a participant
at the database level. Every current route checks membership first, so this is
not an exploit today, but it is a defense in depth regression for any future
route that writes participants.

Recommendation: keep the current policy (the recursion is real), document it as
an invariant in the schema and in `ARCHITECTURE.md`, and add an automated test
that asserts no route can reach `conversation_participant` writes without the
service checks. At minimum update the QA plan, whose RLS-04 still expects 0
rows for this probe.

### QA-GC-006: A private channel name leaks through the duplicate error (Medium)

Files: `apps/api/src/services/conversation/channels/shared.ts:135-163`,
`apps/api/src/db/schema/conversation.ts:187-189`

Channel names are unique per workspace across public and private channels. A
workspace member who creates a channel named `top-secret-<name>` gets 400 "A
channel with that name already exists" when a private channel already uses that
name, which confirms the private name. Verified.

Options: scope uniqueness by visibility, return the same generic message for a
duplicate in a private channel, or accept it as product behaviour and document
it. Slack keeps one namespace, so accepting it is defensible, but it should be a
decision, not an accident.

### QA-GC-007: `member_count` drifts after a workspace removal (Medium, known)

Files: `apps/api/src/services/conversation/channels/create.ts:117-132`,
`shared.ts:34-68`

A workspace member who is still a channel participant is skipped for bells and
fan out, but no membership change runs, so `member_count` keeps counting them.
Verified: the channel showed 2 members while only one active workspace member
remained. At the 100 member cap this inflated count can block a legitimate join
or add. It is already listed as a known limit, but the cap interaction makes it
more than cosmetic.

Fix: refresh the count when a workspace member is removed, or compute
`member_count` in browse from active workspace members instead of trusting the
denormalised column. Also refresh on removal from the workspace in the member
service.

### QA-GC-008: Add members validates input before ownership (Low)

File: `apps/api/src/services/conversation/channels/membership.ts:208-221`

`addChannelMembers` calls `assertWorkspaceMembers` before `requireGroupOwner`,
so a plain member who sends an unknown id gets 400 "One of those people is no
longer part of this workspace" instead of 403. Any workspace member can already
list workspace members through the contact picker, so the disclosure is small,
but the ordering is wrong. Check ownership first, then validate the ids.

### QA-GC-009: Escape in the member picker clears the selection (Low)

File: `packages/ui/src/components/ui/multi-select.tsx`

In the create dialog, with two members selected, the first Escape cleared both
selections and left the popover open. A second Escape closed it. The component
comment says Escape closes. This affects the channel create and settings member
pickers and the project member dialog. Reproduced in Chrome; clicking the
trigger again closes while keeping the selection, so the mouse path is fine.
Fix: handle Escape at the popover level to close without committing an empty
selection, or make the selection draft state commit on close.

### QA-GC-010: Channel caches rely on the realtime echo (Low)

Files: `apps/web/src/features/messages/hooks.ts:292-359`

Channel edit, delete and read mutations patch only the direct message caches.
The channel rail preview and section badge are corrected by the
`conversation.read` and message echoes. If the socket is down, a read or an edit
leaves the rail stale until the next refetch. The direct path updates its cache
directly. Add `channelsKey` invalidation or `withChannelUnread` to those
mutations for parity.

### QA-GC-011: Directory limits are silent (Low)

`browseChannels` returns at most 50 rows and ignores the cursor it accepts.
`listChannels` returns at most 200 joined channels. Neither tells the UI that
there is more. Search narrows browse, so this only matters for very large
workspaces, but the `nextCursor` field is currently always null while the type
implies pagination.

### QA-GC-012: The create dialog keeps a validation error while typing (Low)

`channel-dialog.tsx` sets the error on submit and clears it only on submit or a
tab change. After "Give the channel a name." the alert stays visible while the
user types a valid name. Clear the error in the name and topic change handlers.

### QA-GC-013: The QA plan is stale on two points (Low)

`docs/qa/group-channels-2026-11-26.md` still expects RLS-04 to return 0
participant rows and describes restore as returning the channel to the rail
without noting that it must still be open. Both changed during the RLS recursion
fix. Update the plan when the findings above are fixed.

### QA-GC-014: Dialog close affordances are duplicated (Low)

The shared `Dialog` always renders a close X plus any footer Close button, so
the channel and settings dialogs expose two controls with the same accessible
name. Not a blocker, but a screen reader hears "Close, button, Close, button".

## UI pass details

The live pass used a clean workspace (`UI Test Org`, slug `gc-ui-test`) with the
owner in Chrome and a second member acting over HTTP and WebSocket.

Executed cases:

| ID | Case | Status |
|---|---|---|
| UI-01 | Empty Messages state shows Channels and Direct messages, both actions | Pass |
| UI-02 | Create dialog opens, focus lands in Name | Pass |
| UI-03 | Empty submit shows the alert "Give the channel a name." | Pass |
| UI-04 | Public create with two members opens the channel, header `# ui-launch`, "3 members" | Pass |
| UI-05 | First message appears and updates the rail preview | Pass |
| UI-06 | A message sent by the second member appears live, with a screen reader announcement | Pass |
| UI-07 | Settings: rename updates the header, rail and dialog title | Pass |
| UI-08 | Settings: promote to owner and remove a member update the roster and count | Pass |
| UI-09 | Mute toggles to Unmute and the row shows the muted icon | Pass |
| UI-10 | Archive asks for a second click, then hides settings and shows Restore | Pass |
| UI-11 | Archived pane is read only and the rail drops the channel | Pass, see QA-GC-003 |
| UI-12 | Restore returns the channel to the rail and the composer returns | Pass |
| UI-13 | Browse lists public channels only, with Open or Join | Pass |
| UI-14 | Join opens the channel and adds it to the rail | Pass |
| UI-15 | Unread badge appears when a message arrives on another channel and clears on open | Pass |
| UI-16 | Muted channel shows unread but the bell does not get a new row | Pass |
| UI-17 | Bell row for a channel opens the channel | Pass |
| UI-18 | Renaming a channel updates an old bell row | Pass |
| UI-19 | Thread panel opens from a channel message and a reply posts | Pass |
| UI-20 | Own messages offer Edit and Delete, other people's do not | Pass |
| UI-21 | Mobile 390x844 keeps the channel usable with the composer | Pass |
| UI-22 | Console and network during the pass | No errors, no 4xx or 5xx |

Evidence screenshots are in `docs/qa/evidence/group-channels/`:

- `01-empty-state.png`
- `02-new-channel.png`
- `03-first-message.png`
- `04-settings.png`
- `05-archived.png`
- `06-browse.png`
- `07-unread.png`
- `08-bell.png`
- `09-mobile.png`

## Known limits carried forward

- No per person read receipt in a channel. Direct messages keep the Seen marker.
- No @mentions or mention notifications in channels.
- Project channels remain a reserved scope, not a surface.
- One notification upsert per recipient per message, so a 100 member channel does
  100 writes inside the send transaction.
- Public channel previews are visible to the whole workspace by design.

## Not tested

- Firefox and Safari. The pass used the Chrome DevTools browser only.
- A true two browser session of the same account. Cross tab read state was
  checked through the same socket path and the realtime echo, not a second
  logged in browser profile.
- Load and large data. The cap was tested with seeded participant rows, not 100
  interactive users.
- Email and push delivery for `group_message`. The bell row and realtime
  payload were verified; the mail worker and web push were not.
- Historical pages in a channel with hundreds of messages. The message paging
  code is shared with direct messages, which was covered in the previous pass.

## Suggested fix order

1. QA-GC-001, the `default: undefined` change and route tests. This prevents a
   private channel becoming public by accident.
2. QA-GC-002, guard restore against a reused name and return a clean 400 or 409.
3. QA-GC-003, surface archived channels so restore is reachable.
4. QA-GC-004, hide conversation notifications when the recipient is no longer an
   active participant.
5. QA-GC-007, recompute the member count when a workspace member is removed.
6. QA-GC-005 and QA-GC-006, document or scope the RLS and naming decisions.
7. QA-GC-008 through QA-GC-014, the low severity polish items.

## Test data and cleanup

The API suite created its own users (`gc-e2e-<run>-*@example.test`), workspace
and channels, and left them in the dev database for inspection. The UI workspace
is `org_ui_test` (`gc-ui-test`) with owner, member and outsider accounts. No
host files were changed except this report and the screenshots directory. The
temporary scripts and cookies lived under `/tmp/opencode` and were removed.

## Resolution

All findings were fixed after this report. Migration `0038_many_captain_britain`
carries the schema changes.

| Finding | Fix |
|---|---|
| QA-GC-001 | Every channel `t.UnionEnum` now passes `default: undefined`; create without visibility and role PATCH without a role are 422. Added `routes/channels/schemas.test.ts`. |
| QA-GC-002 | Restore checks the name against active channels of the same visibility and translates a unique violation to 400. |
| QA-GC-003 | Added `GET /channels/archived`, a sidebar Archived section and a restore path from it. |
| QA-GC-004 | Notification scope hides `direct_message` and `group_message` rows when the recipient is no longer an active participant. |
| QA-GC-005 | Participant insert is self only; create, direct open and add members write cross user rows with `withTargetUser`. The workspace visible select is documented as an invariant. |
| QA-GC-006 | Channel names are unique per workspace and visibility, so a public create cannot confirm a private name. |
| QA-GC-007 | Workspace removal detaches the person from every group channel, recomputes the count, promotes an owner and archives an empty room. |
| QA-GC-008 | Add members checks ownership before validating the ids. |
| QA-GC-009 | The member picker closes on Escape and keeps the selection. |
| QA-GC-010 | Channel read, edit and delete mutations patch or invalidate the channel cache directly. |
| QA-GC-011 | Browse is keyset paged with a Load more control; the joined list reports when it is capped. |
| QA-GC-012 | The create dialog clears its error when the name or topic changes. |
| QA-GC-013 | The QA plan is updated for the current RLS and restore rules. |
| QA-GC-014 | The duplicated footer Close was removed from the channel dialogs. |

Verification after the fixes:

- API unit suite: 545 pass, 151 skip, 0 fail.
- API integration suite against `app_test`: 673 pass, 0 fail.
- Web unit suite: 142 pass, 0 fail.
- A fresh 26 assertion live API pass: 26 pass, 0 fail.
- Chrome UI spot check of the Archived section and the Escape behaviour.
