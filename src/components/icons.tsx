import type { ReactNode } from "react";

/** Line icons for the phone tab bars (24px grid, 1.8 stroke, currentColor). */
const paths = {
  board: (
    <>
      <rect x="3" y="4" width="5" height="5" rx="1" />
      <rect x="9.5" y="4" width="5" height="5" rx="1" />
      <rect x="16" y="4" width="5" height="5" rx="1" />
      <rect x="3" y="15" width="5" height="5" rx="1" />
      <rect x="9.5" y="15" width="5" height="5" rx="1" />
      <rect x="16" y="15" width="5" height="5" rx="1" />
    </>
  ),
  requests: (
    <>
      <path d="M4 5h16v11H9l-5 4z" />
      <path d="M8 9.5h8M8 12.5h5" />
    </>
  ),
  maintenance: <path d="M14.5 5.5a4 4 0 0 0-5.3 5.1L4 15.8 6.2 18l5.2-5.2a4 4 0 0 0 5.1-5.3l-2.4 2.4-2-2z" />,
  tenants: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19.5c.6-3.3 3-5 6-5s5.4 1.7 6 5" />
      <path d="M15.5 5a3.2 3.2 0 0 1 0 6.2M17.5 14.7c2 .6 3.2 2.3 3.5 4.8" />
    </>
  ),
  rooms: (
    <>
      <path d="M6 20V4h12v16" />
      <path d="M4 20h16" />
      <circle cx="14.5" cy="12.5" r=".6" fill="currentColor" />
    </>
  ),
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5V20H4z" />
      <path d="M10 20v-5.5h4V20" />
    </>
  ),
  rules: (
    <>
      <path d="M6 3.5h9l3 3V20.5H6z" />
      <path d="M9 10h6M9 13.5h6M9 17h4" />
    </>
  ),
  account: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.3" fill="currentColor" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;

export function Icon({ name, className = "size-6" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {paths[name]}
    </svg>
  );
}
