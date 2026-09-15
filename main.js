const { app, BrowserWindow, ipcMain, Notification } = require("electron");
const path = require("path");
const fs = require("fs");

// 윈도우는 "AppUserModelID"가 등록돼 있지 않은 앱이 띄우는 알림은 액션 센터에
// 제대로 표시하지 않거나 아예 무시하는 경우가 있다. package.json의 electron-builder
// appId와 동일한 값으로 등록해서, 렌더러(웹 Notification API)든 아래 IPC로 메인
// 프로세스에서 직접 띄우는 알림이든 항상 실제 윈도우 알림(토스트)으로 뜨게 한다.
if (process.platform === "win32") {
  try { app.setAppUserModelId("com.leti.tracker"); } catch (e) {}
}

let mainWindow = null;

// 일기·포트폴리오를 포함한 앱 데이터를 저장하는 파일 경로.
// 브라우저 localStorage 대신 이 파일에 저장해서, 사용자가 "내 컴퓨터에 항상
// 남아있는" 데이터로 확인할 수 있게 한다. app.getPath("userData")는
// OS별로 이 앱 전용 사용자 데이터 폴더를 가리킨다.
function getStorageFilePath() {
  return path.join(app.getPath("userData"), "tracker-data.json");
}

ipcMain.on("storage-load", (event) => {
  try {
    event.returnValue = fs.readFileSync(getStorageFilePath(), "utf-8");
  } catch (e) {
    event.returnValue = null;
  }
});

ipcMain.on("storage-save", (event, json) => {
  try {
    if (typeof json === "string" && json) {
      fs.writeFileSync(getStorageFilePath(), json, "utf-8");
    }
  } catch (e) {}
});

// 창 버튼(최소화/최대화/닫기) 오버레이의 "현재" 색상/높이 값.
// 렌더러가 테마를 바꿀 때마다 IPC로 갱신되고, 창을 새로 켤 때도
// 이 값(기본값 또는 마지막으로 적용된 값)을 기준으로 다시 맞춰준다.
// 하드코딩된 기본색으로 덮어써버리면 사용자가 고른 그라데이션과
// 안 맞게 되므로, 절대 고정값으로 되돌리지 않는다.
let lastOverlayOpts = { color: "#B3B9CC", symbolColor: "#2B2620", height: 45 };

function applyOverlay() {
  if (mainWindow && typeof mainWindow.setTitleBarOverlay === "function") {
    try { mainWindow.setTitleBarOverlay(lastOverlayOpts); } catch (e) {}
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 720,
    minHeight: 560,
    title: "Tracker",
    icon: path.join(__dirname, "icon.ico"),
    backgroundColor: "#FAF3E7",
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: lastOverlayOpts,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
      // 창을 최소화했거나 다른 창에 가려서 화면에 안 보일 때, Electron은 기본적으로
      // 렌더러의 타이머(setInterval 등)를 크게 늦춘다. 이 앱은 백그라운드에 있을 때야말로
      // 리마인더(setInterval로 20초마다 시간 체크)가 정확히 돌아야 하므로 꺼둔다 —
      // 안 그러면 "시간을 설정했는데 알림이 안 뜬다"가 생긴다(창이 최소화/비활성 상태였을 때).
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  // Windows에서는 창 생성 시점에 넘긴 titleBarOverlay 크기가 제대로
  // 반영되지 않는 경우가 있어서, 창을 보여줄 때/페이지 로드가 끝난 뒤/
  // 레이아웃이 완전히 자리잡은 직후까지 총 세 번 같은 값으로 다시
  // 맞춰준다. 항상 lastOverlayOpts(마지막으로 적용된 실제 색상)를
  // 그대로 재적용하므로, 높이만 고쳐질 뿐 사용자가 고른 버튼 색은
  // 그대로 유지된다.
  // 윈도우 시작프로그램으로 자동 실행됐을 때는 "ready-to-show"가 예상보다
  // 늦게 오거나(다른 시작프로그램들과 리소스 경합) 씹히는 경우가 있어서,
  // 3초 안에 안 뜨면 강제로라도 창을 보여준다(중복 호출은 무해함).
  var shownAlready = false;
  function showWindowOnce() {
    if (shownAlready || !mainWindow) return;
    shownAlready = true;
    applyOverlay();
    mainWindow.show();
    mainWindow.focus();
  }
  mainWindow.once("ready-to-show", showWindowOnce);
  setTimeout(showWindowOnce, 3000);

  mainWindow.webContents.on("did-finish-load", () => {
    applyOverlay();
    setTimeout(applyOverlay, 300);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// 커스텀 테마 색상을 고를 때, 창 상단 타이틀바(윈도우 버튼 영역)도
// 같은 톤으로 바뀌도록 렌더러에서 요청을 보내면 반영해준다.
ipcMain.on("set-titlebar-overlay", (event, opts) => {
  if (opts && typeof opts === "object") {
    lastOverlayOpts = Object.assign({}, lastOverlayOpts, opts);
  }
  applyOverlay();
});

// 컴퓨터를 켤 때 윈도우 로그인과 함께 앱이 자동으로 실행되도록 등록한다.
// (macOS/Windows에서만 지원되는 API라 다른 환경에서는 조용히 무시되도록
// try/catch로 감싼다.) 최초 설치 때 딱 한 번만 기본값으로 켜주고, 그
// 이후로는 매번 앱을 실행할 때마다 강제로 다시 켜지 않는다 — 설정
// 페이지의 토글로 사용자가 꺼둔 값을 다음 실행 때 도로 덮어써버리는
// 문제를 막기 위함이다. 마커 파일(auto-launch-initialized)의 존재 여부로
// "이미 한 번 처리됐다"를 판단한다.
function getAutoLaunchInitMarkerPath() {
  return path.join(app.getPath("userData"), "auto-launch-initialized");
}

function setAutoLaunch(enabled) {
  try {
    if (!app.isPackaged || typeof app.setLoginItemSettings !== "function") return;
    app.setLoginItemSettings({
      openAtLogin: !!enabled,
      path: process.execPath,
      args: []
    });
    try { fs.writeFileSync(getAutoLaunchInitMarkerPath(), String(Date.now()), "utf-8"); } catch (e0) {}
  } catch (e) {}
}

function getAutoLaunchEnabled() {
  try {
    if (typeof app.getLoginItemSettings !== "function") return false;
    return !!app.getLoginItemSettings().openAtLogin;
  } catch (e) { return false; }
}

function initAutoLaunchDefault() {
  try {
    if (!app.isPackaged || typeof app.setLoginItemSettings !== "function") return;
    if (!fs.existsSync(getAutoLaunchInitMarkerPath())) {
      // 최초 실행: 기본값으로 자동 실행을 켠다.
      setAutoLaunch(true);
      return;
    }
    // 이미 한 번 초기화된 적이 있으면 사용자가 정해둔 켬/끔 값은 그대로 두되,
    // 등록된 실행 파일 경로는 지금 실제로 실행 중인 exe 경로로 매번 새로
    // 맞춰준다. 빌드를 새로 하거나 폴더를 옮기면 예전 경로가 그대로 등록된
    // 채 남아서, 로그인 시 자동 실행이 조용히 실패하던 문제를 막기 위함.
    if (getAutoLaunchEnabled()) {
      app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, args: [] });
    }
  } catch (e) {}
}

// 설정 페이지의 토글에서 현재 상태를 물어보거나 값을 바꿀 때 쓰는 IPC.
ipcMain.on("auto-launch-get", (event) => {
  event.returnValue = getAutoLaunchEnabled();
});
ipcMain.on("auto-launch-set", (event, enabled) => {
  setAutoLaunch(enabled);
});

// 리마인더 시간이 되면 렌더러(웹 화면)가 아니라 여기(메인 프로세스)에서 직접
// 윈도우 알림(토스트)을 띄운다. 렌더러의 web Notification API보다 메인 프로세스의
// Notification 모듈이 윈도우 액션 센터에 훨씬 안정적으로 나타난다. 알림음은 앱에서
// 설정한 크기로 따로 재생하므로, 여기서는 OS 기본 알림음이 겹치지 않도록 무음으로 띄운다.
ipcMain.on("show-reminder-notification", (event, payload) => {
  try {
    if (!Notification.isSupported()) return;
    var title = (payload && payload.title) || "Tracker";
    var body = (payload && payload.body) || "";
    var n;
    // 아이콘 경로(특히 asar로 패키징된 상태)가 문제를 일으켜 알림 생성 자체가
    // 조용히 실패하는 경우가 있어서, 아이콘 포함으로 먼저 시도하고 실패하면
    // 아이콘 없이 한 번 더 시도한다 — 알림창 자체가 안 뜨는 것보다는 아이콘이
    // 없더라도 뜨는 게 낫다.
    try {
      n = new Notification({ title: title, body: body, icon: path.join(__dirname, "icon.ico"), silent: true });
    } catch (eWithIcon) {
      n = new Notification({ title: title, body: body, silent: true });
    }
    n.show();
  } catch (e) {}
});

app.whenReady().then(() => {
  initAutoLaunchDefault();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
