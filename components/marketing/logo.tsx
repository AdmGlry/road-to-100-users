/** Spontané mark: a sealed envelope in a rounded square (same drawing as app/icon.svg). */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <rect
        x="8"
        y="10"
        width="16"
        height="12"
        rx="2"
        fill="none"
        stroke="var(--background)"
        strokeWidth="2"
      />
      <path
        d="m9 11.5 7 5 7-5"
        fill="none"
        stroke="var(--background)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
