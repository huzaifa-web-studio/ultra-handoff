# QA Plan: Group Channels

Date: 26 Nov 2026
Branch: `feature/group-messages`
Migrations: `0035_last_mastermind.sql`, `0036_needy_dracula.sql`,
`0037_special_havok.sql`, `0038_many_captain_britain.sql`

## Verdict

Implementation complete. Automated checks pass. The manual cases below still
need a two or three user run on a migrated dev stack before release, because the
new access rules and the realtime fan out cannot be exercised by unit tests.

## Automated checks run

| Check | Result |
|---|---|
| API typecheck (`tsc --noEmit`) | Pass |
| Web typecheck (`tsc --noEmit`) | Pass |
| API unit suite (`bun test`) | 534 pass, 151 skip, 0 fail |
| Web unit suite (`bun test`) | 142 pass, 0 fail |
| Biome (`bun run check`) | Clean |
| Format (`bun run format`) | Clean |

New or updated tests:

- `apps/api/src/services/conversation/channels/validate.test.ts` covers name,
  topic, visibility and member id rules.
- `apps/api/src/lib/notification-copy.test.ts` covers the `group_message` copy
  and href.
- `apps/web/src/features/messages/cache.test.ts` covers channel activity and
  channel unread reducers.

## Manual cases

Run with one owner, one member and one outsider, after
`bun run db:setup` (or the dev compose migrate job).

### Channel creation and directory

| ID | Steps | Expected |
|---|---|---|
| CH-01 | Create a public channel named ` Design Review ` | Name stored as `Design Review`, appears in the rail and in Browse |
| CH-02 | Create a second channel with the same name, different case | 400 with "A channel with that name already exists." |
| CH-03 | Create a private channel | Appears in the creator rail, absent from Browse for the outsider |
| CH-04 | Open Browse as the outsider | Public channels listed with member count, private absent |
| CH-05 | Join a public channel as the outsider | Channel appears in the rail and the channel opens |
| CH-06 | Archive a channel as the owner | Leaves the rail and Browse, appears under Archived, header becomes read only |
| CH-07 | Navigate away, reopen Messages, restore it from Archived | Returns to the rail with members and messages intact |
| CH-30 | Archive `launch`, then create another channel named `launch` | The new name is accepted while the old row is archived |
| CH-31 | Restore the old `launch` after the name was reused | 400 asking to rename the other channel, never a 500 |
| CH-32 | Create a public channel `design` and a private channel `design` | Both are accepted, and a duplicate in the same visibility is still 400 |

### Access rules

| ID | Steps | Expected |
|---|---|---|
| CH-08 | As the outsider, call the channel detail or messages endpoint for a private channel | 404 |
| CH-09 | As the outsider, call the same endpoints for a public channel not joined | 404 on detail, public row visible only through Browse |
| CH-10 | Remove the outsider from a private channel | Their open pane returns to the empty state after the realtime event |
| CH-11 | Leave a public channel as a member and reopen it from Browse | Rejoin works, previous read position is kept |
| CH-12 | As the last owner, leave | 400 asking to promote another owner or archive |
| CH-13 | As an owner, remove yourself with the member remove action | 400 asking to use leave |
| CH-14 | As a member, try rename, add, remove, promote, archive | 403 |
| CH-15 | As an author, edit and delete a message | Allowed |
| CH-16 | As an owner, edit or delete another person's message | Not offered, and the API rejects it |

### Messages, threads and read state

| ID | Steps | Expected |
|---|---|---|
| CH-17 | Send from two members at once | Both appear, no duplicate for the author on reconnect |
| CH-18 | Post a root and a reply in a thread | Reply count and thread unread dot update in the channel |
| CH-19 | Open the channel without opening the thread | Root is read, reply stays unread |
| CH-20 | Send in an archived channel | 400, composer is read only |
| CH-21 | Search inside a channel | Only that channel's matches, jump opens the right page |
| CH-22 | Mute a channel, send a message from another member | Unread still rises, no bell row and no push |
| CH-33 | Leave a channel with an unread bell row, then reopen the bell | The row is hidden and the bell unread is 0 |
| CH-34 | Rejoin the same channel | The missed bell row returns unread and the old cursor is kept |

### Realtime and notifications

| ID | Steps | Expected |
|---|---|---|
| CH-23 | Two tabs as the same person, send in one | Other tab patches the timeline and the rail |
| CH-24 | Member A types, members B and C watch | Both see a typing line; with two typers it names both |
| CH-25 | Rename the channel while a member has it open | Header and rail update without a reload |
| CH-26 | Add a member from the settings panel | Their rail shows the channel without a reload |
| CH-27 | Bell row for a channel message | One row per channel, body names the channel, click opens the channel or the thread |
| CH-28 | Rename the channel, open the old bell row | The body uses the new name |

### RLS probes

Run as `app_tenant` with `app.current_org_id` and `app.current_user_id` set.

| ID | Query | Expected |
|---|---|---|
| RLS-01 | Select a private channel row as a non-participant | 0 rows |
| RLS-02 | Select a public channel row as a non-participant | 1 row |
| RLS-03 | Select `conversation_message` for a channel after `left_at` is set | 0 rows |
| RLS-04 | Select another member's `conversation_participant` row as a non-participant | 1 row, workspace visible by design |
| RLS-05 | Update another member's role as a non-owner | 0 rows affected |
| RLS-06 | Insert another person's participant row as a non-owner | Rejected by the self only insert policy |
| RLS-07 | Insert your own participant row into a private channel through a raw query | Allowed by RLS, so every route must check visibility first |

## Regression cases from the 27 Nov pass

The full report is `docs/qa/group-channels-2026-11-27-report.md`. These cases
were added to cover the fixes:

| ID | Case | Expected |
|---|---|---|
| FX-01 | `PATCH /conversations/:id` with `{}` | 400 "There is nothing to change." |
| FX-02 | `PATCH /conversations/:id` with only a title on a private channel | 200, visibility stays private |
| FX-03 | `PATCH /members/:id` with `{}` | 422, role is required |
| FX-04 | `POST /channels` without `visibility` | 422, never a silent public channel |
| FX-05 | Restore after the name was reused | 400, never a 500 |
| FX-06 | Leave a channel with an unread bell row | The row is hidden and the unread count drops |
| FX-07 | Rejoin the channel | The missed row returns unread |
| FX-08 | Remove a workspace member who owned a channel | The earliest member becomes owner |
| FX-09 | Remove a workspace member from a channel they alone were in | The channel is archived, count 0 |
| FX-10 | Browse past the first page | Every page is distinct and the cursor ends at null |
| FX-11 | Create a public and a private channel with the same name | Both accepted, same-visibility duplicate 400 |
| FX-12 | Escape in the member picker after selecting people | The popover closes and the selection is kept |

## Known limits

- 100 members per channel. The send transaction writes one notification upsert
  per notifiable recipient.
- No per person read receipt in a channel. The direct chat keeps its "Seen"
  marker.
- No @mention notifications in chat, matching the current composer.
- A member removed from the workspace is detached from every group channel,
  the count is recomputed, an owner is kept and an empty channel is archived.
  Direct conversations keep their row and stay read only.
- Participant rows are workspace readable because a policy on that table cannot
  read the same table without recursion. The service proves participation
  before every read, and the insert policy is self only.
- Channels are workspace scoped only. Project channels remain a reserved scope,
  not a surface yet.
