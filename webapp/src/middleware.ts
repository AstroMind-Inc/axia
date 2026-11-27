import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isCrossOriginWrite, isPublic } from "@/app/lib/request-guards";

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/api/") &&
    !pathname.startsWith("/api/auth") &&
    isCrossOriginWrite(req)
  ) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  if (req.auth || isPublic(pathname)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const login = new URL("/login", req.nextUrl.origin);
  // Keep the query string so deep links survive the round trip through
  // Google. Auth.js only redirects to same-origin callback URLs.
  login.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
  return NextResponse.redirect(login);
});

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
