/** Two overlapping speech bubbles: one message, two languages. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="15" fill="var(--accent)" />
      <path d="M14 17h22a6 6 0 0 1 6 6v10a6 6 0 0 1-6 6H24l-7 6v-6h-3a6 6 0 0 1-6-6V23a6 6 0 0 1 6-6Z"
        fill="none" stroke="var(--on-accent)" strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M30 29h20a6 6 0 0 1 6 6v8a6 6 0 0 1-6 6h-2v6l-7-6H30a6 6 0 0 1-6-6v-8a6 6 0 0 1 6-6Z"
        fill="var(--mark)" stroke="var(--on-accent)" strokeWidth="3.5" strokeLinejoin="round" />
    </svg>
  );
}
