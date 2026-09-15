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

// 윈도우에서 설치 직후 자동 실행 + 바탕화면/시작메뉴 아이콘 실행이 겹치거나,
// 시작프로그램 자동 실행과 사용자의 수동 실행이 겹치는 경우 등으로 앱 창이
// 두 개 뜨는 문제가 있었다. Electron의 단일 인스턴스 락을 걸어서, 이미 앱이
// 떠 있는 상태에서 또 실행되면 새 프로세스는 즉시 종료하고, 대신 기존 창을
// 앞으로 가져오도록 한다.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
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

// ── 시리얼키 + 기기 인증(라이선스) ──────────────────────────────────────
// 별도 서버 없이, 비공개 깃허브 저장소에 있는 licenses.json 파일 하나를
// "데이터베이스"로 써서 시리얼키당 최대 2대까지 기기를 등록/해제한다.
// 보안이 아주 강할 필요는 없다는 전제(무단 배포를 어느 정도만 막으면
// 충분)로 고른 가장 간단한 구조이며, 앱 안에 박아넣는 토큰이 유출되면
// 이 제한은 우회될 수 있다는 걸 알고 쓰는 방식이다.
//
// 실제 값(토큰, 저장소 이름)은 이 파일에 직접 적지 않고 license-config.js
// 라는 별도 파일에서 읽어온다. license-config.js는 .gitignore에 등록돼
// 있어서 깃허브에(이 프로젝트를 올리는 저장소가 공개든 비공개든) 절대
// 올라가지 않는다 — main.js는 앱 소스코드라 깃허브에 커밋해서 버전 관리를
// 하게 되는데, 거기에 토큰을 그대로 적어두면 저장소를 볼 수 있는 사람
// 누구나 그 토큰으로 licenses.json을 마음대로 읽고 쓸 수 있게 돼서
// (시리얼키 제한 자체가 무의미해짐) 반드시 분리해야 한다.
//
// 처음 설정하는 법: license-config.example.js를 복사해서 "license-config.js"
// 이름으로 저장하고, 그 안의 값들을 실제로 채워넣으면 된다(README 참고).
// license-config.js가 아직 없으면(설정 전) 라이선스 기능은 조용히 꺼진
// 채로 동작한다(인증 화면이 뜨지 않음) — 개발 중에 이 파일 없이도 앱
// 자체는 정상적으로 켜져야 하므로 에러를 던지지 않는다.
var licenseConfig = { GITHUB_TOKEN: "", LICENSE_REPO_OWNER: "", LICENSE_REPO_NAME: "" };
try {
  var loadedLicenseConfig = require("./license-config.js");
  if (loadedLicenseConfig && typeof loadedLicenseConfig === "object") {
    licenseConfig = Object.assign(licenseConfig, loadedLicenseConfig);
  }
} catch (eLicenseConfig) {
  // license-config.js가 없거나 문법 오류가 있으면 라이선스 기능만 비활성화하고 넘어간다.
}
const GITHUB_TOKEN = licenseConfig.GITHUB_TOKEN;
const LICENSE_REPO_OWNER = licenseConfig.LICENSE_REPO_OWNER;
const LICENSE_REPO_NAME = licenseConfig.LICENSE_REPO_NAME;
const LICENSE_FILE_PATH = "licenses.json";
const MAX_DEVICES_PER_KEY = 2;
function isLicenseConfigured() {
  return !!(GITHUB_TOKEN && LICENSE_REPO_OWNER && LICENSE_REPO_NAME);
}

function getDeviceIdFilePath() {
  return path.join(app.getPath("userData"), "device-id.txt");
}

// 이 컴퓨터를 구분하는 고유 ID. 한 번 만들면 사용자 데이터 폴더에 저장해두고
// 계속 재사용한다(앱을 다시 설치해도 같은 폴더를 쓰는 한 유지된다).
function getOrCreateDeviceId() {
  try {
    var p = getDeviceIdFilePath();
    if (fs.existsSync(p)) {
      var existing = fs.readFileSync(p, "utf-8").trim();
      if (existing) return existing;
    }
    var id = require("crypto").randomUUID();
    fs.writeFileSync(p, id, "utf-8");
    return id;
  } catch (e) {
    return null;
  }
}

async function githubApiRequest(method, urlPath, body) {
  var res = await fetch("https://api.github.com" + urlPath, {
    method: method,
    headers: {
      "Authorization": "Bearer " + GITHUB_TOKEN,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  var data = null;
  try { data = await res.json(); } catch (eParse) {}
  return { ok: res.ok, status: res.status, data: data };
}

async function fetchLicenseFile() {
  var r = await githubApiRequest("GET", "/repos/" + LICENSE_REPO_OWNER + "/" + LICENSE_REPO_NAME + "/contents/" + LICENSE_FILE_PATH);
  if (!r.ok || !r.data || typeof r.data.content !== "string") {
    throw new Error("license file fetch failed: " + r.status);
  }
  var content = Buffer.from(r.data.content, "base64").toString("utf-8");
  return { json: JSON.parse(content), sha: r.data.sha };
}

async function writeLicenseFile(json, sha, message) {
  var content = Buffer.from(JSON.stringify(json, null, 2), "utf-8").toString("base64");
  return githubApiRequest("PUT", "/repos/" + LICENSE_REPO_OWNER + "/" + LICENSE_REPO_NAME + "/contents/" + LICENSE_FILE_PATH, {
    message: message || "update licenses.json",
    content: content,
    sha: sha
  });
}

// 시리얼키를 이 기기에 등록한다. 이미 등록돼 있으면(재실행 등) 그대로
// 성공 처리하고, 등록된 기기가 이미 2대(MAX_DEVICES_PER_KEY)면 거절한다.
// 렌더러가 시작하자마자(첫 화면을 그리기 전에) "라이선스 기능이 설정돼
// 있는지"를 동기적으로 물어봐야 해서(비동기로 하면 그 사이 잠깐 앱이 그냥
// 보여버림) sendSync를 쓴다. license-config.js를 아직 안 채워넣은
// 상태에서는 항상 false를 돌려줘서, 인증 화면 자체가 뜨지 않게 한다
// (설정 전인데 자기 자신이 잠겨버리는 걸 막기 위함).
ipcMain.on("license-is-configured", (event) => {
  event.returnValue = isLicenseConfigured();
});

ipcMain.handle("license-activate", async (event, serialKey) => {
  try {
    if (!isLicenseConfigured()) return { ok: false, reason: "not-configured" };
    if (!serialKey || typeof serialKey !== "string") return { ok: false, reason: "invalid-key" };
    var deviceId = getOrCreateDeviceId();
    if (!deviceId) return { ok: false, reason: "device-id-failed" };
    var file = await fetchLicenseFile();
    var entry = file.json[serialKey];
    if (!entry) return { ok: false, reason: "invalid-key" };
    entry.devices = entry.devices || [];
    if (entry.devices.indexOf(deviceId) !== -1) {
      return { ok: true, alreadyActivated: true, deviceId: deviceId, deviceCount: entry.devices.length };
    }
    if (entry.devices.length >= MAX_DEVICES_PER_KEY) {
      return { ok: false, reason: "device-limit", deviceCount: entry.devices.length };
    }
    entry.devices.push(deviceId);
    var writeRes = await writeLicenseFile(file.json, file.sha, "activate device for " + serialKey);
    if (!writeRes.ok) return { ok: false, reason: "write-failed" };
    return { ok: true, deviceId: deviceId, deviceCount: entry.devices.length };
  } catch (e) {
    return { ok: false, reason: "network-error" };
  }
});

// 지금 이 기기를 그 시리얼키에서 해제한다(컴퓨터를 바꿀 때 다른 기기에서
// 새로 등록할 수 있게 자리를 비워주는 용도).
ipcMain.handle("license-deactivate-self", async (event, serialKey) => {
  try {
    if (!isLicenseConfigured()) return { ok: false, reason: "not-configured" };
    if (!serialKey || typeof serialKey !== "string") return { ok: false, reason: "invalid-key" };
    var deviceId = getOrCreateDeviceId();
    var file = await fetchLicenseFile();
    var entry = file.json[serialKey];
    if (!entry) return { ok: false, reason: "invalid-key" };
    entry.devices = (entry.devices || []).filter(function (d) { return d !== deviceId; });
    var writeRes = await writeLicenseFile(file.json, file.sha, "deactivate device for " + serialKey);
    if (!writeRes.ok) return { ok: false, reason: "write-failed" };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "network-error" };
  }
});

// 저장된 키가 지금도 이 기기에서 유효한지(다른 기기에서 나를 해제해버리지
// 않았는지) 조용히 다시 확인할 때 쓴다. 오프라인이면 그냥 에러로 처리하고,
// 렌더러 쪽에서는 이걸로 무조건 막지 않고 마지막으로 확인된 상태를 그대로
// 믿어준다(인터넷 없을 때도 앱은 계속 쓸 수 있어야 하므로).
ipcMain.handle("license-status", async (event, serialKey) => {
  try {
    if (!isLicenseConfigured()) return { ok: false, reason: "not-configured" };
    if (!serialKey || typeof serialKey !== "string") return { ok: false, reason: "invalid-key" };
    var deviceId = getOrCreateDeviceId();
    var file = await fetchLicenseFile();
    var entry = file.json[serialKey];
    if (!entry) return { ok: false, reason: "invalid-key" };
    var devices = entry.devices || [];
    return { ok: true, activated: devices.indexOf(deviceId) !== -1, deviceCount: devices.length, deviceId: deviceId };
  } catch (e) {
    return { ok: false, reason: "network-error" };
  }
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

// 뒤늦게 실행된(락을 못 얻은) 두 번째 프로세스가 위에서 이미 종료를 예약했으므로,
// 그 경우 아래 초기화 로직 자체를 건너뛴다. 정상적인(락을 획득한) 프로세스에서
// 두 번째 실행 시도가 감지되면("second-instance") 새 창을 띄우는 대신 기존
// 창을 앞으로 가져와 포커스한다.
if (gotSingleInstanceLock) {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
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
}
