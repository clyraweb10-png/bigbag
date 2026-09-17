import { NextRequest, NextResponse } from "next/server";

import { verifyFirebaseIdToken } from "@/lib/firebase-auth-server";

export const dynamic = "force-dynamic";

const SESSION_COOKIE = "bigbag_session";

function bearerToken(request: NextRequest): string {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

export async function POST(request: NextRequest) {
  const token = bearerToken(request);
  const user = await verifyFirebaseIdToken(token);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Your Google session could not be verified." },
      { status: 401 }
    );
  }

  const response = NextResponse.json({
    ok: true,
    data: {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoUrl: user.photoUrl,
    },
  });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(
      60,
      Math.min(55 * 60, Math.floor((user.expiresAt - Date.now()) / 1_000))
    ),
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
