import { ArrowUpRight } from "lucide-react";
import { PLATFORMS } from "../lib/platforms";
import type { CheckRow, CheckRows } from "@/hooks/use-platform-check";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export { Spinner } from "@/components/ui/spinner";

/**
 * Live storefront sweep results, shared by onboarding and the setup form.
 * Rows animate in staggered and settle as each platform answers.
 */
export function PlatformCheckList({
  rows,
  onOpen,
  dense,
}: {
  rows: CheckRows;
  onOpen: (url: string) => void;
  dense?: boolean;
}) {
  return (
    <ul className="flex list-none flex-col">
      {PLATFORMS.map((p, index) => (
        <li
          key={p.key}
          className="animate-rise border-t border-border first:border-t-0"
          style={{ animationDelay: `${index * 45}ms` }}
        >
          <Check label={p.label} row={rows[p.key]} onOpen={onOpen} dense={dense} />
        </li>
      ))}
    </ul>
  );
}

function Check({
  label,
  row,
  onOpen,
  dense,
}: {
  label: string;
  row?: CheckRow;
  onOpen: (url: string) => void;
  dense?: boolean;
}) {
  const status = row?.status ?? "checking";
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 py-2",
        dense ? "min-h-[38px]" : "min-h-[46px]",
      )}
    >
      <Label>{label}</Label>
      {status === "checking" && <Spinner />}
      {status === "found" && (
        <Button
          variant="link"
          size="none"
          className="min-w-0 text-[13px] font-normal text-ink-100"
          onClick={() => row?.hit?.url && onOpen(row.hit.url)}
        >
          <span className="truncate">
            Found · {row?.hit?.name}
          </span>
          <ArrowUpRight className="size-3 flex-none text-ink-500" aria-hidden />
        </Button>
      )}
      {status === "missing" && <span className="text-[13px] text-ink-500">Not found</span>}
      {status === "failed" && (
        <span className="text-[13px] text-ink-500">Couldn't check</span>
      )}
    </div>
  );
}
