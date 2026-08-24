// file-uploads.ts GET / server.ts 정적 서빙의 회귀 가드:
// createReadStream 에 error 핸들러가 없으면 없는 파일/디렉터리 요청이 전역 uncaughtException 으로
// 새서 HTTP 응답이 매달린다. error→404 로 닫아야 한다.  node main/test/file-serve-404.test.mjs
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fserve-"));
fs.writeFileSync(path.join(dir, "real.png"), "PNGDATA");

// server.ts / file-uploads.ts 의 수정된 서빙 로직 미러(error→404, 헤더 나갔으면 destroy)
function serve(req, res) {
  const target = path.resolve(dir, "." + (req.url ?? "/"));
  if (target !== dir && !target.startsWith(dir + path.sep)) {
    res.statusCode = 403;
    return res.end();
  }
  const stream = fs.createReadStream(target);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.statusCode = 404;
      res.end();
    } else {
      res.destroy();
    }
  });
  stream.pipe(res);
}

function get(port, url) {
  return new Promise((resolve, reject) => {
    const req = http.get({ port, path: url }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.setTimeout(2000, () => {
      req.destroy();
      reject(new Error(`요청 타임아웃(응답 매달림): ${url}`));
    });
  });
}

const server = http.createServer(serve);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

let failed = false;
try {
  const real = await get(port, "/real.png");
  assert.strictEqual(real.status, 200, "실파일은 200");
  assert.strictEqual(real.body, "PNGDATA", "실파일 내용 스트리밍");

  const missing = await get(port, "/nope.png"); // ENOENT — 구버전은 여기서 매달렸다
  assert.strictEqual(missing.status, 404, "없는 파일은 404(매달림 아님)");

  const asDir = await get(port, "/"); // EISDIR — target===dir
  assert.strictEqual(asDir.status, 404, "디렉터리 요청은 404");

  const escape = await get(port, "/../../etc/passwd"); // 경로순회
  assert.strictEqual(escape.status, 403, "경로순회는 403");

  console.log("file-serve-404 self-test PASS");
} catch (e) {
  failed = true;
  console.error("FAIL:", e.message);
} finally {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
