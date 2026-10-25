import * as React from "react";

import { cn } from "@/lib/utils";

/** Native checkbox styled like shadcn's Checkbox (keyboard and form friendly). */
function Checkbox({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        "accent-primary border-input size-[1.125rem] shrink-0 cursor-pointer rounded-sm border outline-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid",
        className,
      )}
      {...props}
    />
  );
}

export { Checkbox };
