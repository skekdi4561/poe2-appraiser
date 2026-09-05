import path from "path";
import { app, Tray, Menu, shell, nativeImage, dialog } from "electron";
import type { ServerEvents } from "./server";

export class AppTray {
  public overlayKey = "Shift + Space";
  private tray: Tray;
  serverPort = 0;

  constructor(server: ServerEvents) {
    let trayImage = nativeImage.createFromPath(
      path.join(
        __dirname,
        process.env.STATIC!,
        process.platform === "win32" ? "icon.ico" : "icon.png",
      ),
    );

    if (process.platform === "darwin") {
      // Mac image size needs to be smaller, or else it looks huge. Size
      // guideline is from https://iconhandbook.co.uk/reference/chart/osx/
      trayImage = trayImage.resize({ width: 22, height: 22 });
    }

    this.tray = new Tray(trayImage);
    this.tray.setToolTip(`PoE2 Budget of Exile v${app.getVersion()}`);
    this.rebuildMenu();

    server.onEventAnyClient("CLIENT->MAIN::user-action", ({ action }) => {
      if (action === "quit") {
        app.quit();
      }
    });
  }

  rebuildMenu() {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: "설정 / 리그",
        click: () => {
          dialog.showMessageBox({
            title: "설정",
            message: `Path of Exile 2 를 실행한 뒤 "${this.overlayKey}" 를 누르고, 톱니바퀴 버튼을 누르세요.`,
          });
        },
      },
      {
        label: "브라우저에서 열기",
        click: () => {
          shell.openExternal(`http://localhost:${this.serverPort}`);
        },
      },
      { type: "separator" },
      {
        label: "설정 폴더 열기",
        click: () => {
          shell.openPath(path.join(app.getPath("userData"), "apt-data"));
        },
      },
      {
        label: "종료",
        click: () => {
          app.quit();
        },
      },
    ]);

    this.tray.setContextMenu(contextMenu);
  }
}
