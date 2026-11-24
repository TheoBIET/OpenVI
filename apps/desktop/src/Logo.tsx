/** The OpenVI mark: an archive cube under a lens. Same drawing as `app-icon.svg`. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="200 200 700 700" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="openvi-sunset" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-flamingo)" />
          <stop offset="1" stopColor="var(--color-gold)" />
        </linearGradient>
      </defs>
      <g fill="none" stroke="url(#openvi-sunset)" strokeWidth="44" strokeLinejoin="round" strokeLinecap="round">
        <path d="M512 232 L752 370 L752 646 L512 784 L272 646 L272 370 Z" />
        <path d="M272 370 L512 508 L752 370" />
        <path d="M512 508 L512 784" />
      </g>
      <circle cx="700" cy="700" r="110" fill="var(--color-ink-950)" stroke="var(--color-lagoon)" strokeWidth="44" />
      <path d="M780 780 L866 866" stroke="var(--color-lagoon)" strokeWidth="52" strokeLinecap="round" />
    </svg>
  );
}
