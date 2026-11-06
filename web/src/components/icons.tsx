// Inline icons: 14 to 16 px, 1.5 px stroke, currentColor, hidden from assistive tech.

const S = { fill: "none", stroke: "currentColor", "stroke-width": "1.5", "aria-hidden": "true" } as const;

export const IconSearch = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" {...S}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5 14 14" />
  </svg>
);

export const IconLadder = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" {...S}>
    <path d="M3 2.5v11M3 4h10M3 7h7.5M3 10h5M3 13h2.5" />
  </svg>
);

export const IconQueue = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" {...S}>
    <path d="M2.5 4h11M2.5 8h11M2.5 12h7" />
  </svg>
);

export const IconFleet = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" {...S}>
    <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
    <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
    <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
    <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
  </svg>
);

export const IconLive = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" {...S}>
    <circle cx="8" cy="8" r="2" />
    <path d="M4.5 4.5a5 5 0 0 0 0 7M11.5 4.5a5 5 0 0 1 0 7" />
  </svg>
);

export const IconTheme = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5" />
    <path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" />
  </svg>
);

export const IconError = () => (
  <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="var(--cause-text)" stroke-width="1.5" aria-hidden="true">
    <circle cx="8" cy="8" r="6.5" />
    <path d="M8 4.5v4M8 11v.5" />
  </svg>
);

export const IconChevron = ({ open }: { open?: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 12 12" {...S} style={{ color: "var(--text-3)", transform: open ? "rotate(90deg)" : "none", transition: "transform .12s ease-out" }}>
    <path d="M4.5 3 7.5 6 4.5 9" />
  </svg>
);

export const IconCameraOff = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" {...S}>
    <rect x="1.5" y="4" width="9" height="8" rx="1.5" />
    <path d="M10.5 7 14.5 5v6l-4-2M2 2l12 12" />
  </svg>
);

export const IconArrowRight = () => (
  <svg viewBox="0 0 22 10" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
    <path d="M1 5h19M16 1.5 20 5l-4 3.5" />
  </svg>
);

export const IconArrowLeft = () => (
  <svg viewBox="0 0 22 10" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
    <path d="M21 5H2M6 1.5 2 5l4 3.5" />
  </svg>
);
