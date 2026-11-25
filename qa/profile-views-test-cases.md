# Member Profile Views Test Cases

**Feature:** Member profile hover cards and profile page
**Branch:** `feature/profile-views`
**Date:** 25 Nov 2026
**Author:** QA pass with OpenCode (`sqa-engineer` skill)
**Environment:** Live dev stack, web `http://localhost:3000`, API `http://localhost:3001`
**Workspace under test:** Retest B (`retest-b-brtmwt2gq2z`)

## Scope

Covers the three surfaces added by the feature:

1. The profile read API (`GET /orgs/:orgSlug/people/:userId`).
2. The member hover card on avatars and person mentions.
3. The full profile page and the editable profile fields on Account.

Out of scope: the activity feed, a people directory, push and email, and any
surface that already existed before this branch except where it is touched by the
avatar change (regression).

## Test data

| Name | Role | Purpose |
|---|---|---|
| Retest Member B | Organization owner, project owner | Target profile: fields, hidden project, done and live assignments |
| Retest Owner A | Organization member, project member | Signed-in viewer and self profile |
| QA Empty Profile | Organization member | Empty states, no projects or assignments |
| QA Former Member | Removed membership | Former member hover card and 404 |
| QA Hidden Project | Owner only | Project the viewer must not see |
| QA Finished Work | Done milestone | Must not appear as assigned work |
| QA Hidden Work | Todo milestone in the hidden project | Must not appear |

## A. Profile read API

| ID | Title | Preconditions | Steps | Expected result | Priority | Type |
|---|---|---|---|---|---|---|
| PV-01 | Read another member's profile | Signed in as a member of the workspace | GET `/orgs/:slug/people/:ownerId` | 200 with name, email, image, job title, bio, location, role, joinedAt, projects, assignments, counts | Critical | Functional |
| PV-02 | Read own profile | Signed in | GET the profile of the signed-in user | 200 and `isSelf` is true | High | Functional |
| PV-03 | Read a user outside the workspace | Signed in | GET `/orgs/:slug/people/:outsiderId` | 404, "That person is not part of this workspace." | Critical | Security |
| PV-04 | Read a profile without a session | No session cookie | GET `/orgs/:slug/people/:userId` | 401 | Critical | Security |
| PV-05 | Hide a project the viewer cannot see | Owner belongs to a project the viewer is not in | Read the owner's profile | The hidden project is absent from `projects` | Critical | Security |
| PV-06 | Include an organization owner's implicit projects | Owner has no project member row | Read the owner's own profile | Every visible project is listed with role `owner` | High | Functional |
| PV-07 | Return live assignments only | Owner has todo and done assignments | Read the profile | Only the todo milestone appears | High | Functional |
| PV-08 | Exclude assignments in hidden or archived projects | Owner is assigned in a hidden project | Read the profile as a member | The hidden assignment is absent | High | Security |
| PV-09 | Show email to workspace members | Signed in as a member | Read another member's profile | `email` is present | Medium | Functional |
| PV-10 | Migration is backward compatible | Existing users without profile fields | Apply migration, read a profile | Existing rows return null fields, no backfill needed | Medium | Regression |

## B. Hover card

| ID | Title | Preconditions | Steps | Expected result | Priority | Type |
|---|---|---|---|---|---|---|
| PV-11 | Open on hover | Pointer modality is active | Hover a member avatar for about 400 ms | Card opens with avatar, name, role, job title, bio, joined date, location, up to three projects and the CTA | Critical | Functional |
| PV-12 | Close when the pointer leaves | Card open | Move the pointer to unrelated content | Card closes after the close delay | High | Functional |
| PV-13 | Keyboard access | Card closed | Focus the avatar link, wait | Card opens; Escape closes it | Critical | Accessibility |
| PV-14 | No request before hover | Fresh page load | Load the members page, do not hover | Zero `/people/` requests | High | Performance |
| PV-15 | Reuse the hover response on the profile page | Fresh page load | Hover, then click the profile link within 60 s | One `/people/` request total across both surfaces | Medium | Performance |
| PV-16 | Mention chip hover | Posted comment with a person mention | Hover the `@Name` chip | Profile card opens for that person | High | Functional |
| PV-17 | Comment author hover | Posted comment | Hover the author avatar | Profile card opens | High | Functional |
| PV-18 | Assignee stack hover | Milestone with assignees | Hover an assignee avatar in the list row | Profile card opens | Medium | Functional |
| PV-19 | Project member hover | Project with members | Hover an avatar in the project header stack or member card | Profile card opens | Medium | Functional |
| PV-20 | Former member card | Comment by a removed member | Hover the author avatar, wait for the request to settle | "No longer in this workspace", no profile link | Medium | Edge case |
| PV-21 | First hover after load | Fresh page load, no click or key | Hover a member avatar | Card opens on the first hover | High | Usability |
| PV-22 | Avatar click navigates | Card closed | Click the avatar link | Full profile page opens | High | Functional |
| PV-23 | Non-person avatars stay plain | Signed in | Hover the sidebar self avatar and an organization logo | No person card is rendered | Low | Design |

## C. Profile page

| ID | Title | Preconditions | Steps | Expected result | Priority | Type |
|---|---|---|---|---|---|---|
| PV-24 | Render the full profile | Profile has fields, projects and assignments | Open the profile page | Header, About, Projects and Assigned work render with the correct values | Critical | Functional |
| PV-25 | Date format | Any profile | Read the joined date and due dates | Day month year, for example `23 Nov 2026` | High | Functional |
| PV-26 | Copy email | Profile page open | Press the copy button | Clipboard contains the email and a success toast appears | Medium | Functional |
| PV-27 | Self view | Open own profile | Inspect the header | `You` badge and an Edit profile link to `/account` | Medium | Functional |
| PV-28 | Empty states | Member with no projects or assignments | Open the profile | "No shared projects yet." and "No open work assigned." | Medium | Edge case |
| PV-29 | Profile not found | User outside the workspace | Open `/people/:outsiderId` | Friendly not-found card with Back to members, no crash | High | Negative |
| PV-30 | Dynamic breadcrumb | Any profile | Read the header breadcrumb | Organization name, then the person's name | Medium | Functional |
| PV-31 | Dark and light themes | Profile open | Switch theme | All surfaces use the app tokens, no literal colors | Medium | Visual |
| PV-32 | Mobile layout | 390 x 844 viewport | Open the profile | Header stacks, facts wrap, cards stack in one column | Medium | Responsive |
| PV-33 | Console health | Profile and hover cards used | Inspect the console | No React or runtime errors; only expected 404 and 400 network entries | Medium | Regression |
| PV-34 | Automated accessibility | Profile page | Run Lighthouse | Accessibility score at or above 95 | High | Accessibility |

## D. Editable profile fields

| ID | Title | Preconditions | Steps | Expected result | Priority | Type |
|---|---|---|---|---|---|---|
| PV-35 | Save the optional fields | Signed in | Set job title, location and bio, save | "Profile updated." and the profile shows the new values | Critical | Functional |
| PV-36 | Reject an oversized bio | Signed in | Send a 501 character bio | 400, "Bio must be 500 characters or fewer." | High | Boundary |
| PV-37 | Expose input limits | Account open | Inspect the fields | `maxlength` is 80, 80 and 500 | Medium | Boundary |
| PV-38 | Clear fields to null | Signed in | Save empty or whitespace values | API returns null for those fields and the profile hides them | High | Edge case |
| PV-39 | Treat bio as plain text | Signed in | Save a script and image payload as the bio | Text renders literally, no script execution, no injected element | Critical | Security |
| PV-40 | Updated fields reach the hover card | Fields saved | Hover an avatar of that person | Card shows the new job title and bio | High | Integration |

## E. Regression and automation

| ID | Title | Preconditions | Steps | Expected result | Priority | Type |
|---|---|---|---|---|---|---|
| PV-41 | Existing member surfaces still render | Signed in | Open the members table, project members and comments | All render, avatars link to profiles, no layout break | High | Regression |
| PV-42 | Sidebar self avatar stays plain | Signed in | Hover the sidebar user menu avatar | No hover card, menu still opens | Low | Regression |
| PV-43 | Automated suites | Repository checkout | Run typecheck, Biome, API tests, web tests and the integration suite | All pass | High | Regression |
