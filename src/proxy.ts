import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only: sends signed-out visitors to /login.
// Pages and server actions still verify the session and role.
export function proxy(request: NextRequest) {
  if (!request.cookies.has("hotel_session")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|r/|_next/|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest).*)"],
};
