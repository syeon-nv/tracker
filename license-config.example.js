// 이 파일을 복사해서 같은 폴더에 "license-config.js"라는 이름으로 저장하고,
// 아래 값들을 실제 값으로 채워넣으세요.
//
// license-config.js는 .gitignore에 이미 등록돼 있어서 깃허브에(이 프로젝트를
// 올리는 저장소가 공개든 비공개든) 올라가지 않습니다 — 토큰이 그대로
// 커밋되는 사고를 막기 위한 구조입니다. 이 예시 파일(license-config.example.js)만
// 깃허브에 올라가고, 실제 값이 든 license-config.js는 내 컴퓨터에만 남습니다.
//
// GITHUB_TOKEN 발급 방법:
//   1. LICENSE_REPO_OWNER로 쓸 깃허브 계정으로 로그인
//   2. Settings → Developer settings → Personal access tokens →
//      Fine-grained tokens → Generate new token
//   3. Repository access를 "Only select repositories"로 하고 아래
//      LICENSE_REPO_NAME 저장소만 선택
//   4. Permissions → Repository permissions → Contents를 "Read and write"로 설정
//   5. 발급된 토큰(ghp_로 시작하거나 github_pat_로 시작)을 아래에 붙여넣기
module.exports = {
  GITHUB_TOKEN: "ghp_여기에_실제_토큰을_붙여넣으세요",
  LICENSE_REPO_OWNER: "여기에_깃허브_계정명(사용자명 또는 조직명)",
  // licenses.json을 올려둘 "비공개" 저장소 이름. version.json이 있는
  // 공개 저장소(tracker)와는 반드시 다른 저장소를 쓰세요.
  LICENSE_REPO_NAME: "여기에_비공개_저장소_이름"
};
