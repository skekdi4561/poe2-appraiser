// electron-builder afterPack 훅 — win-unpacked 의 앱 exe 에 아이콘·버전 정보를 찍는다.
// NSIS/portable 은 이 폴더를 그대로 담으므로 설치본·포터블 모두 반영된다.
// rcedit 패키지는 배포 형태(CJS/ESM)에 따라 함수가 오는 자리가 달라 셋 다 받는다.
const path = require("path");

async function loadRcedit() {
  let mod = require("rcedit");
  let fn = typeof mod === "function" ? mod : mod.default || mod.rcedit;
  if (typeof fn !== "function") {
    mod = await import("rcedit");
    fn = typeof mod === "function" ? mod : mod.default || mod.rcedit;
  }
  if (typeof fn !== "function") throw new Error("rcedit 를 함수로 불러오지 못함: " + Object.keys(mod));
  return fn;
}

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== "win32") return;
  const rcedit = await loadRcedit();
  const info = ctx.packager.appInfo;
  const exe = path.join(ctx.appOutDir, `${info.productFilename}.exe`);
  await rcedit(exe, {
    icon: path.join(__dirname, "icons", "icon.ico"),
    "file-version": info.version,
    "product-version": info.version,
    "version-string": {
      ProductName: info.productName,
      FileDescription: info.productName,
      CompanyName: "skekdi4561",
      LegalCopyright: "MIT. Fork of Exiled Exchange 2 / Awakened PoE Trade.",
      OriginalFilename: `${info.productFilename}.exe`,
    },
  });
  console.log(`  • rcedit         stamped ${path.basename(exe)} (${info.productName} ${info.version})`);
};
