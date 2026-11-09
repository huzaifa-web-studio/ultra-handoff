/**
 * Fail-closed production environment check.
 *
 * Why this exists: `env.ts` has non-production fallbacks so local work needs no
 * env file, and a deployment that forgot to set a value used to inherit those
 * fallbacks silently. In production the values are now empty instead, and this
 * module turns that into one clear startup error before the server listens.
 *
 * Only production is checked. Development and test keep their local fallbacks.
 *
 * Used by: src/lib/validate-boot.ts, which src/index.ts imports first.
 * Tested by: src/lib/validate-env.test.ts.
 */

/** Every variable the API cannot start without in production. */
const REQUIRED_IN_PRODUCTION = [
	"DATABASE_URL",
	"DATABASE_APP_URL",
	"BETTER_AUTH_SECRET",
	"BETTER_AUTH_URL",
	"WEB_URL",
	"REDIS_URL",
	"S3_ACCESS_KEY",
	"S3_SECRET_KEY",
	"S3_PUBLIC_ENDPOINT",
	"SMTP_HOST",
	"SMTP_FROM",
] as const;

/** Variables that must be absolute http(s) URLs when present. */
const URL_VARIABLES = [
	"BETTER_AUTH_URL",
	"WEB_URL",
	"S3_PUBLIC_ENDPOINT",
] as const;

/**
 * Variables that must look like a mailbox address when present.
 *
 * Why only an `@` check: the sender reaches Nodemailer as a whole
 * `Name <address>` string, and fully parsing RFC 5322 here would reject
 * legitimate senders. An `@` catches the realistic mistake, which is an empty
 * or hostname-only value that fails at send time instead of at boot.
 */
const SENDER_VARIABLES = ["SMTP_FROM"] as const;

type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * An unset NODE_ENV is production, matching `nodeEnv` in env.ts.
 *
 * Why not check `isProduction` here: the check has to be testable with a plain
 * object, without mutating the process environment.
 */
function isProductionNodeEnv(source: EnvSource): boolean {
	return (source.NODE_ENV ?? "production") === "production";
}

/** True when the value is missing or only whitespace. */
function isBlank(value: string | undefined): boolean {
	return !value?.trim();
}

/**
 * Collect every production configuration problem in one pass.
 *
 * Exported so the rule can be tested directly. The returned strings are meant
 * for an operator, not for an end user.
 */
export function findProductionEnvProblems(source: EnvSource): string[] {
	if (!isProductionNodeEnv(source)) return [];

	const problems: string[] = [];

	const missing = REQUIRED_IN_PRODUCTION.filter((key) => isBlank(source[key]));
	if (missing.length > 0) {
		problems.push(`missing: ${missing.join(", ")}`);
	}

	const invalidUrls = URL_VARIABLES.filter((key) => {
		const value = source[key]?.trim();
		// A missing value is already reported above, so only check the shape of
		// values that were supplied.
		return value ? !/^https?:\/\//i.test(value) : false;
	});
	if (invalidUrls.length > 0) {
		problems.push(`not an absolute http(s) URL: ${invalidUrls.join(", ")}`);
	}

	const invalidSenders = SENDER_VARIABLES.filter((key) => {
		const value = source[key]?.trim();
		// A missing value is already reported above, so only check the shape of
		// values that were supplied.
		return value ? !value.includes("@") : false;
	});
	if (invalidSenders.length > 0) {
		problems.push(
			`not a mailbox address (must contain @): ${invalidSenders.join(", ")}`,
		);
	}

	// Row level security is only enforced for the unprivileged app role, so a
	// deployment that points both URLs at the owner role has silently disabled
	// tenant isolation. Catch that here instead of in a data leak.
	const adminUrl = source.DATABASE_URL?.trim();
	const tenantUrl = source.DATABASE_APP_URL?.trim();
	if (adminUrl && tenantUrl && adminUrl === tenantUrl) {
		problems.push(
			"DATABASE_APP_URL must not equal DATABASE_URL: tenant queries must use the unprivileged app_tenant role",
		);
	}

	return problems;
}

/**
 * Throw a single actionable error when the production environment is invalid.
 *
 * Why one error: an operator fixes a missing deployment variable once. Reporting
 * one at a time turns that into several restart cycles.
 */
export function assertProductionEnv(source: EnvSource = Bun.env): void {
	const problems = findProductionEnvProblems(source);
	if (problems.length === 0) return;

	throw new Error(
		`Refusing to start in production with an invalid environment. ${problems.join("; ")}.`,
	);
}
