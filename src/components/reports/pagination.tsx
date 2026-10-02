import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "cn";

export interface PaginationLinkProps {
  pathname: string;
  params: Record<string, string>;
  total: number;
  page: number;
  pageCount: number;
  perPage: number;
}

function hrefFor(params: Record<string, string>, page: number): string {
  const next = new URLSearchParams(params);
  next.delete("page");
  if (page > 1) next.set("page", String(page));
  const qs = next.toString();
  return qs ? `?${qs}` : "";
}

/** Server-rendered pagination that pushes a `page` param into the URL. */
export function PaginationLinks({
  pathname,
  params,
  total,
  page,
  pageCount,
  perPage,
}: PaginationLinkProps) {
  if (total === 0) return null;

  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  const pages = Array.from({ length: pageCount }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === pageCount || Math.abs(p - page) <= 2
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 text-sm">
      <span className="text-xs text-muted-foreground">
        Showing {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        <a
          aria-disabled={page <= 1}
          href={page > 1 ? `${pathname}${hrefFor(params, page - 1)}` : undefined}
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-md transition-colors",
            page > 1
              ? "text-muted-foreground hover:bg-muted hover:text-foreground"
              : "pointer-events-none text-muted-foreground/40"
          )}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </a>
        {pages.map((p, index) => {
          const prev = pages[index - 1];
          const gap = prev && p - prev > 1;
          return (
            <span key={p} className="flex items-center gap-1">
              {gap && <span className="px-1 text-muted-foreground/50">…</span>}
              {p === page ? (
                <span
                  aria-current="page"
                  className="inline-flex size-7 items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground"
                >
                  {p}
                </span>
              ) : (
                <Link
                  href={`${pathname}${hrefFor(params, p)}`}
                  className="inline-flex size-7 items-center justify-center rounded-md text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {p}
                </Link>
              )}
            </span>
          );
        })}
        <a
          aria-disabled={page >= pageCount}
          href={
            page < pageCount
              ? `${pathname}${hrefFor(params, page + 1)}`
              : undefined
          }
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-md transition-colors",
            page < pageCount
              ? "text-muted-foreground hover:bg-muted hover:text-foreground"
              : "pointer-events-none text-muted-foreground/40"
          )}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </a>
      </div>
    </div>
  );
}