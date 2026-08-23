import type {
  IpcEvent,
  IpcEventPayload,
  UpdateInfo,
  HostState,
} from "@ipc/types";
import { shallowRef } from "vue";
import Sockette from "sockette";

class HostTransport {
  private evBus = new EventTarget();
  private socket!: Sockette;
  logs = shallowRef("");
  version = shallowRef("0.0.00000");
  updateInfo = shallowRef<UpdateInfo>({ state: "initial" });

  async init() {
    this.onEvent("MAIN->CLIENT::log-entry", (entry) => {
      this.logs.value += entry.message;
    });
    this.onEvent("MAIN->CLIENT::updater-state", (info) => {
      this.updateInfo.value = info;
    });
    if (!this.isElectron) {
      // 브라우저 단독 미리보기 — 메인 프로세스가 없어 WS 를 붙일 수 없다.
      // 소켓 없이 부팅한다 (sendEvent 는 조용히 무시됨).
      return;
    }
    await new Promise((resolve) => {
      this.socket = new Sockette(`ws://${window.location.host}/events`, {
        onmessage: (e) => {
          this.selfDispatch(JSON.parse(e.data));
        },
        onopen: resolve,
      });
    });
  }

  selfDispatch(event: IpcEvent) {
    this.evBus.dispatchEvent(
      new CustomEvent(event.name, {
        detail: event.payload,
      }),
    );
  }

  sendEvent(event: IpcEvent) {
    if (!this.socket) return; // 웹 미리보기 — 보낼 곳이 없다
    this.socket.send(JSON.stringify(event));
  }

  onEvent<Name extends IpcEvent["name"]>(
    name: Name,
    cb: (payload: IpcEventPayload<Name>) => void,
  ): AbortController {
    const controller = new AbortController();
    if (!this.isElectron && name.startsWith("MAIN->OVERLAY")) {
      return controller;
    }

    this.evBus.addEventListener(
      name,
      (e) => {
        cb((e as CustomEvent<IpcEventPayload<Name>>).detail);
      },
      { signal: controller.signal },
    );
    return controller;
  }

  async getConfig(): Promise<string | null> {
    const response = await fetch("/config");
    const config = (await response.json()) as HostState;
    // TODO: refactor this
    this.version.value = config.version;
    this.updateInfo.value = config.updater;
    return config.contents;
  }

  async importFile(file: File): Promise<string> {
    const response = await fetch(`/uploads/${file.name}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
    const body = (await response.json()) as { name: string };
    return body.name;
  }

  proxy: (typeof window)["fetch"] = async (url, init) => {
    return await window.fetch(`/proxy/${url as string}`, init);
  };

  get isElectron() {
    // ?web-preview 는 브라우저 검증용 강제 웹 모드 — Electron 기반 브라우저(예:
    // Claude 패널)에서도 미리보기가 되게 한다. 실제 앱은 이 쿼리를 절대 안 붙인다.
    if (window.location.search.includes("web-preview")) return false;
    return navigator.userAgent.includes("Electron");
  }
}

export const MainProcess = new HostTransport();
export const Host = MainProcess;
