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

/**
 * Runtime environment flags.
 *
 * Why the default is production: a bare start (compiled binary, another
 * orchestrator, a hand run process) must fail closed. Development surfaces
 * (Bull Board, OpenAPI, localhost trusted origins) require an explicit
 * `NODE_ENV=development`, which the dev script and the dev compose stack set.
 *
 * The production requirements themselves are enforced at startup by
 * `src/lib/validate-env.ts`.
 */
export const nodeEnv = readString("NODE_ENV", "production");
export const isDevelopment = nodeEnv === "development";
export const isProduction = nodeEnv === "production";
export const isTest = nodeEnv === "test";

/**
 * A fallback that exists outside production.
 *
 * Why: local `bun run dev` and the test suite work with no env file, while a
 * production boot must never inherit a localhost URL or a demo credential. In
 * production this returns an empty string, which the startup check rejects.
 */
function nonProductionFallback(value: string): string {
	return isProduction ? "" : value;
}

/** HTTP server settings. */
export const serverEnv = {
	port: readNumber("PORT", 3001),
	host: readString("HOST", "0.0.0.0"),
	webUrl: readString("WEB_URL", nonProductionFallback("http://localhost:3000")),
};

/**
 * PostgreSQL connection settings.
 *
 * `url` connects as the privileged role (migrations, Better Auth).
 * `appUrl` connects as `app_tenant`, the unprivileged role that row level
 * security applies to. They are deliberately separate: falling back to `url`
 * would silently disable every tenant policy.
 */
export const databaseEnv = {
	url: readString("DATABASE_URL"),
	appUrl: readString("DATABASE_APP_URL"),
	poolMax: readNumber("DB_POOL_MAX", 10),
};

/** Redis connection settings. */
export const redisEnv = {
	url: readString("REDIS_URL", nonProductionFallback("redis://localhost:6379")),
	password: Bun.env.REDIS_PASSWORD || undefined,
};

/**
 * Realtime WebSocket settings.
 *
 * `pingIntervalMs` is the server side liveness probe. It has to stay below the
 * idle timeout of any proxy in front of the API, or the proxy silently drops a
 * quiet socket. `maxConnectionMs` forces a periodic reconnect so a membership
 * change or a revoked session cannot stream forever. The frame limits protect
 * the process from a broken client, not from a person.
 */
export const realtimeEnv = {
	pingIntervalMs: readNumber("REALTIME_PING_INTERVAL_MS", 25_000),
	maxConnectionMs: readNumber("REALTIME_MAX_CONNECTION_MS", 30 * 60 * 1000),
	maxFrameBytes: readNumber("REALTIME_MAX_FRAME_BYTES", 16 * 1024),
	maxFramesPerSecond: readNumber("REALTIME_MAX_FRAMES_PER_SECOND", 20),
};

/** Better Auth settings and social providers. */
export const authEnv = {
	secret: readString("BETTER_AUTH_SECRET"),
	url: readString(
		"BETTER_AUTH_URL",
		nonProductionFallback("http://localhost:3001"),
	),
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

/**
 * S3-compatible object storage (SeaweedFS) settings.
 *
 * `endpoint` is the address the API uses for server to server calls.
 * `publicEndpoint` is the address a browser uses for presigned uploads. They
 * are deliberately separate: inside Docker the service name resolves, but the
 * user's browser cannot resolve `seaweedfs`. The public endpoint must be a
 * reverse proxy that preserves the Host header, because the host is part of
 * the SigV4 signature.
 *
 * The old fallback reused `S3_ENDPOINT` here, which silently produced a
 * `http://seaweedfs:8333/...` URL that no browser could open. In development
 * the fallback is now the published host port. In production it stays empty
 * on purpose, and signing fails with a clear error until the operator sets a
 * real public URL.
 */
export const s3Env = {
	endpoint: readString("S3_ENDPOINT", "http://seaweedfs:8333"),
	publicEndpoint:
		readString("S3_PUBLIC_ENDPOINT") ||
		(isDevelopment
			? `http://localhost:${readNumber("S3_PUBLIC_PORT", 8333)}`
			: ""),
	accessKey: readString("S3_ACCESS_KEY", nonProductionFallback("admin")),
	secretKey: readString("S3_SECRET_KEY", nonProductionFallback("admin")),
	bucket: readString("S3_BUCKET", "handoff"),
	region: readString("S3_REGION", "us-east-1"),
	useSsl: readBoolean("S3_USE_SSL", false),
};
