"use client";

/**
 * Continuous PDF preview.
 *
 * Why PDF.js instead of an iframe: the API sends some attachments with an
 * attachment disposition, browsers disagree about their built in viewer, and an
 * iframe cannot be styled or virtualised. PDF.js renders to canvases inside the
 * dialog and behaves the same everywhere.
 *
 * Why pages are virtualised: a canvas per page is expensive. Only the pages
 * near the viewport are mounted, so a 400 page PDF scrolls while holding a
 * handful of canvases instead of four hundred. A placeholder keeps the scroll
 * height stable while a page is not rendered, and the real page ratio is stored
 * after the first render so returning to it does not jump.
 *
 * Used by: features/files/file-viewer-dialog.tsx.
 */

import { Button } from "@org/ui/components/button";
import { ArrowUpIcon } from "lucide-react";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

import type { ViewerProps } from "../viewer-types";
import { ViewerMessage } from "./viewer-message";

// The worker has to be a real URL, which Vite emits for the `?url` import.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Default canvas width before the container has been measured. */
const FALLBACK_WIDTH = 640;

/** Smallest and largest page width rendered, in pixels. */
const MIN_WIDTH = 160;
const MAX_WIDTH = 1100;

/** A4 height divided by width. Replaced by the real ratio after a page renders. */
const DEFAULT_PAGE_RATIO = 1.294;

/** How far outside the viewport a page stays mounted, in pixels. */
const RENDER_MARGIN = 1_200;

/**
 * The API does not implement byte ranges, and a range request would need an
 * extra CORS preflight. Full downloads are fine for the sizes the upload policy
 * allows. The object is shared across renders so PDF.js never sees a new
 * options object and restarts the document.
 */
const PDF_OPTIONS = {
	disableRange: true,
	disableStream: true,
	isEvalSupported: false,
	// Attachments are member gated, so PDF.js has to send the session cookie
	// with its cross origin request.
	withCredentials: true,
} as const;

/** Only the viewport API is needed to read a page ratio. */
type LoadedPage = {
	getViewport: (options: { scale: number }) => {
		height: number;
		width: number;
	};
};

/** Only the page access used to measure a page before it is mounted. */
type LoadedDocument = {
	numPages: number;
	getPage: (pageNumber: number) => Promise<LoadedPage>;
};

type RegisterPage = (
	element: Element,
	onChange: (visible: boolean) => void,
) => () => void;

type RegisterSpy = (element: Element, pageNumber: number) => () => void;

/**
 * One page slot.
 *
 * The slot always exists in the scroll flow. Only the canvas inside it comes and
 * goes, which is what keeps the scrollbar stable and the memory bounded.
 *
 * The ratio is read from the document before the canvas mounts, so a landscape
 * page does not reserve an A4 height and then jump when it appears.
 *
 * Why memo: the footer page counter changes while scrolling. Without memo every
 * scroll spy update would re-render every slot, which on a long PDF is exactly
 * the jank virtualisation is meant to avoid.
 */
const LazyPdfPage = memo(function LazyPdfPage({
	pageNumber,
	width,
	pdfDocument,
	registerPage,
	registerSpy,
}: {
	pageNumber: number;
	width: number;
	pdfDocument: LoadedDocument | null;
	registerPage: RegisterPage;
	registerSpy: RegisterSpy;
}) {
	const holderRef = useRef<HTMLDivElement>(null);
	const [visible, setVisible] = useState(false);
	const [ratio, setRatio] = useState(DEFAULT_PAGE_RATIO);
	const [ratioKnown, setRatioKnown] = useState(false);

	const placeholderHeight = Math.round(width * ratio);

	useEffect(() => {
		const element = holderRef.current;

		if (!element) return;

		const unregisterPage = registerPage(element, setVisible);
		const unregisterSpy = registerSpy(element, pageNumber);

		return () => {
			unregisterPage();
			unregisterSpy();
		};
	}, [pageNumber, registerPage, registerSpy]);

	// Measure the page before mounting its canvas. PDF.js has the page metadata
	// in memory already, so this is cheap and avoids a layout jump.
	useEffect(() => {
		if (!visible || ratioKnown || !pdfDocument) return;

		let cancelled = false;

		pdfDocument
			.getPage(pageNumber)
			.then((page) => {
				if (cancelled) return;

				const viewport = page.getViewport({ scale: 1 });

				if (viewport.width > 0) setRatio(viewport.height / viewport.width);
				setRatioKnown(true);
			})
			.catch(() => {
				// Keep the default ratio. The page can still render.
				if (!cancelled) setRatioKnown(true);
			});

		return () => {
			cancelled = true;
		};
	}, [visible, ratioKnown, pdfDocument, pageNumber]);

	// Store the rendered page ratio as a fallback if the measure call failed.
	const handleLoadSuccess = useCallback((page: LoadedPage) => {
		const viewport = page.getViewport({ scale: 1 });

		if (viewport.width > 0) setRatio(viewport.height / viewport.width);
	}, []);

	const renderPage = visible && (ratioKnown || !pdfDocument);

	return (
		<div
			ref={holderRef}
			data-page-number={pageNumber}
			className="mb-3 max-w-full"
			style={renderPage ? { width } : { width, height: placeholderHeight }}
		>
			{renderPage ? (
				<Page
					pageNumber={pageNumber}
					width={width}
					renderTextLayer={false}
					renderAnnotationLayer={false}
					onLoadSuccess={handleLoadSuccess}
					loading={
						<div
							style={{ height: placeholderHeight, width }}
							className="bg-app-panel"
						/>
					}
					className="border border-app-border bg-app-panel"
				/>
			) : (
				<div
					aria-hidden
					style={{ height: placeholderHeight, width }}
					className="bg-app-panel"
				/>
			)}
		</div>
	);
});

export default function PdfViewer({ src }: ViewerProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [numPages, setNumPages] = useState(0);
	const [pdfDocument, setPdfDocument] = useState<LoadedDocument | null>(null);
	const [width, setWidth] = useState(FALLBACK_WIDTH);
	const [failed, setFailed] = useState(false);
	const [currentPage, setCurrentPage] = useState(1);

	/**
	 * One observer for page mounting and one for the page counter.
	 *
	 * Why shared: a page list can be hundreds of items, and one observer per
	 * page would mean thousands of observer objects. Both observers keep a map
	 * from the slot element to its callback.
	 */
	const mountListeners = useRef(new Map<Element, (visible: boolean) => void>());
	const mountObserver = useRef<IntersectionObserver | null>(null);
	const spyListeners = useRef(new Map<Element, number>());
	const spyObserver = useRef<IntersectionObserver | null>(null);

	const handleLoadSuccess = useCallback((document: LoadedDocument) => {
		setPdfDocument(document);
		setNumPages(document.numPages);
		setCurrentPage((current) => Math.min(current, document.numPages));
		setFailed(false);
	}, []);

	const handleLoadError = useCallback(() => {
		setFailed(true);
	}, []);

	/**
	 * Fit the pages to the dialog width.
	 *
	 * Why not ResizeObserver on the container: the pages are children of that
	 * container. A rendered page can add a scrollbar, which changes the
	 * measured width, which changes the page, and the two chase each other.
	 * The dialog only changes width when the window does, so a one time measure
	 * plus a window resize listener is stable.
	 */
	useEffect(() => {
		function measure(): void {
			const element = scrollRef.current;

			if (!element) return;

			// clientWidth excludes a scrollbar that is already present. The extra
			// allowance covers the scrollbar that appears once pages overflow, so
			// a page never ends up 17px too wide.
			const available = element.clientWidth - 40;
			const next = Math.round(
				Math.min(Math.max(available, MIN_WIDTH), MAX_WIDTH),
			);

			// Ignore tiny differences so a layout rounding cannot oscillate.
			setWidth((current) => (Math.abs(current - next) < 8 ? current : next));
		}

		measure();
		window.addEventListener("resize", measure);

		return () => window.removeEventListener("resize", measure);
	}, []);

	// Mount pages that are within, or close to, the viewport.
	useEffect(() => {
		const root = scrollRef.current;

		if (!root) return;

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					mountListeners.current.get(entry.target)?.(entry.isIntersecting);
				}
			},
			{ root, rootMargin: `${String(RENDER_MARGIN)}px 0px`, threshold: 0 },
		);

		mountObserver.current = observer;

		// A page that registered before this effect ran still has to be observed.
		for (const element of mountListeners.current.keys())
			observer.observe(element);

		return () => {
			observer.disconnect();
			mountObserver.current = null;
		};
	}, []);

	// Track which page crosses the middle band of the scroll area.
	useEffect(() => {
		const root = scrollRef.current;

		if (!root) return;

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;

					const pageNumber = spyListeners.current.get(entry.target);

					if (pageNumber) setCurrentPage(pageNumber);
				}
			},
			{ root, rootMargin: "-45% 0px -50% 0px", threshold: 0 },
		);

		spyObserver.current = observer;

		for (const element of spyListeners.current.keys())
			observer.observe(element);

		return () => {
			observer.disconnect();
			spyObserver.current = null;
		};
	}, []);

	const registerPage = useCallback<RegisterPage>((element, onChange) => {
		mountListeners.current.set(element, onChange);
		mountObserver.current?.observe(element);

		return () => {
			mountListeners.current.delete(element);
			mountObserver.current?.unobserve(element);
		};
	}, []);

	const registerSpy = useCallback<RegisterSpy>((element, pageNumber) => {
		spyListeners.current.set(element, pageNumber);
		spyObserver.current?.observe(element);

		return () => {
			spyListeners.current.delete(element);
			spyObserver.current?.unobserve(element);
		};
	}, []);

	if (failed) {
		return (
			<ViewerMessage tone="error">
				This PDF could not be rendered. Download it to open it in a PDF reader.
			</ViewerMessage>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			{/*
			 * A scrollable region must be reachable by keyboard so arrow keys and
			 * Page Down can move through the document. The dialog traps focus, so
			 * the scroll area itself has to be in the tab order.
			 */}
			<section
				ref={scrollRef}
				// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable region needs keyboard focus
				tabIndex={0}
				aria-label="PDF pages"
				className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-app-panel-subtle p-3 outline-none focus-visible:ring-1 focus-visible:ring-app-focus"
			>
				<Document
					file={src}
					options={PDF_OPTIONS}
					onLoadSuccess={handleLoadSuccess}
					onLoadError={handleLoadError}
					loading={<ViewerMessage>Loading PDF...</ViewerMessage>}
					error={
						<ViewerMessage tone="error">
							This PDF could not be rendered. Download it to open it in a PDF
							reader.
						</ViewerMessage>
					}
					className="flex flex-col items-center"
				>
					{Array.from({ length: numPages }, (_, index) => (
						<LazyPdfPage
							// biome-ignore lint/suspicious/noArrayIndexKey: the page number is the stable identity
							key={index + 1}
							pageNumber={index + 1}
							width={width}
							pdfDocument={pdfDocument}
							registerPage={registerPage}
							registerSpy={registerSpy}
						/>
					))}
				</Document>
			</section>

			<div className="flex items-center justify-between gap-2 border-t border-app-border px-3 py-2">
				<span className="text-xs tabular-nums text-app-text-muted">
					Page {currentPage} of {numPages || "…"}
				</span>

				{numPages > 1 && (
					<Button
						size="xs"
						variant="ghost"
						isDisabled={currentPage <= 1}
						onPress={() =>
							scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })
						}
					>
						<ArrowUpIcon className="size-3.5" aria-hidden />
						Back to top
					</Button>
				)}
			</div>
		</div>
	);
}
