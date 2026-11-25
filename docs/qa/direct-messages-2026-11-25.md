# QA Report: Direct Messages

Date: 25 Nov 2026
Branch: `feature/direct-messages`
Commit tested: `f7117e4 feat: add direct messages on a shared conversation model`
Environment: Docker dev stack (`ultra-dev-*`), web on `localhost:3000`, API on `localhost:3001`, PostgreSQL 18, Redis, Chrome DevTools MCP
Migration: `0033_lovely_elektra.sql` applied (verified in `information_schema` and `pg_constraint`)

## Verdict

The feature is functionally complete and the main flows work end to end. One High severity defect blocks release: read cursors lose microsecond precision, so the unread badge over-counts and does not clear reliably after a conversation is opened. Two smaller issues affect data consistency and input validation. Nothing was fixed in this pass, as requested.

## Scope

Reviewed and exercised:

- Conversation creation and pair resolution
- Message send, optimistic render, retry idempotency
- Conversation list ordering and previews
- Sidebar recent chats and unread badge
- Bell notification, copy and deep link
- Read receipts and typing indicator
- In-conversation search and jump to a hit
- Message edit and soft delete
- Deep link, refresh and open in a new tab
- Mobile single pane and back navigation
- Non-participant access, author-only edit and delete, removed member
- Milestone comment search and comment typing
- Unit tests and new regression tests

## Approach

1. Code review of the API service, routes, RLS policies, realtime handlers and web data layer.
2. Unit and reducer tests, including new tests for the conversation helpers, cache reducers, notification copy and search snippets.
3. Live UI testing through Chrome DevTools at 1440x900 and 390x844.
4. Two-user testing by creating a second workspace member and driving the API and WebSocket as that member, while observing the first user's UI.
5. Database verification of conversations, participants, messages, cursors and notifications.

## Automated tests run

| Suite | Files | Result |
|---|---|---|
| API unit | conversation access, notifications, notification copy, rich text, realtime protocol, realtime events, search | 90 pass, 0 fail |
| Web unit | message cache, comment cache, notification links | 32 pass, 0 fail |
| Biome | repo | clean |
| TypeScript | API and web | clean |

New test files added for this pass:

- `apps/api/src/services/conversation/access.test.ts`
- `apps/api/src/lib/search.test.ts`
- `apps/web/src/features/messages/cache.test.ts`
- one direct message copy case added to `apps/api/src/lib/notification-copy.test.ts`

## Executed cases

| ID | Area | Steps | Expected | Actual | Status |
|---|---|---|---|---|---|
| DM-01 | Navigation | Open `/messages` from the sidebar | Messages page with list and empty right pane | Matches | Pass |
| DM-02 | Picker | Click Start a conversation | Dialog lists workspace members, excludes self | Matches | Pass |
| DM-03 | Picker search | Type a name | List narrows to the match | Matches | Pass |
| DM-04 | Create | Choose a member | Conversation opens at its own URL, empty state shown | Matches | Pass |
| DM-05 | Send | Type and press Shift+Enter | Message renders, composer clears, list preview updates | Matches | Pass |
| DM-06 | Send guard | Leave the editor empty | Send button disabled | Matches | Pass |
| DM-07 | Idempotency | POST the same body and nonce twice | One row, second response returns the original message | Matches | Pass |
| DM-08 | Realtime | Second user sends a message | Message appears without reload, preview updates | Matches | Pass |
| DM-09 | Read receipt | Second user opens and reads | "Seen" appears under the last read own message | Matches | Pass |
| DM-10 | Typing | Second user sends typing frames | Header shows "typing..." | Matches | Pass |
| DM-11 | Bell | Second user sends while first user is on the dashboard | Bell row appears with sender and preview | Matches | Pass |
| DM-12 | Bell click | Click the DM notification | Navigates to the conversation, row marked read | Matches | Pass |
| DM-13 | Unread badge | Second user sends while first user is elsewhere | Sidebar shows unread count | Matches | Pass |
| DM-14 | Unread clear | Open the conversation | Unread should clear | Badge stayed at 2 after opening | Fail, see QA-DM-001 |
| DM-15 | Search | Search "alpha" inside the conversation | One result with sender, date and snippet | Matches | Pass |
| DM-16 | Search jump | Click a result | Panel closes, thread shows the hit | Matches | Pass |
| DM-17 | Edit | Edit an own message and save | Body updates, "edited" marker appears, preview updates | Matches | Pass |
| DM-18 | Delete | Delete an own message | Body blanked, "This message was deleted.", preview updates | Matches | Pass |
| DM-19 | Deleted edit | Edit a deleted message through the API | Rejected | 400 "That message was deleted..." | Pass |
| DM-20 | Author only | Another user edits or deletes the message | Rejected | 403 "Only the person who wrote a message..." | Pass |
| DM-21 | Non-participant | Read or send in another pair's conversation | Not found | 404 "That conversation no longer exists." | Pass |
| DM-22 | Self chat | Start a conversation with yourself | Rejected | 400 "You cannot start a conversation with yourself." | Pass |
| DM-23 | Empty body | POST an empty body | Rejected | 400, but the copy says "comment" | Pass with copy issue, see QA-DM-006 |
| DM-24 | Long body | POST a 5001 character body | Rejected or truncated consistently | 200, body kept 5001 characters, mirror truncated to 5000 | Fail, see QA-DM-002 |
| DM-25 | Forged message cursor | `before=not-a-cursor` | Rejected | 400 "That message is not part of this conversation." | Pass |
| DM-26 | Forged list cursor | `cursor=not-a-cursor` | Rejected | 200 with an empty list | Fail, see QA-DM-003 |
| DM-27 | Removed member | Remove the recipient from the workspace, then send | Rejected, conversation read only | 403 plus the read-only notice in the UI | Pass |
| DM-28 | Refresh | Reload the conversation and the list | State survives | Matches | Pass |
| DM-29 | New tab | Open the conversation URL in a new tab | Loads independently | Matches | Pass |
| DM-30 | Mobile | 390x844, open a conversation | Single pane with back button | Matches | Pass |
| DM-31 | Mobile back | Press back | Returns to the list | Matches | Pass |
| DM-32 | Chat filter | Type in Search chats | List narrows | Matches | Pass |
| DM-33 | Comment search | Search "handoff" in the milestone comments tab | One hit, opens the focused thread tab | Matches | Pass |
| DM-34 | Comment typing | Second project member sends milestone typing frames | "Someone is typing..." above the composer | Matches | Pass |
| DM-35 | Live region | Observe the message list announcement | Only new incoming messages should be announced | Announces own messages too, see QA-DM-007 | Observation |

## Findings

### QA-DM-001: Read cursor loses microsecond precision, so unread does not clear (High)

Symptom: after opening a conversation and reading it, the unread badge stays at 2 (or 1) and the conversation keeps showing unread. The bell row is cleared, so the bell and the messages badge disagree.

Evidence from the live run:

- Message `b99a472a-2f75-4a7e-9b82-a83ba12360be` has `created_at = 2026-11-25 14:10:01.302363`.
- After the recipient read it, the participant cursor was `last_read_at = 2026-11-25 14:10:01.302000`, `last_read_message_id = b99a472a...`.
- The API returned `unread: 2` while only one newer message existed.
- A message whose timestamp happened to end at `.211000` counted correctly, which makes the defect intermittent and easy to miss.

Cause: `markConversationRead` writes `lastReadAt` from a JavaScript `Date`, which truncates Postgres microseconds to milliseconds. The unread query compares `(created_at, id) > (last_read_at, last_read_message_id)`, so a message with a non-zero microsecond part is always newer than its own truncated cursor.

Impact: unread badges over-count, conversations never fully clear, and the sidebar and bell disagree. This is the main release blocker.

Suggested fix, not applied: write the cursor from the message row inside SQL so the exact stored timestamp is copied, for example an `UPDATE ... FROM conversation_message` that sets `last_read_at = message.created_at`. Alternatively compare only on `last_read_message_id` by resolving that message's `created_at` in the same statement. Add a regression test with a microsecond timestamp.

### QA-DM-002: API accepts text over the 5000 character limit and truncates only the mirror (Medium)

Symptom: a direct API call with 5001 characters was accepted with 200. The stored `body` JSON kept all 5001 characters, while `body_text` was truncated to 5000.

Evidence: `length(body_text) = 5000`, `length(body::text) = 5043` for message `1c6d9197-7fa6-4279-acfe-0dbee49306b7`.

Impact: the rendered message and the searchable or preview text disagree by the truncated tail. It also means the client limit and the server limit are not the same rule. The same behaviour is inherited from the comment sanitizer, so it is not unique to direct messages.

Suggested fix, not applied: reject when the sanitized text exceeds `COMMENT_TEXT_MAX`, or align the client and server limits and keep the body and mirror identical.

### QA-DM-003: Invalid conversation cursor returns an empty list (Low)

Symptom: `GET /conversations?cursor=not-a-cursor` returns 200 with `conversations: []` and `unreadTotal: 0`.

Cause: `decodeCursor` only rejects empty or oversized values, so a short invalid string is treated as an id. The SQL cursor subquery then matches nothing.

Impact: a hand-edited or stale link silently shows an empty list instead of a clear error. Message paging already returns 400 for the same class of input, so the two cursors behave differently.

Suggested fix, not applied: validate the decoded id shape (UUID) or return 400 when the cursor row cannot be resolved.

### QA-DM-004: Form controls missing id or name (Low)

Chrome reports "A form field element should have an id or name attribute". The affected elements on the messages page are:

- the Search chats input
- the Write a message contenteditable (role textbox)
- the block style select in the toolbar
- the hidden image and file inputs

Impact: autofill and some assistive technology hints are weaker. The visible controls do have accessible names through `aria-label` except the block select.

Suggested fix, not applied: add stable `id` and `name` attributes, and an `aria-label` on the block select.

### QA-DM-005: An empty new conversation is hidden from the list (Low)

Symptom: after choosing a person in the picker, the conversation opens, but the list still says "No conversations yet" until the first message is sent.

Cause: the list query filters `last_message_at is not null` by design.

Impact: the sidebar and list look empty while a chat is open, which can read as a failure. It is a deliberate design choice but a confusing first impression.

Suggested fix, not applied: include the open conversation as a temporary "New" row, or show a hint in the list while the draft chat is open.

### QA-DM-006: Empty body copy mentions a comment (Low)

Symptom: sending an empty body in a direct message returns "Write something before posting your comment."

Cause: the shared sanitizer message is comment-specific.

Suggested fix, not applied: parameterize the empty body copy per surface, or use a neutral "Write something before sending."

### QA-DM-007: Live region announces the viewer's own messages (Low, accessibility)

Symptom: the message list `aria-live` output reads "New message from <viewer>" after sending your own message, and it re-renders the newest message on unrelated renders.

Impact: screen reader users hear their own sent message announced as incoming, and may hear repeated announcements.

Suggested fix, not applied: update the live region only when a message arrives from another person, and keep the text short.

## Not tested

- Web Push delivery with a closed tab (the queue and service worker were not exercised).
- Send rate limit (30 per minute) to avoid creating a large amount of test data.
- Attachment upload and rendering inside a message.
- Pagination beyond one page (more than 40 messages or more than 20 conversations).
- Account deletion and the "former member" rendering for a deleted account.
- Group and project conversation scopes (schema support exists, UI does not).
- Cross-tenant access by a user from another organization (same-org non-participant was tested).
- Full keyboard-only and screen reader pass.
- Multiple tabs reading the same conversation at the same time (a second tab was opened, but read suppression in the hidden tab was not asserted).

## Test data and cleanup

A temporary workspace member, two test conversations, several messages, one notification and one project membership were created for the two-user tests. They were removed at the end of the run. No product code or data was changed beyond that temporary test data, and no findings were fixed.

## Recommendation

Fix QA-DM-001 before release and add the microsecond regression test. QA-DM-002 should be resolved in the same pass because it affects what search and previews can see. The remaining items can ship as follow-ups.
