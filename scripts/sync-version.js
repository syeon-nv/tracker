// 빌드하기 전에 자동으로 실행되는 스크립트.
// package.json의 "version" 값을 index.html 안의 APP_VERSION 자리에 그대로 넣어준다.
// (버전을 깜빡 잊고 안 바꾼 채로 빌드하는 실수를 막기 위함 — 사람이 직접 index.html을
// 열어서 고칠 필요가 없다.)
const fs = require("fs");
const path = require("path");

const pkg = require(path.join(__dirname, "..", "package.json"));
const version = pkg.version;
const indexPath = path.join(__dirname, "..", "index.html");
let html = fs.readFileSync(indexPath, "utf-8");

const re = /var APP_VERSION = "[^"]*";/;
if (!re.test(html)) {
  console.error("[sync-version] index.html에서 APP_VERSION 줄을 찾지 못했어요. 아무것도 바꾸지 않았습니다.");
  process.exit(1);
}

html = html.replace(re, 'var APP_VERSION = "' + version + '";');
fs.writeFileSync(indexPath, html, "utf-8");
console.log("[sync-version] index.html의 APP_VERSION을 \"" + version + "\"(으)로 맞췄어요.");
