import path from "path";
import crypto from "crypto";
import fs from "fs";
import { app } from "electron";
import type { Server } from "http";

export function addFileUploadRoutes(server: Server) {
  const uploadsPath = path.join(app.getPath("userData"), "apt-data", "files");

  server.addListener("request", (req, res) => {
    if (req.method !== "GET" || !req.url?.startsWith("/uploads/")) return;

    // 경로 조작 방어: "/uploads/../../.." 같은 요청이 path.join 으로 uploadsPath 를
    // 벗어나 임의 파일을 읽는 걸 막는다. 정상 파일명(md5.확장자, 슬래시 없음)은 항상
    // 안에 남으므로 실제 업로드엔 영향 0. (로컬 바인딩+랜덤 포트+무 CORS 로 원격 유출은
    // 이미 막혀 있지만, 배포 바이너리의 심층 방어로 격리를 명시한다.)
    const target = path.resolve(uploadsPath, req.url.slice("/uploads/".length));
    if (target !== uploadsPath && !target.startsWith(uploadsPath + path.sep)) {
      res.statusCode = 403;
      res.end();
      return;
    }
    // 없는 파일이나 디렉터리(/uploads/ → target===uploadsPath) 요청은 스트림이 ENOENT/EISDIR
    // error 를 낸다. 핸들러가 없으면 전역 uncaughtException 으로 새서 응답이 매달린 채 안 끝난다
    // — 깔끔한 404 로 닫는다(헤더가 이미 나갔으면 소켓만 끊는다).
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
  });

  server.addListener("request", (req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/uploads/")) return;

    let contents = Buffer.alloc(0);
    req.on("data", (chunk) => {
      if (contents.length > 16_000_000) {
        return req.destroy();
      }
      contents = Buffer.concat([contents, chunk]);
    });
    req.once("end", () => {
      const hash = crypto.createHash("md5").update(contents).digest("hex");
      const filename = `${hash}${path.extname(req.url!)}`;

      fs.mkdirSync(uploadsPath, { recursive: true });
      fs.writeFileSync(path.join(uploadsPath, filename), contents);

      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ name: filename }));
    });
  });
}
