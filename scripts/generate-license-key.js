#!/usr/bin/env node
// 시리얼키 자동 생성 스크립트.
//
// main.js가 쓰는 것과 같은 "licenses.json이 있는 비공개 깃허브 저장소"에
// 새 시리얼키를 무작위로 만들어서 바로 추가해준다(직접 JSON을 열어서 손으로
// 타이핑할 필요 없음). 사람이 쓰기 쉽도록 헷갈리는 글자(0/O, 1/I/L 등)는
// 뺀 알파벳으로, "XXXX-XXXX-XXXX" 형식의 키를 만든다.
//
// 사용법 (이 프로젝트 폴더에서, license-config.js를 이미 만들어뒀다면):
//   node scripts/generate-license-key.js        (1개 생성)
//   node scripts/generate-license-key.js 5      (5개 생성)
//
// 저장소 정보(LICENSE_REPO_OWNER/NAME)와 토큰은 main.js와 똑같이
// license-config.js(README 참고, .gitignore로 깃허브에는 올라가지 않음)에서
// 그대로 읽어온다. 그 파일이 없다면 환경변수로 대신 넘겨도 된다:
//   GITHUB_TOKEN=ghp_xxxxxxxx LICENSE_REPO_OWNER=계정명 LICENSE_REPO_NAME=저장소명 node scripts/generate-license-key.js 3
let fileConfig = {};
try { fileConfig = require("../license-config.js") || {}; } catch (e) {}

const LICENSE_REPO_OWNER = process.env.LICENSE_REPO_OWNER || fileConfig.LICENSE_REPO_OWNER || "";
const LICENSE_REPO_NAME = process.env.LICENSE_REPO_NAME || fileConfig.LICENSE_REPO_NAME || "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || fileConfig.GITHUB_TOKEN || "";
const LICENSE_FILE_PATH = "licenses.json";

if (!GITHUB_TOKEN || !LICENSE_REPO_OWNER || !LICENSE_REPO_NAME) {
  console.error("license-config.js가 없거나 값이 비어있습니다(또는 환경변수가 없습니다).");
  console.error("license-config.example.js를 복사해서 license-config.js를 먼저 만들어주세요.");
  process.exit(1);
}

const count = Math.max(1, parseInt(process.argv[2], 10) || 1);

// 0/O, 1/I/L, 8/B 처럼 손으로 옮겨 적다 헷갈리기 쉬운 글자를 뺀 알파벳.
const ALPHABET = "ACDEFGHJKMNPQRSTUVWXYZ2346789";

function randomGroup(len) {
  var out = "";
  for (var i = 0; i < len; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

function generateKey() {
  return [randomGroup(4), randomGroup(4), randomGroup(4)].join("-");
}

async function githubApiRequest(method, urlPath, body) {
  const res = await fetch("https://api.github.com" + urlPath, {
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
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    throw new Error("GitHub API " + method + " " + urlPath + " 실패 (" + res.status + "): " + JSON.stringify(data));
  }
  return data;
}

async function main() {
  const file = await githubApiRequest(
    "GET",
    "/repos/" + LICENSE_REPO_OWNER + "/" + LICENSE_REPO_NAME + "/contents/" + LICENSE_FILE_PATH
  );
  const json = JSON.parse(Buffer.from(file.content, "base64").toString("utf-8"));

  const newKeys = [];
  for (var i = 0; i < count; i++) {
    var key;
    do { key = generateKey(); } while (json[key]); // 혹시 모를 중복 방지
    json[key] = { devices: [] };
    newKeys.push(key);
  }

  const content = Buffer.from(JSON.stringify(json, null, 2), "utf-8").toString("base64");
  await githubApiRequest(
    "PUT",
    "/repos/" + LICENSE_REPO_OWNER + "/" + LICENSE_REPO_NAME + "/contents/" + LICENSE_FILE_PATH,
    {
      message: "새 시리얼키 " + count + "개 추가",
      content: content,
      sha: file.sha
    }
  );

  console.log("새 시리얼키 " + count + "개를 만들어서 저장소에 올렸습니다:\n");
  newKeys.forEach(function (k) { console.log("  " + k); });
}

main().catch(function (err) {
  console.error(err.message || err);
  process.exit(1);
});
