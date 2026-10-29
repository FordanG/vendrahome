import type { ReactNode } from "react";

/** Line icons for the menus and tab bars (24px grid, 1.8 stroke, currentColor). */
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
  housekeeping: (
    <>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="m6.5 6.5 1.8 1.8M15.7 15.7l1.8 1.8M6.5 17.5l1.8-1.8M15.7 8.3l1.8-1.8" />
    </>
  ),
  laundry: (
    <>
      <rect x="4.5" y="3" width="15" height="18" rx="2" />
      <circle cx="12" cy="13" r="4.2" />
      <path d="M7.5 6.5h2" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m10.8 12.2 8.7-8.7M16 7l2.5 2.5M13.5 9.5 15.5 11.5" />
    </>
  ),
  feedback: <path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.4l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  contract: (
    <>
      <path d="M6 3.5h8.5l3.5 3.5v13.5H6z" />
      <path d="M9 11h6M9 14.5h6M9 18c1-1.3 1.8-1.3 2.5 0s1.5 1.3 2.5 0" />
    </>
  ),
  company: (
    <>
      <path d="M4 20.5V6l8-3v17.5M12 9h8v11.5" />
      <path d="M2.5 20.5h19M7.5 9h1M7.5 12.5h1M7.5 16h1M15.5 12.5h1M15.5 16h1" />
    </>
  ),
  billing: (
    <>
      <path d="M5.5 3.5h13v17l-2.2-1.5-2.1 1.5-2.2-1.5-2.2 1.5-2.1-1.5-2.2 1.5z" />
      <path d="M9 8h6M9 11.5h6M9 15h3.5" />
    </>
  ),
  inventory: (
    <>
      <path d="m12 3 8.5 4.5v9L12 21l-8.5-4.5v-9z" />
      <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  hotels: (
    <>
      <path d="M3.5 20.5V8.5l5-2v14M8.5 20.5V3.5h7v17M15.5 20.5V8.5l5 2v10" />
      <path d="M2 20.5h20M11 7.5h2M11 11h2M11 14.5h2" />
    </>
  ),
  staff: (
    <>
      <rect x="4" y="4.5" width="16" height="15" rx="2" />
      <circle cx="12" cy="10.5" r="2.5" />
      <path d="M8 16.5c.6-1.8 2-2.7 4-2.7s3.4.9 4 2.7" />
    </>
  ),
  history: (
    <>
      <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" />
      <path d="M4 4v4.5h4.5M12 8v4.5l3 1.8" />
    </>
  ),
  signout: (
    <>
      <path d="M14 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H14" />
      <path d="M10 12h10M16.5 8.5 20 12l-3.5 3.5" />
    </>
  ),
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
