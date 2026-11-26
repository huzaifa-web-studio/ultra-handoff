# QA Report: Direct Messages, Threads and Chat Surface

Date: 26 Nov 2026
Branch: `feature/direct-messages`
Commit tested: `f891e41 feat(messages): add per-message threads and rework the chat surface` plus the fixes listed below (uncommitted)
Environment: Docker dev stack (`ultra-dev-*`), web on `localhost:3000`, API on `localhost:3001`, PostgreSQL 18, Chrome DevTools MCP
Migrations: `0033_lovely_elektra.sql` and `0034_bumpy_mulholland_black.sql` applied

## Verdict

The feature is release ready after this pass. The thread model, the resizable side panel, the ClickUp style chat surface and the read cursors behave correctly under the tested flows. The pass found one critical pagination defect, three high impact state defects and a set of medium and low issues. All of them are fixed and verified.

## Scope

Reviewed and exercised:

- Timeline paging beyond one page, old and new cursors
- Thread paging beyond one page
- Thread creation, replying, nested reply rejection, reply to deleted rows
- Thread read cursor and conversation read cursor, including microseconds and monotonicity
- Root delete and edit while a thread is open, in the panel and on the thread route
- Search inside a conversation, including a hit on an old root and a hit on an old reply
- Static rich text rendering after a realtime edit
- Failed send, composer retry and nonce reuse
- Notification deep link for a root message and for a reply
- Deleted root with replies
- Resizable thread split, persisted layout, mobile overlay
- Sidebar active state and unread badges
- Composer keys, IME guard and draft persistence
- Form field naming for accessibility

## Approach

1. Code review of the API conversation module, the routes, the cache reducers, the realtime handler and the chat components.
2. A scripted API suite driving the real API as two workspace members, covering 30 edge cases.
3. Live UI testing through Chrome DevTools at 1440x900 and 640x900.
4. Two user testing by acting as the second member over HTTP while observing the first member's UI.
5. Database verification of message rows, read cursors, notification data and stored body lengths.
6. A forced outage (API container stopped) to exercise the failed send and retry path.

## Automated tests run

| Suite | Files | Result |
|---|---|---|
| API unit | 672 tests | 521 pass, 151 skip, 0 fail |
| Web unit | 16 files | 136 pass, 0 fail |
| Biome | repo | clean |
| TypeScript | API and web | clean |

New regression coverage added in this pass:

- `replaceThreadRoot` cache tests, including the "different root is untouched" case
- chat specific empty body copy test
- notification href tests for a direct message root and reply

## API edge case suite

| ID | Area | Expected | Actual | Status |
|---|---|---|---|---|
| E01 | Send root | 200 and an id | Matches | Pass |
| E02 | Idempotent replay | Same id, created false | Matches | Pass |
| E03 | Replay with a different body | Original row, no duplicate | Matches | Pass |
| E04 | Send reply | 200, parent set | Matches | Pass |
| E05 | Nested reply | 400 one level | Matches | Pass |
| E06 | Reply to unknown parent | 404 | Matches | Pass |
| E07 | Reply parent from another conversation | 404 | Matches | Pass |
| E08 | Reply summary | count 1, unread 1 | Matches | Pass |
| E09 | Thread page | root plus one reply, cursor null | Matches | Pass |
| E10 | Conversation read with a reply id | 400 open the thread | Matches | Pass |
| E11 | Thread read with a foreign message | 400 | Matches | Pass |
| E12 | Thread read clears unread | 200, unread 0 | Matches | Pass |
| E13 | Thread cursor monotonic | Cursor stays on the newer reply | Matches | Pass |
| E14 | Conversation read root | 200, unread 0 | Matches | Pass |
| E15 | Foreign delete | 403 | Matches | Pass |
| E16 | Delete reply | Row kept, reply count still 1 | Matches | Pass |
| E17 | Reply to a deleted reply | 400 | Matches | Pass |
| E18 | Delete root with replies | Thread still readable, root flagged | Matches | Pass |
| E19 | Reply to a deleted root | 400 | Matches | Pass |
| E20 | Thread rooted at a reply | 404 | Matches | Pass |
| E21 | Thread root from another conversation | 404 | Matches | Pass |
| E22 | Invalid list cursor, raw text | 400 | 400 | Pass |
| E23 | Invalid list cursor, decodes to junk id | 400 | 400 | Pass |
| E24 | Invalid message cursor | 400 | Matches | Pass |
| E25 | Empty body | 400, chat copy | 400 "Write something before sending your message." | Pass |
| E26 | Over length body | Rejected or both copies agree | 200, body and mirror both 5000 | Pass |
| E27 | Search | 200 with the hit | Matches | Pass |
| E28 | Search wildcard is literal | 200, no crash | Matches | Pass |
| E29 | Unknown conversation | 404 | Matches | Pass |
| E30 | List as the other member | 200 with an unread total | Matches | Pass |

## Executed UI cases

| ID | Area | Steps | Expected | Actual | Status |
|---|---|---|---|---|---|
| U01 | Chat keys | Type, Enter | Sends, clears the draft | Matches | Pass |
| U02 | Chat keys | Type, Shift+Enter, type | Line break, no send | Matches | Pass |
| U03 | Realtime | Second member replies | Chip updates to "2 replies, 2 unread" | Matches | Pass |
| U04 | Search jump, reply | Search an old reply, click the hit | Panel opens on the hit, highlighted, composer not focused | Matches | Pass |
| U05 | Search jump, root | Search an old root, click the hit | Timeline shows the hit, highlighted, Latest offered | Matches | Pass |
| U06 | Latest | Click Latest after a jump | Newest page restored, highlight removed, search cleared | Matches | Pass |
| U07 | Thread paging | Thread with 45 replies | Header says 45, 40 loaded, Load earlier works without duplicates | Matches | Pass |
| U08 | Timeline paging | 45 roots | Load earlier works, 45 unique rows, no 400 | Matches | Pass |
| U09 | Deleted root | Delete a root with replies | Chip stays, panel opens read only | Matches | Pass |
| U10 | Root delete, live | Delete the open thread's root over the API | Body blanks, composer disappears, no reload | Matches | Pass |
| U11 | Root edit, live | Edit the open thread's root over the API | Body updates in place, "edited" shown | Matches | Pass |
| U12 | Failed send | Stop the API, send | "Not sent" row, alert, draft kept | Matches | Pass |
| U13 | Retry | Start the API, retry from the composer | One stored row, no orphan pending row | Matches | Pass |
| U14 | Bell, reply | Reply while away, open the bell, click the row | Lands on the thread route, row and thread become read | Matches | Pass |
| U15 | Open in new tab | Panel opened from a search hit for a root not in the loaded page | A new tab opens the correct thread route | Matches | Pass |
| U16 | Resizer | Open a thread | Handle present, col-resize cursor, layout persists | Matches | Pass |
| U17 | Mobile | 640x900 with a thread open | Full width overlay, no handle | Matches | Pass |
| U18 | Live region | Send an own message | Live region stays silent | Matches | Pass |
| U19 | Read cursor precision | Read a message with microseconds | Stored cursor equals the message timestamp exactly | Matches | Pass |
| U20 | Accessibility | Audit form fields on the messages page | No unnamed form fields | 0 unnamed fields | Pass |
| U21 | Empty chat | Open a brand new conversation | Sidebar shows the open chat, no empty state | "Retest Member B, New conversation" | Pass |
| U22 | First message | Send the first message in that chat | Transient row becomes a normal row | Time and preview replace "New conversation" | Pass |

## Findings fixed in this pass

### QA-DM-008: The pagination cursor was sent to the database as a message id (Critical)

Symptom: every "Load earlier messages" and "Load earlier replies" request answered 400 "That message is not part of this thread." The panel showed "Could not load the thread."

Evidence: `GET /threads/595e...?before=MmRhNDJmY2UtOTQyOC00MTU3LWJlMjQtMzFiZDRmYzY5MzRk` returned 400. The decoded value was a valid reply id.

Cause: the server issued a base64url `nextCursor`, but `parsePageQuery` and `parseThreadQuery` passed it straight to `loadMessageRecord` as if it were a raw id. No test had loaded beyond one page before this pass.

Fix: decode `before` and `after` at the route boundary while leaving `around` raw, since a search hit carries a real id. Added a clear 400 when the opaque cursor cannot be decoded.

### QA-DM-009: `before` included its anchor and duplicated the boundary row (High)

Symptom: after the decode fix, page two repeated the last row of page one, producing duplicate DOM ids and duplicate rows.

Cause: the shared anchor clause only knew "include the anchor" and "exclude and go forward". A backwards page needs a strict `<`.

Fix: the anchor clause now takes an explicit `<`, `<=` or `>` operator. `before` is exclusive, `around` is inclusive, `after` is forward exclusive. Verified 40 plus 5 pages with 45 unique rows on both the timeline and a thread.

### QA-DM-010: Editing or deleting a root did not reach an open thread (High)

Symptom: deleting a root while its thread panel or route was open left the old body and a usable composer. Editing a root showed "edited" but kept the old text.

Cause: realtime and the edit/delete mutations patched only the timeline cache, never `pages[].root` in the thread cache.

Fix: added `replaceThreadRoot` and called it from the edit and delete mutations and from the realtime handler. Verified delete blanks the root and removes the composer, and edit updates the body in place.

### QA-DM-011: Static rich text never re-rendered after an in-place edit (High)

Symptom: a message body updated over realtime kept its original text until the row remounted. Comments had the same latent defect.

Cause: `CommentBody` captured the first value with `useState`, so later prop values were ignored.

Fix: `CommentBody` now syncs the static editor and its link previews when the value changes. Verified a root edit over the API updates the rendered body without a reload.

### QA-DM-012: The read echo discarded a search jump (Medium)

Symptom: a jump to an old message showed the "Latest" button but no highlight, and the timeline snapped back to the newest page.

Cause: marking the jumped page read published a read event to the reader's own socket. The self read branch invalidated the timeline query, which refetched the newest page over the jump.

Fix: a self read echo now refreshes the conversation list and the bell only. The timeline is not reloaded. Verified a jump to an old root highlights it and holds until Latest is pressed.

### QA-DM-013: A deleted root stranded its replies (Medium)

Symptom: deleting a root removed the "View thread" chip, so its replies could no longer be opened.

Cause: the chip required the root to be not deleted, while the panel already supported a read only thread.

Fix: the chip now depends only on the reply count. Verified the chip stays and the panel opens read only.

### QA-DM-014: Open in new tab did nothing when the panel's root was not in the loaded page (Medium)

Symptom: a thread opened from a search hit for an old root had an "Open thread in new tab" button that did nothing.

Cause: the parent looked the root up in the loaded timeline page and skipped the open when it was missing.

Fix: the panel passes its own root to the opener, with a placeholder tab when the thread has not loaded. Verified a new tab opens the correct route.

### QA-DM-015: Retrying a failed send from the composer created an orphan pending row (Medium)

Symptom: after a failed send, pressing the composer's "Try again" added a new pending row with a new nonce and left the failed row behind. A timeout could also store the message twice.

Cause: the composer retry called the send handler with a fresh nonce instead of reusing the failed row's nonce.

Fix: all three send handlers reuse the nonce of a failed pending row with the same body. Verified with the API stopped: one failed row, one retry, one stored message.

### QA-DM-003: Invalid conversation cursor returned an empty list (Low, carried over)

Fixed by resolving the cursor against the viewer's conversations and answering 400 when it does not exist.

### QA-DM-006: Empty body copy mentioned a comment (Low, carried over)

Fixed. The sanitizer takes an optional empty message, and chat sends "Write something before sending your message."

### QA-DM-007: Live region announced the viewer's own messages (Low, carried over)

Fixed. The region skips the first render and any message written by the viewer.

### QA-DM-016: Thread reply total under-reported when paginated (Low)

A thread with 45 replies labelled itself "40 replies". The thread page now carries the total across pages, and the panel and route use it. Verified "45 REPLIES" with 40 loaded and after loading all.

### QA-DM-017: Duplicate DOM ids when a root rendered in the panel (Low)

The timeline and the panel both used `message-<id>` for the root. The panel now uses a `thread-panel-message-` prefix. Verified ids are unique.

### QA-DM-018: A reply notification could not clear its own unread state (Low)

A reply notification linked to the conversation, which does not show replies and cannot mark them read, so the bell row stayed unread.

Fix: the notification data carries `threadRootId`, and the href points at the thread route. Verified the bell lands on `/threads/<root>` and the row becomes read.

### QA-DM-019: Search jump focused the composer (Low)

Fixed by clearing the reply focus token when a thread is opened from search, closed, or the conversation changes.

### QA-DM-020: Sidebar active row used a prefix match (Low)

`/messages/<id>` matched a longer id with the same prefix. Now the path must be exactly the row or continue with a slash.

### QA-DM-004: Form fields missing id or name (Low, carried over)

Fixed for the conversation search input, both chat editors, the hidden upload inputs and the React Aria block style select, which now carries `name="block-style"`. Chrome's audit reports no unnamed form fields on the messages page.

### QA-DM-021: An empty new conversation was hidden from the sidebar (Low, carried over)

Symptom: after choosing a person in the picker the chat opened, but the rail still said "No conversations yet" until the first message was sent. The list query hides empty conversations by design, so the one chat on screen was the one row missing.

Fix: the sidebar reads the open conversation header and shows it as a temporary row with the preview "New conversation". The first message replaces it with the normal preview and time. Verified with a brand new chat and its first send.

## Not tested

- Web Push delivery with a closed tab
- Attachment upload and rendering inside a message
- The 99 plus unread cap and conversations beyond two pages
- Group and project conversation scopes
- Cross-tenant access
- A true two-tab read race (the self read echo path was exercised indirectly by the search jump)
- Full screen reader pass, beyond the live region checks

## Test data and cleanup

Temporary conversations, messages, thread reads, drafts, tab entries and the saved split layout were removed at the end of the run. Two direct message notifications that belong to other users and conversations were left untouched.
