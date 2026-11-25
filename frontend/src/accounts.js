export async function accountRequest(action, credentials) {
  const options = { cache: "no-store", signal: AbortSignal.timeout(20000) };
  if (action !== "session") {
    options.method = "POST";
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(credentials ?? {});
  }
  const response = await fetch("/api/account/" + action, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "계정 요청을 처리하지 못했어요.");
  return result;
}

export function accountPage(signup) {
  return `<header class="page-header"><h1>렌토</h1></header>
    <div class="content">
      <form class="form-card plain" data-form="${signup ? "signup" : "login"}">
        <h2>${signup ? "회원가입" : "로그인"}</h2>
        <label>이메일<input name="email" type="email" autocomplete="username" maxlength="254" required></label>
        <label>비밀번호<input name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}"
          ${signup ? 'minlength="8"' : ""} maxlength="128" required></label>
        <p class="form-error" role="alert" hidden></p>
        <button class="button primary" type="submit">${signup ? "가입하기" : "로그인"}</button>
        <a class="button secondary" href="${signup ? "#login" : "#signup"}">${signup ? "로그인으로 돌아가기" : "회원가입"}</a>
      </form>
    </div>`;
}
