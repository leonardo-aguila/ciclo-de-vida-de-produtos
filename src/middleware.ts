import { NextResponse, type NextRequest } from "next/server";

const COOKIE = process.env.SESSION_COOKIE_NAME ?? "portfolio_session";
// /api/saude entra aqui porque quem chama é o healthcheck, que não tem
// sessão: sem isto ele receberia o redirecionamento para /entrar e leria 307
// como "de pé", que é a resposta errada pelo motivo errado.
const PUBLIC_PATHS = ["/entrar", "/api/sair", "/api/saude"];

/**
 * Cheap gate: it only looks at whether a session cookie exists, because the
 * middleware runtime has no database access. The real check runs in the layout
 * and in every server action — a forged cookie gets past this and nothing else.
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasCookie = Boolean(request.cookies.get(COOKIE)?.value);
  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (!hasCookie && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/entrar";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (hasCookie && pathname === "/entrar") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
