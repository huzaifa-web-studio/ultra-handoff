"use client";

/**
 * The mention chip shown inside a comment.
 *
 * Why one component for editing and reading: the stored node is the same, and
 * the only difference is whether the chip is clickable. Rendering a read only
 * comment through `PlateStatic` still reaches this component, so a mention looks
 * identical in the composer, an edited comment and the client's view.
 *
 * A stored mention already carries its display name and, for projects and
 * milestones, the project slug. That is enough to render without a lookup, so a
 * comment never waits on a request just to show a name.
 *
 * Used by: comment-kit.tsx.
 */

import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { FlagIcon, FolderIcon, UserIcon } from "lucide-react";
import { PlateElement, type PlateElementProps } from "platejs/react";

import { useEditorStatic } from "../../editor/editor-view-context";
import { useMentionContext } from "./mention-context";
import {
	isSafeSlug,
	type MentionNode,
	type MentionType,
	mentionPrefix,
	parseMentionKey,
} from "./mention-key";

/** The icon for one mention type. */
function MentionIcon({ type }: { type: MentionType }) {
	if (type === "user")
		return <UserIcon className="size-3 shrink-0" aria-hidden />;
	if (type === "project") {
		return <FolderIcon className="size-3 shrink-0" aria-hidden />;
	}

	return <FlagIcon className="size-3 shrink-0" aria-hidden />;
}

/** The shared chip presentation. */
const chipClass =
	"mx-0.5 inline-flex items-center gap-1 border border-app-border-strong bg-app-panel-subtle px-1 py-0 align-baseline text-[0.8125rem] font-medium text-app-text";

export function MentionElement(props: PlateElementProps) {
	const mention = props.element as unknown as MentionNode;
	const target = parseMentionKey(mention.key);
	const staticRender = useEditorStatic();
	const context = useMentionContext();

	// A malformed node should never reach the renderer, but a plain span is a
	// safer fallback than crashing a whole discussion.
	if (!target) {
		return <PlateElement {...props} as="span" />;
	}

	const value = typeof mention.value === "string" ? mention.value : "";
	const slug = isSafeSlug(mention.slug) ? mention.slug : null;
	const linkable = target.type !== "user" && context !== null && slug !== null;

	const chip = (
		<PlateElement
			{...props}
			as="span"
			attributes={{
				...props.attributes,
				contentEditable: false,
			}}
			className={cn(chipClass, linkable && "cursor-pointer", props.className)}
		>
			<MentionIcon type={target.type} />
			<span>
				{mentionPrefix(target.type)}
				{value}
			</span>
			{props.children}
		</PlateElement>
	);

	// A project or milestone chip is clickable in both the composer and a posted
	// comment. In the composer it opens a new tab, so checking where a mention
	// goes never throws away the draft.
	if (!linkable || !context) return chip;

	const href =
		target.type === "project"
			? `/${context.orgSlug}/projects/${slug}`
			: `/${context.orgSlug}/projects/${slug}/milestones?milestone=${target.id}`;

	/**
	 * Composer link.
	 *
	 * A plain anchor inside a contenteditable does not reliably navigate: the
	 * editor consumes the mouse event to manage the selection. Opening on
	 * mousedown is a real user gesture, keeps the draft, and does not depend on
	 * Slate forwarding a click.
	 */
	if (!staticRender) {
		const open = () => window.open(href, "_blank", "noopener,noreferrer");

		return (
			<a
				href={href}
				target="_blank"
				rel="noreferrer noopener"
				className="cursor-pointer no-underline"
				onMouseDown={(event) => {
					if (event.button !== 0) return;

					event.preventDefault();
					event.stopPropagation();
					open();
				}}
				onClick={(event) => {
					event.preventDefault();
					event.stopPropagation();
				}}
				onKeyDown={(event) => {
					if (event.key !== "Enter") return;

					event.preventDefault();
					open();
				}}
			>
				{chip}
			</a>
		);
	}

	if (target.type === "project") {
		return (
			<Link
				to="/$orgSlug/projects/$projectSlug"
				params={{ orgSlug: context.orgSlug, projectSlug: slug }}
				className="no-underline"
			>
				{chip}
			</Link>
		);
	}

	return (
		<Link
			to="/$orgSlug/projects/$projectSlug/milestones"
			params={{ orgSlug: context.orgSlug, projectSlug: slug }}
			search={{ milestone: target.id }}
			className="no-underline"
		>
			{chip}
		</Link>
	);
}
