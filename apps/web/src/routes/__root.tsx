import { Toaster } from "@org/ui/components/sonner";
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
import { useEffect, useState } from "react";
import { GlobalLoadingScreen } from "#/components/global-loading";
import { authClient } from "#/features/auth/client";
import { useAuthBroadcast } from "#/features/auth/sync";
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
				title: "Ultra Handoff",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
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
	return null;
}

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				<QueryClientProvider client={queryClient}>
					<AuthBroadcastSync />
					<Toaster position="top-right" />
					{/*
					 * Mounted at the root so the same blocked switch dialog is
					 * available in the app shell and on the create-organization
					 * flow outside it.
					 */}
					<SwitchBlockedDialog />
					{children}
				</QueryClientProvider>
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
				<Scripts />
			</body>
		</html>
	);
}
