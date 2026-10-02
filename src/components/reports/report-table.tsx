import type { ReactNode } from "react";
import { cn } from "cn";

export interface ReportColumn {
  label: string;
  /** Right-align numeric columns. */
  right?: boolean;
}

/** Presentational report table shell (scrolls on small screens). */
export function ReportTable({
  columns,
  children,
}: {
  columns: ReportColumn[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            {columns.map((col) => (
              <th
                key={col.label}
                className={cn(
                  "px-3 py-2 font-medium whitespace-nowrap",
                  col.right && "text-right"
                )}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

export function Th({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <th className={cn("px-3 py-2 font-medium whitespace-nowrap", className)}>
      {children}
    </th>
  );
}

export function Td({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <td className={cn("px-3 py-2.5 whitespace-nowrap", className)}>{children}</td>
  );
}

export function TdNum({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <td className={cn("px-3 py-2.5 text-right whitespace-nowrap tabular-nums", className)}>
      {children}
    </td>
  );
}

export function ReportEmpty({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={99}>
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">{label}</p>
      </td>
    </tr>
  );
}