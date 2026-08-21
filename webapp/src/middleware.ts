import { NextResponse } from "next/server";
import { auth } from "@/auth";

const PUBLIC_PATHS = new Set(["/login"]);

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/api/auth")) return true;
  if (pathname.startsWith("/_next")) return true;
  if (pathname === "/favicon.ico" || pathname === "/site-favicon.ico") return true;
  return /\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?)$/i.test(pathname);
}

export default auth((req) => {
  if (req.auth || isPublic(req.nextUrl.pathname)) {
    return NextResponse.next();
  }

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const login = new URL("/login", req.nextUrl.origin);
  login.searchParams.set("callbackUrl", req.nextUrl.pathname);
  return NextResponse.redirect(login);
});

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
