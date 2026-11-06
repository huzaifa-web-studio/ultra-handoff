"use client";

/**
 * The link preview card.
 *
 * Why one component for both surfaces: the same card is used inside the hover
 * popover and, in a wider layout, as the bookmark block. Only the shell
 * differs, so the metadata rendering, the icon fallback and the copy behaviour
 * live here once.
 *
 * Every value shown is plain text from our own API. The image is our own
 * proxied asset, never the remote URL, which is what keeps a preview from
 * loading a third party tracker into the page.
 *
 * Used by: features/milestones/editor/editor-elements.tsx and
 * features/milestones/editor/editor-bookmark.tsx.
 */

import { Button, LinkButton } from "@org/ui/components/button";
import { Separator } from "@org/ui/components/separator";
import { cn } from "cn";
import {
	BookmarkIcon,
	CheckIcon,
	CircleDotIcon,
	CopyIcon,
	ExternalLinkIcon,
	LinkIcon,
	LoaderCircleIcon,
	MessageSquareTextIcon,
	MinusIcon,
	PencilIcon,
	PlusIcon,
	StarIcon,
	UnlinkIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { resolveAssetUrl } from "#/lib/files";
import type { LinkPreview } from "./api";
import { displayDomain, shortenUrl } from "./utils";

/** How long the "Copied" label stays before it reverts. */
const COPY_FEEDBACK_MS = 1_500;

/** Small non-blocking progress cue while the background resolver fills the card. */
function PreviewLoading() {
	return (
		<output className="flex items-center gap-1.5 text-xs text-app-text-muted">
			<LoaderCircleIcon aria-hidden className="size-3 animate-spin" />
			Loading preview
		</output>
	);
}

/** Provider fields that read best as compact numeric metrics. */
const PROVIDER_METRIC_ICONS: Record<string, typeof PlusIcon> = {
	additions: PlusIcon,
	deletions: MinusIcon,
	comments: MessageSquareTextIcon,
	stars: StarIcon,
};

/** Format a provider status with a calm, familiar state treatment. */
function statusClass(value: string): string {
	const status = value.toLowerCase();
	if (
		["merged", "closed", "resolved", "complete", "completed"].includes(status)
	) {
		return "border-success/30 bg-success-bg text-success";
	}
	if (["open", "in progress", "in review"].includes(status)) {
		return "border-app-action/30 bg-app-selected text-app-action";
	}
	return "border-app-border bg-app-panel-subtle text-app-text-muted";
}

/** Present provider metadata with hierarchy instead of a flat label/value list. */
function ProviderDetails({
	providerData,
}: {
	providerData: NonNullable<LinkPreview["providerData"]>;
}) {
	const status = providerData.fields.find(
		({ label }) => label.toLowerCase() === "status",
	);
	const summary = providerData.fields.find(
		({ label }) => label.toLowerCase() === "summary",
	);
	const metrics = providerData.fields.filter(({ label }) =>
		Object.hasOwn(PROVIDER_METRIC_ICONS, label.toLowerCase()),
	);
	const details = providerData.fields.filter(
		({ label }) =>
			label.toLowerCase() !== "status" &&
			label.toLowerCase() !== "summary" &&
			!Object.hasOwn(PROVIDER_METRIC_ICONS, label.toLowerCase()),
	);

	return (
		<div className="flex flex-col gap-2 border-t border-app-border pt-2">
			<div className="flex min-w-0 items-center justify-between gap-2">
				<span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-app-text">
					<CircleDotIcon
						aria-hidden
						className="size-3.5 shrink-0 text-app-text-muted"
					/>
					<span className="truncate">{providerData.kind}</span>
				</span>
				{status ? (
					<span
						className={cn(
							"shrink-0 border px-2 py-0.5 text-[0.65rem] font-semibold capitalize",
							statusClass(status.value),
						)}
					>
						{status.value}
					</span>
				) : null}
			</div>

			{metrics.length ? (
				<dl className="grid grid-cols-3 gap-1.5">
					{metrics.map(({ label, value }) => {
						const normalizedLabel = label.toLowerCase();
						const Icon =
							PROVIDER_METRIC_ICONS[normalizedLabel] ?? CircleDotIcon;
						const metricColor =
							normalizedLabel === "additions"
								? "text-success"
								: normalizedLabel === "deletions"
									? "text-danger"
									: "text-app-text-muted";
						return (
							<div
								key={`${label}:${value}`}
								className="flex min-w-0 items-center gap-2 border border-app-border bg-app-panel-subtle px-2 py-1.5"
							>
								<Icon
									aria-hidden
									className={cn("size-3.5 shrink-0", metricColor)}
								/>
								<div className="min-w-0">
									<dd className="truncate text-sm font-semibold tabular-nums text-app-text">
										{value}
									</dd>
									<dt className="truncate text-[0.6rem] leading-tight text-app-text-muted">
										{label}
									</dt>
								</div>
							</div>
						);
					})}
				</dl>
			) : null}

			{summary ? (
				<div className="min-w-0 border-l-2 border-app-border-strong pl-2">
					<dt className="mb-0.5 text-[0.6rem] font-semibold tracking-wide text-app-text-muted uppercase">
						{summary.label}
					</dt>
					<dd className="line-clamp-2 break-words text-xs leading-relaxed text-app-text">
						{summary.value}
					</dd>
				</div>
			) : null}

			{details.length ? (
				<dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-app-border/70 pt-1.5 text-xs">
					{details.map(({ label, value }) => (
						<div key={`${label}:${value}`} className="min-w-0">
							<dt className="truncate text-app-text-muted">{label}</dt>
							<dd className="truncate font-medium text-app-text">{value}</dd>
						</div>
					))}
				</dl>
			) : null}
		</div>
	);
}

/** Which value was copied last, so only that button changes label. */
type CopyTarget = "link" | "text";

/**
 * Clipboard copy with inline confirmation.
 *
 * A success changes the button label rather than firing a toast, because a
 * toast for every copy is noise. A failure is real news and gets a toast,
 * since a silent failure would leave the user believing it worked.
 */
function useCopyFeedback() {
	const [copied, setCopied] = useState<CopyTarget | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		return () => {
			if (timer.current) clearTimeout(timer.current);
		};
	}, []);

	const copy = useCallback(async (target: CopyTarget, value: string) => {
		try {
			if (!navigator.clipboard) throw new Error("Clipboard unavailable");

			await navigator.clipboard.writeText(value);

			setCopied(target);

			if (timer.current) clearTimeout(timer.current);
			timer.current = setTimeout(() => setCopied(null), COPY_FEEDBACK_MS);
		} catch {
			toast.error("Could not copy. Select the link and copy it manually.");
		}
	}, []);

	return { copied, copy };
}

/**
 * Favicon, or a letter tile when there is none.
 *
 * The fallback is deliberately not an empty box: a preview for a site without
 * an icon would otherwise look broken.
 */
export function PreviewFavicon({
	preview,
	className,
}: {
	preview?: LinkPreview;
	className?: string;
}) {
	const src = resolveAssetUrl(preview?.faviconUrl);

	if (src) {
		return (
			<img
				src={src}
				alt=""
				aria-hidden
				className={cn("size-4 shrink-0 object-contain", className)}
				loading="lazy"
				decoding="async"
			/>
		);
	}

	const letter = (preview?.domain ?? "").trim().charAt(0).toUpperCase();

	return (
		<span
			aria-hidden
			className={cn(
				"flex size-4 shrink-0 items-center justify-center border border-app-border bg-app-panel-subtle text-[0.55rem] font-semibold text-app-text-muted uppercase",
				className,
			)}
		>
			{letter || <LinkIcon className="size-2.5" />}
		</span>
	);
}

/** The three safe actions. Structural actions live in the link toolbar. */
function PreviewActions({ href, text }: { href: string; text?: string }) {
	const { copied, copy } = useCopyFeedback();

	return (
		<>
			<Separator />
			<div className="flex flex-nowrap items-center gap-0.5 p-1">
				<LinkButton
					href={href}
					target="_blank"
					rel="noopener noreferrer"
					variant="ghost"
					size="xs"
				>
					<ExternalLinkIcon aria-hidden />
					Open
				</LinkButton>

				{/*
				 * The visible label is short so all three actions fit on one
				 * line. The copy icon plus the aria-label carry the meaning.
				 */}
				<Button
					variant="ghost"
					size="xs"
					aria-label="Copy link"
					onPress={() => void copy("link", href)}
				>
					{copied === "link" ? (
						<CheckIcon aria-hidden />
					) : (
						<CopyIcon aria-hidden />
					)}
					{copied === "link" ? "Copied" : "Link"}
				</Button>

				{text ? (
					<Button
						variant="ghost"
						size="xs"
						aria-label="Copy text"
						onPress={() => void copy("text", text)}
					>
						{copied === "text" ? (
							<CheckIcon aria-hidden />
						) : (
							<CopyIcon aria-hidden />
						)}
						{copied === "text" ? "Copied" : "Text"}
					</Button>
				) : null}
			</div>

			{/* Announces the change to a screen reader without moving focus. */}
			<span aria-live="polite" className="sr-only">
				{copied ? "Copied" : ""}
			</span>
		</>
	);
}

/**
 * Editing actions that only exist where there is an editor.
 *
 * The read only view omits all three, so a client never sees a control that
 * cannot work for them.
 */
export type LinkPreviewEditorActions = {
	onEdit?: () => void;
	onUnlink?: () => void;
	onBookmark?: () => void;
};

/** The structural actions, shown below the safe ones. */
function EditorActions({
	onEdit,
	onUnlink,
	onBookmark,
}: LinkPreviewEditorActions) {
	if (!onEdit && !onUnlink && !onBookmark) return null;

	return (
		<>
			<Separator />
			<div className="flex flex-nowrap items-center gap-0.5 p-1">
				{onEdit ? (
					<Button variant="ghost" size="xs" onPress={onEdit}>
						<PencilIcon aria-hidden />
						Edit
					</Button>
				) : null}

				{onUnlink ? (
					<Button variant="ghost" size="xs" onPress={onUnlink}>
						<UnlinkIcon aria-hidden />
						Unlink
					</Button>
				) : null}

				{onBookmark ? (
					<Button variant="ghost" size="xs" onPress={onBookmark}>
						<BookmarkIcon aria-hidden />
						Bookmark
					</Button>
				) : null}
			</div>
		</>
	);
}

/**
 * The hover popover body.
 *
 * The compact form is used when the preview has not resolved yet, when it
 * failed, or when the link points somewhere the previewer refuses to fetch. It
 * still shows the domain and every action, because those need no network.
 */
export function LinkPreviewCard({
	href,
	preview,
	text,
	actions,
}: {
	href: string;
	preview?: LinkPreview;
	text?: string;
	/** Omitted in the read only view. */
	actions?: LinkPreviewEditorActions;
}) {
	const domain = preview?.domain || displayDomain(href);
	const title = preview?.title?.trim();
	const description = preview?.description?.trim();
	const image = resolveAssetUrl(preview?.imageUrl);
	const providerData = preview?.providerData;
	const sourceName = preview?.siteName || providerData?.provider;

	return (
		<div className="flex flex-col">
			{image ? (
				<img
					src={image}
					alt=""
					aria-hidden
					className="h-32 w-full object-cover"
					loading="lazy"
					decoding="async"
				/>
			) : null}

			<div className="flex flex-col gap-1.5 p-3">
				<div className="flex items-center gap-1.5">
					<PreviewFavicon preview={preview} />
					<span className="truncate text-xs text-app-text-muted">{domain}</span>
					{sourceName ? (
						<span className="ml-auto shrink-0 truncate text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase">
							{sourceName}
						</span>
					) : null}
				</div>

				<p className="line-clamp-2 font-display text-sm font-bold text-app-text">
					{title || domain}
				</p>
				{!preview ? <PreviewLoading /> : null}

				{description ? (
					<p className="line-clamp-3 text-xs leading-relaxed text-app-text-muted">
						{description}
					</p>
				) : null}

				{providerData &&
				(providerData.kind !== "Link" || providerData.fields.length > 0) ? (
					<ProviderDetails providerData={providerData} />
				) : null}
			</div>

			<PreviewActions href={href} text={text} />
			{actions ? <EditorActions {...actions} /> : null}
		</div>
	);
}

/**
 * The bookmark block body.
 *
 * The whole card is one link, and repeats the provider details from the hover
 * card so a saved bookmark is useful without hovering it first. Its thumbnail
 * stays in a restrained right-side rail so the text keeps the main column.
 */
export function BookmarkPreview({
	href,
	preview,
	className,
	onClick,
}: {
	href: string;
	preview?: LinkPreview;
	className?: string;
	onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
	const domain = preview?.domain || displayDomain(href);
	const title = preview?.title?.trim();
	const description = preview?.description?.trim();
	const image = resolveAssetUrl(preview?.imageUrl);
	const providerData = preview?.providerData;

	return (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			onClick={onClick}
			className={cn(
				"flex w-full cursor-pointer items-stretch border border-app-border bg-app-panel text-left no-underline transition-colors hover:border-app-border-strong focus-visible:border-app-focus focus-visible:ring-2 focus-visible:ring-app-focus/30 focus-visible:outline-none",
				className,
			)}
		>
			<div className="flex min-w-0 flex-col gap-1.5 p-3">
				<span className="flex min-w-0 items-center gap-1.5 text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase">
					<PreviewFavicon preview={preview} className="size-3.5" />
					<span className="truncate">{domain}</span>
				</span>

				<span className="line-clamp-2 font-display text-sm font-bold text-app-text">
					{title || domain}
				</span>
				{!preview ? <PreviewLoading /> : null}

				{description ? (
					<span className="line-clamp-3 text-xs leading-relaxed text-app-text-muted">
						{description}
					</span>
				) : null}

				{providerData &&
				(providerData.kind !== "Link" || providerData.fields.length > 0) ? (
					<ProviderDetails providerData={providerData} />
				) : null}

				<span className="truncate text-[0.65rem] text-app-text-muted">
					{shortenUrl(href)}
				</span>
			</div>

			{image ? (
				<img
					src={image}
					alt=""
					aria-hidden
					className="max-h-64 w-40 shrink-0 self-stretch border-l border-app-border object-left object-cover sm:w-56"
					loading="lazy"
					decoding="async"
				/>
			) : null}
		</a>
	);
}
