/**
 * Centralised environment configuration for the API.
 *
 * All environment reads live here so the rest of the codebase never touches
 * Bun.env or process.env directly. Values are read at runtime.
 *
 * Note: `bun build --compile` statically replaces `process.env.NODE_ENV` at
 * build time, so runtime flags read from Bun.env instead.
 *
 * Used by: src/index.ts, src/db/index.ts, src/auth/auth.ts,
 * src/lib/mailer.tsx, src/lib/redis.ts.
 */

function readString(key: string, fallback?: string): string {
	return Bun.env[key] ?? fallback ?? "";
}

function readNumber(key: string, fallback: number): number {
	const value = Bun.env[key];
	if (!value) return fallback;
	const parsed = Number(value);
	return Number.isNaN(parsed) ? fallback : parsed;
}

function readBoolean(key: string, fallback: boolean): boolean {
	const value = Bun.env[key];
	if (!value) return fallback;
	return value === "true";
}

/** Runtime environment flags. */
export const nodeEnv = readString("NODE_ENV", "development");
export const isDevelopment = nodeEnv === "development";
export const isProduction = nodeEnv === "production";
export const isTest = nodeEnv === "test";

/** HTTP server settings. */
export const serverEnv = {
	port: readNumber("PORT", 3001),
	host: readString("HOST", "0.0.0.0"),
	webUrl: readString("WEB_URL", "http://localhost:3000"),
};

/** PostgreSQL connection settings. */
export const databaseEnv = {
	url: readString("DATABASE_URL"),
	poolMax: readNumber("DB_POOL_MAX", 10),
};

/** Redis connection settings. */
export const redisEnv = {
	url: readString("REDIS_URL", "redis://localhost:6379"),
	password: Bun.env.REDIS_PASSWORD || undefined,
};

/** Better Auth settings and social providers. */
export const authEnv = {
	secret: readString("BETTER_AUTH_SECRET"),
	url: readString("BETTER_AUTH_URL", "http://localhost:3001"),
	github: {
		clientId: readString("GITHUB_CLIENT_ID"),
		clientSecret: readString("GITHUB_CLIENT_SECRET"),
	},
	google: {
		clientId: readString("GOOGLE_CLIENT_ID"),
		clientSecret: readString("GOOGLE_CLIENT_SECRET"),
	},
};

/** Nodemailer / SMTP settings. */
export const smtpEnv = {
	host: readString("SMTP_HOST", "localhost"),
	port: readNumber("SMTP_PORT", 587),
	secure: readBoolean("SMTP_SECURE", false),
	user: readString("SMTP_USER"),
	pass: readString("SMTP_PASS"),
	from: readString("SMTP_FROM", "Handoff <[email protected]>"),
};

/** S3-compatible object storage (SeaweedFS) settings. */
export const s3Env = {
	endpoint: readString("S3_ENDPOINT", "http://seaweedfs:8333"),
	accessKey: readString("S3_ACCESS_KEY", "admin"),
	secretKey: readString("S3_SECRET_KEY", "admin"),
	bucket: readString("S3_BUCKET", "handoff"),
	region: readString("S3_REGION", "us-east-1"),
	useSsl: readBoolean("S3_USE_SSL", false),
};
