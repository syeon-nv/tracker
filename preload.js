const { contextBridge, ipcRenderer } = require("electron");

// 렌더러(웹 화면)에서 window.titlebarAPI.setOverlay(...)로
// 타이틀바(창 버튼 영역) 색상을 바꿀 수 있도록 안전하게 연결해준다.
contextBridge.exposeInMainWorld("titlebarAPI", {
  setOverlay: function (opts) {
    try { ipcRenderer.send("set-titlebar-overlay", opts); } catch (e) {}
  }
});

// 일기·포트폴리오를 포함한 앱 데이터를 브라우저 저장소가 아니라
// 내 컴퓨터의 실제 파일(사용자 데이터 폴더 안 JSON 파일)로 저장/로드한다.
// loadSync는 앱이 켜질 때 딱 한 번만 동기로 호출돼서 화면이 그려지기 전에
// 기존 데이터를 먼저 읽어와야 하므로 동기 IPC를 쓴다.
contextBridge.exposeInMainWorld("storageAPI", {
  loadSync: function () {
    try { return ipcRenderer.sendSync("storage-load"); } catch (e) { return null; }
  },
  save: function (json) {
    try { ipcRenderer.send("storage-save", json); } catch (e) {}
  }
});

// 설정 페이지에서 "시작프로그램(윈도우 로그인 시 자동 실행)" 토글을
// 켜고 끌 수 있도록 연결해준다. getSync는 OS에 실제로 등록된 현재 값을
// 그대로 읽어오므로(윈도우 설정에서 직접 껐다 켰다 해도 반영됨), 별도
// 저장 없이 항상 최신 상태를 보여줄 수 있다.
contextBridge.exposeInMainWorld("autoLaunchAPI", {
  getSync: function () {
    try { return !!ipcRenderer.sendSync("auto-launch-get"); } catch (e) { return false; }
  },
  set: function (enabled) {
    try { ipcRenderer.send("auto-launch-set", !!enabled); } catch (e) {}
  }
});

// 리마인더 시간이 됐을 때 실제 "윈도우 알림"이 뜨도록, 렌더러의 web Notification API
// 대신 메인 프로세스(main.js)에 직접 알림을 띄워달라고 요청한다. 메인 프로세스 쪽이
// 윈도우 액션 센터에 훨씬 안정적으로 표시된다(AppUserModelID가 등록돼 있어야 하며,
// 그 등록은 main.js에서 처리한다).
contextBridge.exposeInMainWorld("notifyAPI", {
  show: function (title, body) {
    try { ipcRenderer.send("show-reminder-notification", { title: title, body: body }); } catch (e) {}
  }
});

// 시리얼키 + 기기 인증(라이선스). 실제 검증/기록은 전부 메인 프로세스에서
// 처리하고(깃허브 API 토큰이 렌더러 쪽 자바스크립트에 절대 노출되지 않도록),
// 여기서는 결과만 비동기로 돌려받는다.
contextBridge.exposeInMainWorld("licenseAPI", {
  isConfiguredSync: function () {
    try { return !!ipcRenderer.sendSync("license-is-configured"); } catch (e) { return false; }
  },
  activate: function (serialKey) {
    return ipcRenderer.invoke("license-activate", serialKey).catch(function () { return { ok: false, reason: "network-error" }; });
  },
  status: function (serialKey) {
    return ipcRenderer.invoke("license-status", serialKey).catch(function () { return { ok: false, reason: "network-error" }; });
  },
  deactivateSelf: function (serialKey) {
    return ipcRenderer.invoke("license-deactivate-self", serialKey).catch(function () { return { ok: false, reason: "network-error" }; });
  }
});
