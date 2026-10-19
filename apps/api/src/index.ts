import { Elysia } from "elysia";

import { db } from "./db";
import { users } from "./db/schema";

const port = Number(process.env.PORT ?? 3001);
// Elysia defaults to "localhost", which is unreachable from outside the
// container. Bind every interface so the published port actually works.
const hostname = process.env.HOST ?? "0.0.0.0";

const app = new Elysia()
	.get("/", () => "Hello Huzaifa")
	.get("/health", () => ({ status: "ok" }))
	.get("/users", async () => db.select().from(users))
	.listen({ port, hostname });

console.log(
	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);
