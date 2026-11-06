import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { magicLink, openAPI, organization } from "better-auth/plugins";

import { adminDb } from "../db";
import { authEnv, isDevelopment, serverEnv } from "../lib/env";
import {
	PASSWORD_MAX,
	PASSWORD_MIN,
	passwordRegex,
	passwordRuleMessage,
} from "../lib/password";
import { enqueueEmail } from "../queues/email";
import { getAccountDeletionBlocker } from "../services/account.service";
import {
	rememberActiveOrganization,
	resolveSignInOrganization,
} from "../services/organization.service";
import { deletePreviousAvatar } from "../services/upload.service";
import {
	assertAllowedRoles,
	MAGIC_LINK_TTL_SECONDS,
	ORG_INVITATION_LIMIT,
	ORG_INVITATION_TTL_SECONDS,
	ORG_MEMBERSHIP_LIMIT,
	validateOrganizationName,
	validateOrganizationSlug,
} from "./permissions";
import { authSecondaryStorage } from "./secondary-storage";

/**
 * Better Auth instance for the Handoff API.
 * Provides email/password auth, GitHub + Google social login, and the
 * organization plugin for agency/client workspaces.
 *
 * Used by: Elysia plugin in src/auth/plugin.ts.
 * Env: BETTER_AUTH_SECRET, BETTER_AUTH_URL, DATABASE_URL,
 *      GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET,
 *      GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
 */
export const auth = betterAuth({
	secret: authEnv.secret || undefined,
	baseURL: authEnv.url,
	// Runs on the privileged client on purpose: Better Auth reads across
	// organizations (list orgs, accept invitation, setActive), which RLS on
	// organization/member/invitation would block.
	database: drizzleAdapter(adminDb, { provider: "pg" }),
	// Sessions, verification tokens and rate limit counters live in Redis.
	// `storeSessionInDatabase` keeps a durable copy, so a Redis restart falls
	// back to Postgres instead of signing every user out.
	secondaryStorage: authSecondaryStorage,
	session: {
		storeSessionInDatabase: true,
	},
	/**
	 * Throttle the endpoints that send mail.
	 *
	 * Why these three: sign up, a blocked sign in and an explicit resend all
	 * enqueue a verification email. The library default is 100 requests per 10
	 * seconds, which lets one client turn a typo into an inbox flood. The
	 * sign-in rule is the widest because it also covers a legitimate person
	 * retrying a password.
	 */
	rateLimit: {
		customRules: {
			"/sign-up/email": { window: 60, max: 5 },
			"/sign-in/email": { window: 60, max: 10 },
			"/send-verification-email": { window: 60, max: 3 },
		},
	},
	user: {
		/**
		 * Server-owned pointer to the workspace the user was last active in.
		 *
		 * Why: sessions start with no active organization, so without this a
		 * returning user would be sent back to the create-organization screen.
		 * `input: false` keeps it out of the sign-up and update payloads and
		 * `returned: false` keeps it out of session and user responses; only
		 * the session hooks below (through the organization service) read and
		 * write it.
		 */
		additionalFields: {
			lastActiveOrganizationId: {
				type: "string",
				required: false,
				input: false,
				returned: false,
			},
		},
		deleteUser: {
			// Disabled by default in Better Auth. The account page owns the UI
			// and the confirmation, but the deletion itself stays in the
			// library so sessions and linked accounts cascade correctly.
			enabled: true,
			sendDeleteAccountVerification: async ({ user, token }) => {
				// Check before sending anything. A blocked user should see the
				// reason in the account card, not receive an email that can
				// only fail when the link is opened.
				const blocker = await getAccountDeletionBlocker(user.id);
				if (blocker) {
					throw new APIError("BAD_REQUEST", { message: blocker });
				}

				// Required for Google and GitHub users, who have no password to
				// re-enter before a destructive action.
				// Send the browser to a frontend page that owns the confirmation
				// and the error messaging, instead of the API callback URL. The
				// page calls `authClient.deleteUser({ token })` itself.
				const frontendUrl = new URL(`${serverEnv.webUrl}/delete-account`);
				frontendUrl.searchParams.set("token", token);
				await enqueueEmail({
					to: user.email,
					template: "delete-account",
					url: frontendUrl.toString(),
				});
			},
			beforeDelete: async (user) => {
				// Final safeguard for a direct API call that skipped the
				// preflight check. The same rule as the card and the email
				// callback, from one shared helper.
				const blocker = await getAccountDeletionBlocker(user.id);
				if (blocker) {
					throw new APIError("BAD_REQUEST", { message: blocker });
				}

				// Best effort. The user row still exists here, so we have the
				// image URL needed to find the object in SeaweedFS.
				await deletePreviousAvatar(user.id, user.image);
			},
		},
	},
	emailAndPassword: {
		enabled: true,
		// Keep both bounds explicit. The defaults happen to match today, but
		// the browser copies these numbers to show the rule, so a future
		// library default change must not silently move the goalposts.
		minPasswordLength: PASSWORD_MIN,
		maxPasswordLength: PASSWORD_MAX,
		/**
		 * An account is unusable until its address is confirmed.
		 *
		 * Why: the address is the identity every invitation, member row and
		 * workspace membership is matched against. Letting an unconfirmed
		 * address hold a session means a typo, or someone else's mailbox,
		 * can own real workspace data.
		 *
		 * With this on, sign up returns the user and no session. The person
		 * confirms the address by opening the mail sent on sign up, and
		 * `emailVerification.autoSignInAfterVerification` creates the session
		 * at that moment. The verification mail is therefore the only way in,
		 * so the sign-up and sign-in screens both offer a resend.
		 */
		requireEmailVerification: true,
		// Sign up never mints a session while the requirement above is on.
		// Stated explicitly so a future default change cannot quietly restore
		// the old "signed in, unverified" behaviour.
		autoSignIn: false,
		// Reset links stay valid for one hour. The email and the forgot
		// password screen both state this expiry, so keep them in sync.
		resetPasswordTokenExpiresIn: 60 * 60,
		// A reset usually means someone else may have had access. Sign out
		// every device, including the one that opened the link.
		revokeSessionsOnPasswordReset: true,
		sendResetPassword: async ({ user, url }) => {
			await enqueueEmail({ to: user.email, template: "reset-password", url });
		},
	},
	/**
	 * Social sign-in and existing accounts.
	 *
	 * A person invited to a workspace may already have a password account, or
	 * may prefer GitHub or Google. Implicit linking lets a same-email social
	 * sign-in attach to the existing user, so the invitation's email match
	 * still identifies them. GitHub and Google only report verified email
	 * addresses, which is why they are trusted here.
	 */
	account: {
		accountLinking: {
			enabled: true,
			trustedProviders: ["github", "google"],
		},
	},
	emailVerification: {
		// One hour is Better Auth's default, stated here because the
		// verification email and the verify page both tell the user how long
		// the link stays valid.
		expiresIn: 60 * 60,
		sendVerificationEmail: async ({ user, url }) => {
			const verifyUrl = new URL(url);
			// Land on the web app's verification page. Better Auth appends an
			// `error` query to this same URL when the token is expired or
			// invalid, so the page can tell success and failure apart instead
			// of turning a dead link into a false confirmation.
			const verifiedUrl = new URL("/verify-email", serverEnv.webUrl);
			verifiedUrl.searchParams.set("verified", "1");
			verifyUrl.searchParams.set("callbackURL", verifiedUrl.toString());

			await enqueueEmail({
				to: user.email,
				template: "verification",
				url: verifyUrl.toString(),
			});
		},
		// The confirmation mail goes out on sign up because the account cannot
		// be used without it.
		sendOnSignUp: true,
		// A blocked sign in sends a fresh link, which is the recovery path for
		// an account that never opened the first mail. Better Auth only sends
		// this while `requireEmailVerification` is on, so the setting and the
		// recovery path stay tied together.
		sendOnSignIn: true,
		// Opening the link is what creates the session, because sign up no
		// longer does. It also refreshes the session when the address was
		// verified in another tab.
		autoSignInAfterVerification: true,
	},
	databaseHooks: {
		session: {
			create: {
				/**
				 * Scope a new session to the user's last workspace.
				 *
				 * Why a database hook: it runs inside the sign-in request (and
				 * the social callback and post-verification sign-in), so the
				 * session is created already scoped. Calling setActive from the
				 * client afterwards would be a second request and a visible
				 * detour through the create-organization screen.
				 */
				before: async (session) => {
					// Respect an explicit value from an internal caller.
					const requested = session.activeOrganizationId;
					const activeOrganizationId =
						typeof requested === "string" && requested
							? requested
							: await resolveSignInOrganization(session.userId);

					return { data: { ...session, activeOrganizationId } };
				},
			},
			update: {
				/**
				 * Remember every active-organization change.
				 *
				 * `setActive` and `acceptInvitation` both update the session
				 * through the adapter, which lands here. Null is ignored: an
				 * explicit unset, or a rejected setActive for an organization
				 * the caller does not belong to, must not erase the memory.
				 */
				after: async (session) => {
					const activeOrganizationId = session.activeOrganizationId;

					if (
						typeof activeOrganizationId !== "string" ||
						!activeOrganizationId
					) {
						return;
					}

					await rememberActiveOrganization(
						session.userId,
						activeOrganizationId,
					);
				},
			},
		},
	},
	hooks: {
		before: createAuthMiddleware(async (ctx) => {
			// Sign-up with an existing email must fail loudly. Better Auth
			// answers with a generic error for a taken address, which leaves
			// the person guessing whether to sign in or pick another name.
			// The trade-off is that this reveals whether an address is
			// registered, which is acceptable for a client-facing app where
			// the user needs a clear next step.
			if (ctx.path === "/sign-up/email") {
				const email = ctx.body?.email;

				if (typeof email === "string") {
					const existing = await ctx.context.internalAdapter.findUserByEmail(
						email.trim().toLowerCase(),
					);

					if (existing?.user) {
						throw new APIError("UNPROCESSABLE_ENTITY", {
							message:
								"An account with this email already exists. Sign in instead.",
						});
					}
				}
			}

			// Every endpoint that writes a password enforces the same rule.
			// `set-password` and `change-password` are included so a caller
			// cannot skip the policy by using a different route.
			const passwordPaths = [
				"/sign-up/email",
				"/reset-password",
				"/change-password",
				"/set-password",
			];

			if (passwordPaths.includes(ctx.path)) {
				const password = ctx.body?.password ?? ctx.body?.newPassword;
				if (password && !passwordRegex.test(password)) {
					throw new APIError("BAD_REQUEST", {
						message: passwordRuleMessage,
					});
				}
			}
		}),
	},
	// Redirect-style auth errors (OAuth callbacks, email verification,
	// password reset, delete-account verification, validateUserInfo
	// rejections) land on the frontend error page instead of the API's
	// built-in one. The frontend reads `error` and `error_description`
	// from the query string and renders the message there.
	onAPIError: {
		errorURL: `${serverEnv.webUrl}/auth/error`,
	},
	socialProviders: {
		github: {
			clientId: authEnv.github.clientId,
			clientSecret: authEnv.github.clientSecret,
		},
		google: {
			clientId: authEnv.google.clientId,
			clientSecret: authEnv.google.clientSecret,
		},
	},
	plugins: [
		/**
		 * Passwordless sign in for invited users.
		 *
		 * Why: an invitation already proves control of the invited inbox, so
		 * asking a new invitee to invent a password and verify a second email
		 * is unnecessary friction. The accept page calls this plugin through a
		 * throttled API route that always targets the invitation's own address,
		 * never an address supplied by the browser.
		 */
		magicLink({
			expiresIn: MAGIC_LINK_TTL_SECONDS,
			// Redis holds a hash instead of the raw token, so a leaked Redis
			// dump cannot be replayed as a sign in link.
			storeToken: "hashed",
			sendMagicLink: async ({ email, url }) => {
				await enqueueEmail({ to: email, template: "magic-link", url });
			},
		}),
		/**
		 * Organizations use Better Auth's built in owner, admin and member
		 * roles. Admin already has organization update plus member and
		 * invitation management, and member is read only.
		 *
		 * The hooks below close two gaps that the plugin leaves open:
		 *   1. Invites and member updates accept any role string, so every
		 *      write that carries a role is checked against the allowlist in
		 *      src/auth/permissions.ts.
		 *   2. The plugin only checks slug length and uniqueness, while the
		 *      web router needs a lowercase slug that cannot collide with a
		 *      root level route.
		 */
		organization({
			// One source for the numbers the members and invitations pages
			// display. See src/auth/permissions.ts.
			membershipLimit: ORG_MEMBERSHIP_LIMIT,
			invitationLimit: ORG_INVITATION_LIMIT,
			invitationExpiresIn: ORG_INVITATION_TTL_SECONDS,
			// A second invite for the same address replaces the old link instead
			// of leaving two live invitations behind.
			cancelPendingInvitationsOnReInvite: true,
			// Invitation ids are visible to every member through the pending
			// list, so accepting, rejecting or reading one also requires a
			// verified email. Password accounts verify before they can sign
			// in, and the magic link path proves the mailbox and clears any
			// unproven credentials before it creates the session.
			requireEmailVerificationOnInvitation: true,
			/**
			 * Deliver the invitation as a single use link.
			 *
			 * The URL points at the web app, not the API, so the accept page
			 * can explain the state (expired, canceled, wrong account) before
			 * anything is accepted.
			 */
			sendInvitationEmail: async ({
				id,
				email,
				organization: invitedOrganization,
				inviter,
				invitation,
			}) => {
				const url = new URL(
					`/invite/${encodeURIComponent(id)}`,
					serverEnv.webUrl,
				);

				await enqueueEmail({
					to: email,
					template: "organization-invitation",
					url: url.toString(),
					organizationName: invitedOrganization.name,
					inviterName: inviter.user.name || inviter.user.email,
					role: invitation.role ?? "member",
					expiresAt: invitation.expiresAt,
				});
			},
			organizationHooks: {
				beforeCreateOrganization: async ({ organization: draft }) => {
					const name =
						typeof draft.name === "string"
							? validateOrganizationName(draft.name)
							: draft.name;
					const slug =
						typeof draft.slug === "string"
							? validateOrganizationSlug(draft.slug)
							: draft.slug;

					return { data: { ...draft, name, slug } };
				},
				beforeUpdateOrganization: async ({ organization: patch }) => {
					const data = { ...patch };

					if (typeof data.name === "string") {
						data.name = validateOrganizationName(data.name);
					}

					if (typeof data.slug === "string") {
						data.slug = validateOrganizationSlug(data.slug);
					}

					return { data };
				},
				beforeAddMember: async ({ member: newMember }) => {
					assertAllowedRoles(newMember.role);
				},
				beforeCreateInvitation: async ({ invitation }) => {
					assertAllowedRoles(invitation.role);
				},
				beforeUpdateMemberRole: async ({ newRole }) => {
					assertAllowedRoles(newRole);
				},
			},
		}),
		...(isDevelopment ? [openAPI()] : []),
	],
	trustedOrigins: [
		authEnv.url,
		// The web origin is what the browser sends. In production this is the
		// public app URL, so it must not be left as a localhost default.
		serverEnv.webUrl,
		// Local ports stay allowed in development only. Keeping them out of
		// production avoids trusting an origin that can never be correct there.
		...(isDevelopment
			? ["http://localhost:3000", "http://localhost:3001"]
			: []),
	],
});

export type Auth = typeof auth;
