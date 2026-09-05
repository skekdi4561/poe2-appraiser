import type { IncomingMessage, ServerResponse } from "http";

// 로컬 서버(127.0.0.1:랜덤포트)의 교차 출처 차단.
//
// 이 서버는 loopback 에만 붙지만 사용자가 방문한 웹페이지도 loopback 에 요청할 수 있다.
// 그래서 /proxy 가 특히 위험하다 — useSessionCookies:true 라 거래소 세션 쿠키가 실려 나가고,
// 악성 페이지가 fetch("http://127.0.0.1:포트/proxy/poe.kakaogames.com/...") 한 번으로
// 사용자 계정 권한의 요청을 보낼 수 있다(응답은 CORS 로 못 읽어도 요청 자체가 나간다).
// /config 와 /uploads 도 같은 문에 있다. 랜덤 포트가 유일한 방어였다.
//
// 브라우저는 교차 출처 요청에 Origin 을 붙이고 페이지는 그걸 위조할 수 없다. 우리 렌더러는
// 항상 로컬 서버에서 열리므로(loadURL http://localhost:포트) Origin 이 loopback 이거나
// 아예 없다(동일 출처 GET). 그래서 "외부 오리진만 거부"로 충분하다.
// Origin 없는 네이티브 클라이언트는 통과 — 로컬 프로세스는 이미 코드 실행 권한이 있어
// CSWSH/CSRF 벡터가 아니다.
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false; // 브라우저가 보내는 Origin 은 항상 파싱 가능 — 이상하면 거부
  }
  return (
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]"
  );
}

/**
 * 외부 오리진이면 403 으로 닫고 true 를 돌려준다(라우트는 곧바로 return 하면 된다).
 * 같은 요청에 라우트가 여럿 달려 있어 여러 번 불리므로 응답은 한 번만 끝낸다.
 */
export function denyForeignOrigin(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  if (isAllowedOrigin(req.headers.origin)) return false;
  if (!res.writableEnded) {
    res.statusCode = 403;
    res.end();
  }
  return true;
}
