import * as React from "react";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** Styled native <select> (best keyboard and mobile support, no JS). */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <div data-slot="native-select-wrapper" className="relative w-full">
      <select
        data-slot="native-select"
        className={cn(
          "border-input bg-card h-10 w-full min-w-0 appearance-none rounded-md border py-1 pr-9 pl-3 text-base transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          "focus-visible:border-ring focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-solid",
          "aria-invalid:border-destructive aria-invalid:outline-destructive",
          className,
        )}
        {...props}
      />
      <ChevronDownIcon
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
      />
    </div>
  );
}

export { NativeSelect };
