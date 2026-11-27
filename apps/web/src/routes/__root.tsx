import { Toaster } from "@org/ui/components/sonner";
import { ThemeProvider } from "@org/ui/components/theme-provider";
import appCss from "@org/ui/styles/global.css?url";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { useEffect, useRef, useState } from "react";
import { GlobalLoadingScreen } from "#/components/global-loading";
import { authClient } from "#/features/auth/client";
import { useAuthBroadcast } from "#/features/auth/sync";
import { FileViewerProvider } from "#/features/files/file-viewer-provider";
import { SwitchBlockedDialog } from "#/features/organization/switch-blocked-dialog";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				name: "description",
				content:
					"Handoff is a client-facing project delivery and approval platform for agencies, freelancers and service-based teams.",
			},
			{
				title: "Ultra Handoff",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
			/*
			 * The .ico keeps `/favicon.ico` a 200 for clients that request it
			 * directly, and the SVG is the crisp icon every modern browser
			 * prefers.
			 */
			{
				rel: "icon",
				href: "/favicon.ico",
				sizes: "32x32",
			},
			{
				rel: "icon",
				href: "/favicon.svg",
				type: "image/svg+xml",
			},
		],
	}),
	shellComponent: RootDocument,
	component: RootComponent,
});

/**
 * Root route component. Gates the entire route tree behind a global loading
 * screen until both the document has finished loading and the Better Auth
 * session has settled. This prevents premature flashes of page content on
 * hard reloads. State latches to ready so the gate only applies to the
 * initial bootstrap, never to later client-side navigations.
 */
function RootComponent() {
	const { isPending } = authClient.useSession();

	const [pageReady, setPageReady] = useState(
		typeof document !== "undefined" && document.readyState === "complete",
	);
	useEffect(() => {
		if (pageReady) return;
		const handler = () => setPageReady(true);
		window.addEventListener("load", handler);
		return () => window.removeEventListener("load", handler);
	}, [pageReady]);

	const [sessionReady, setSessionReady] = useState(false);
	useEffect(() => {
		if (!isPending) setSessionReady(true);
	}, [isPending]);

	if (!pageReady || !sessionReady) {
		return <GlobalLoadingScreen />;
	}
	return <Outlet />;
}

const queryClient = new QueryClient();

/**
 * Mounts the cross-tab auth broadcast receiver once for the whole app.
 * Kept as a component so the hook runs inside the React tree.
 */
function AuthBroadcastSync() {
	useAuthBroadcast();

	/*
	 * A shared browser can sign out and sign a second person in without a full
	 * page reload. Query keys are not user scoped, so the previous person's
	 * projects and messages would otherwise be served from cache to the next
	 * person until they go stale. Clearing on a settled user change makes every
	 * sign in a fresh visit.
	 */
	const { data: session, isPending } = authClient.useSession();
	const previousUserId = useRef<string | null | undefined>(undefined);

	useEffect(() => {
		if (isPending) return;

		const userId = session?.user.id ?? null;

		// The first settled session is the baseline, not a change to clear for.
		if (previousUserId.current === undefined) {
			previousUserId.current = userId;
			return;
		}

		if (previousUserId.current === userId) return;

		previousUserId.current = userId;
		queryClient.clear();
	}, [isPending, session?.user.id]);

	return null;
}

function RootDocument({ children }: { children: React.ReactNode }) {
	/*
	 * Devtools are development only. A production build must not mount the
	 * floating panel or keep reading its persisted state, so the two keys the
	 * panel writes are cleared once per visit.
	 */
	useEffect(() => {
		if (import.meta.env.DEV) return;

		window.localStorage.removeItem("pip_open");
		window.localStorage.removeItem("tanstack_devtools_settings");
	}, []);

	return (
		/*
		 * `suppressHydrationWarning` is required by the theme provider. Its
		 * pre-paint script writes `class="dark"` and `color-scheme` on this
		 * element before React hydrates, so the server and client attribute
		 * sets differ by design.
		 */
		<html lang="en" suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body>
				<ThemeProvider>
					<QueryClientProvider client={queryClient}>
						<FileViewerProvider>
							<AuthBroadcastSync />
							<Toaster position="top-right" />
							{/*
							 * Mounted at the root so the same blocked switch dialog is
							 * available in the app shell and on the create-organization
							 * flow outside it.
							 */}
							<SwitchBlockedDialog />
							{children}
						</FileViewerProvider>
					</QueryClientProvider>
				</ThemeProvider>
				{/*
				 * Development only. Rendering this unconditionally shipped the
				 * devtools bundle and its floating trigger to every production
				 * user. `import.meta.env.DEV` is statically replaced, so the whole
				 * block, and the imports it alone uses, are dropped from the
				 * production bundle.
				 */}
				{import.meta.env.DEV && (
					<TanStackDevtools
						config={{
							position: "bottom-right",
						}}
						plugins={[
							{
								name: "Tanstack Router",
								render: <TanStackRouterDevtoolsPanel />,
							},
						]}
					/>
				)}
				<Scripts />
			</body>
		</html>
	);
}
