import { Button } from "@org/ui/components/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@org/ui/components/select";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

/**
 * Pagination footer shared by the members and invitations tables.
 *
 * Why one component: the two pages paginate differently (members in the
 * browser over at most 100 rows, invitations on the server), but the footer
 * should read and behave the same. Callers pass the numbers, so neither page
 * has to know how the other one gets them.
 *
 * Used by: routes/_app/$orgSlug.settings.members.tsx and
 * routes/_app/$orgSlug.settings.invitations.tsx.
 */

type TablePaginationProps = {
	/** 1 based. */
	page: number;
	pageSize: number;
	total: number;
	totalPages: number;
	hasNext: boolean;
	hasPrevious: boolean;
	onPageChange: (page: number) => void;
	onPageSizeChange: (pageSize: number) => void;
	disabled?: boolean;
};

const PAGE_SIZES = [10, 20, 50] as const;

export function TablePagination({
	page,
	pageSize,
	total,
	totalPages,
	hasNext,
	hasPrevious,
	onPageChange,
	onPageSizeChange,
	disabled = false,
}: TablePaginationProps) {
	const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
	const to = Math.min(page * pageSize, total);

	return (
		<div className="flex flex-wrap items-center justify-between gap-3">
			<p className="text-xs text-app-text-muted" aria-live="polite">
				Showing {from} to {to} of {total}
			</p>

			<div className="flex flex-wrap items-center gap-3">
				<div className="flex items-center gap-2">
					<span className="text-xs text-app-text-muted">Rows</span>
					<Select
						aria-label="Rows per page"
						selectedKey={String(pageSize)}
						onSelectionChange={(key) => {
							const size = Number(key);

							if (size === 10 || size === 20 || size === 50) {
								onPageSizeChange(size);
							}
						}}
						isDisabled={disabled}
					>
						<SelectTrigger size="sm" className="w-20">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{PAGE_SIZES.map((size) => (
								<SelectItem key={size} id={String(size)}>
									{size}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="icon-sm"
						aria-label="Previous page"
						isDisabled={disabled || !hasPrevious}
						onPress={() => onPageChange(page - 1)}
					>
						<ChevronLeftIcon />
					</Button>
					<span className="text-xs text-app-text-muted">
						Page {page} of {totalPages}
					</span>
					<Button
						variant="outline"
						size="icon-sm"
						aria-label="Next page"
						isDisabled={disabled || !hasNext}
						onPress={() => onPageChange(page + 1)}
					>
						<ChevronRightIcon />
					</Button>
				</div>
			</div>
		</div>
	);
}
