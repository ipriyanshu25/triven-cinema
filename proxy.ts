import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Triven Cinema", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

export function proxy(request: NextRequest) {
  const expectedUser = process.env.TRIVEN_BASIC_AUTH_USER;
  const expectedPassword = process.env.TRIVEN_BASIC_AUTH_PASSWORD;

  // Local development stays frictionless until both values are configured.
  if (!expectedUser || !expectedPassword) return NextResponse.next();
  if (request.nextUrl.pathname === "/api/health") return NextResponse.next();

  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Basic ")) return unauthorized();

  try {
    const decoded = atob(authorization.slice(6));
    const split = decoded.indexOf(":");
    if (split < 0) return unauthorized();
    const user = decoded.slice(0, split);
    const password = decoded.slice(split + 1);
    if (user !== expectedUser || password !== expectedPassword) return unauthorized();
  } catch {
    return unauthorized();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
