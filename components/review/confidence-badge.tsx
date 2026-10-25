import { CONFIDENCE_UI } from "@/components/review/review-utils";
import type { ContactConfidence } from "@/lib/hunter/application-types";
import { cn } from "@/lib/utils";

const VARIANT_CLASSES = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  muted: "bg-muted text-muted-foreground",
} as const;

/** Reliability of a recipient address: high = success, medium = warning, low = muted "À vérifier". */
export function ConfidenceBadge({
  confidence,
  className,
}: {
  confidence: ContactConfidence;
  className?: string;
}) {
  const ui = CONFIDENCE_UI[confidence];
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center rounded-sm border border-transparent px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        VARIANT_CLASSES[ui.variant],
        className,
      )}
    >
      <span className="sr-only">Fiabilité de l&apos;adresse : </span>
      {ui.label}
    </span>
  );
}
