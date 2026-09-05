import { WebSocketServer, type WebSocket } from "ws";
import { type AddressInfo } from "net";
import { createServer } from "http";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { IpcEvent, IpcEventPayload, HostState } from "../../ipc/types";
import { ConfigStore } from "./host-files/ConfigStore";
import { addFileUploadRoutes } from "./host-files/file-uploads";
import { denyForeignOrigin, isAllowedOrigin } from "./origin";
import type { AppUpdater } from "./AppUpdater";
import type { Logger } from "./RemoteLogger";

export const server = createServer();
const websocketServer = new WebSocketServer({ noServer: true });
let lastActiveClient: WebSocket;

addFileUploadRoutes(server);

if (!process.env.VITE_DEV_SERVER_URL) {
  server.addListener("request", (req, res) => {
    if (denyForeignOrigin(req, res)) return;
    if (
      req.url?.startsWith("/config") ||
      req.url?.startsWith("/uploads") ||
      req.url?.startsWith("/proxy")
    )
      return;

    const filePath = req.url === "/" ? "/index.html" : req.url!;
    // 경로 조작 방어: "/../../.." 요청이 path.join 으로 __dirname(앱 리소스)을 벗어나
    // 임의 파일을 서빙하는 걸 막는다. 정상 에셋 경로는 항상 안에 남아 영향 0.
    // (uploads GET 과 같은 계열 — 21회차에 고친 것을 이 라우트에도 적용.)
    const target = path.resolve(__dirname, "." + filePath);
    if (target !== __dirname && !target.startsWith(__dirname + path.sep)) {
      res.statusCode = 403;
      res.end();
      return;
    }
    switch (path.extname(filePath)) {
      case ".html":
        res.setHeader("content-type", "text/html");
        break;
      case ".js":
        res.setHeader("content-type", "text/javascript");
        break;
      case ".json":
        res.setHeader("content-type", "application/json");
        break;
      case ".svg":
        res.setHeader("content-type", "image/svg+xml");
        break;
    }

    // 없는 에셋이나 디렉터리 요청은 스트림 error(ENOENT/EISDIR)를 낸다 — 핸들러가 없으면
    // 전역 uncaughtException 으로 새서 응답이 매달린다. 깔끔한 404 로 닫는다(uploads GET 과 동일).
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
}

const evBus = new EventEmitter();

export function onEventAnyClient<Name extends IpcEvent["name"]>(
  name: Name,
  cb: (payload: IpcEventPayload<Name>) => void,
) {
  evBus.on(name, cb);
}

export function sendEventTo(
  target: "last-active" | "any" | "broadcast",
  event: IpcEvent,
) {
  const msg = JSON.stringify(event);
  if (target === "broadcast") {
    for (const client of websocketServer.clients) {
      client.send(msg);
    }
  } else {
    lastActiveClient.send(msg);
  }
}

export interface ServerEvents {
  onEventAnyClient: typeof onEventAnyClient;
  sendEventTo: typeof sendEventTo;
}
export const eventPipe = {
  onEventAnyClient,
  sendEventTo,
};

server.on("upgrade", (req, socket, head) => {
  if (req.url !== "/events" || !isAllowedOrigin(req.headers.origin)) {
    return req.destroy();
  }
  websocketServer.handleUpgrade(req, socket, head, (ws) => {
    websocketServer.emit("connection", ws, req);
  });
});

export async function startServer(
  appUpdater: AppUpdater,
  logger: Logger,
): Promise<number> {
  const configStore = new ConfigStore(eventPipe);

  websocketServer.on("connection", (socket) => {
    lastActiveClient = socket;
    socket.on("message", (bytes) => {
      // 잘못된 프레임(비-JSON)은 조용히 버린다 — 없으면 JSON.parse 예외가 message 핸들러에서
      // 전역 uncaughtException 으로 새서 로그를 오염시킨다(악성/오작동 클라이언트가 스팸 가능).
      let event: IpcEvent;
      try {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        event = JSON.parse(bytes.toString("utf-8")) as IpcEvent;
      } catch {
        return;
      }
      if (!event || typeof event.name !== "string") return; // 이름 없는 이벤트는 무시
      if (event.name === "CLIENT->MAIN::used-recently") {
        lastActiveClient = socket;
      }
      evBus.emit(event.name, event.payload);
    });
    socket.on("close", () => {
      const clients = websocketServer.clients;
      if (clients.size === 1) {
        lastActiveClient = clients.values().next().value!;
        evBus.emit("CLIENT->MAIN::used-recently", { isOverlay: true });
      }
    });
    sendEventTo("last-active", {
      name: "MAIN->CLIENT::log-entry",
      payload: { message: logger.history },
    });
  });

  server.addListener("request", async (req, res) => {
    if (denyForeignOrigin(req, res)) return;
    if (req.url === "/config") {
      res.setHeader("content-type", "application/json");
      const resBody: HostState = {
        version: app.getVersion(),
        updater: appUpdater.info,
        contents: await configStore.load(),
      };
      res.end(JSON.stringify(resBody));
    }
  });

  let port = process.env.VITE_DEV_SERVER_URL ? 8584 : 0;
  let host = "127.0.0.1";
  // --listen=[host][:port]
  const listenOpt = process.argv.find((arg) => arg.startsWith("--listen"));
  if (listenOpt) {
    const [hostArg, portArg] = listenOpt.split("=")[1].split(":");
    if (hostArg) host = hostArg;
    if (portArg) port = parseInt(portArg, 10);
  }

  return await new Promise((resolve, reject) => {
    server
      .listen({ port, host })
      .once("error", reject)
      .once("listening", () => {
        resolve((server.address() as AddressInfo).port);
      });
  });
}
