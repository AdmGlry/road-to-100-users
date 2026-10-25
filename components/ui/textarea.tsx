import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "placeholder:text-muted-foreground border-input bg-card flex field-sizing-content min-h-16 w-full rounded-md border px-3 py-2 text-base transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-solid",
        "aria-invalid:border-destructive aria-invalid:outline-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
