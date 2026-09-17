import { NextResponse } from "next/server";
import { endSession } from "@/lib/auth/session";

/** Sign-out is a POST so a prefetch or an image tag cannot end the session. */
export async function POST(request: Request) {
  await endSession();
  return NextResponse.redirect(new URL("/entrar", request.url), { status: 303 });
}
