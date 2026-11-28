import { neighborhoods } from "./model.js?v=rento-home-5-ren";

export function profileImage(photo, escape) {
  return photo?.startsWith("data:image/jpeg;base64,")
    ? `<img class="profile-image" src="${escape(photo)}" alt="">` : "";
}

function profileFields({ displayName, area, photo }, escape) {
  return `<label>이름 <small class="hint">선택</small><input name="displayName" value="${escape(displayName)}" autocomplete="name" maxlength="48"></label>
    <label>거주 지역<select name="area" required>
      <option value="">지역을 선택해 주세요</option>
      ${neighborhoods.map((name) => `<option ${area === name ? "selected" : ""}>${escape(name)}</option>`).join("")}
    </select></label>
    ${photo ? `<span class="avatar">${profileImage(photo, escape)}</span>` : ""}
    <label>프로필 사진 <small class="hint">선택</small>
      <input type="file" name="profilePhoto" accept="image/jpeg,image/png,image/webp">
    </label>
    ${photo ? '<label class="profile-photo-remove"><input type="checkbox" name="removePhoto"> 기본 프로필 사진으로 변경</label>' : ""}`;
}

export function profileEditForm(profile, escape) {
  return `<form class="form-card plain" data-form="edit-profile">
    ${profileFields(profile, escape)}
    <p class="form-error" role="alert" hidden></p>
    <button class="button primary" type="submit">프로필 저장</button>
  </form>`;
}

export async function readProfileSettings(fields, previousPhoto = "") {
  const displayName = fields.get("displayName")?.trim(), area = fields.get("area");
  if (displayName === undefined || displayName.length > 48 || !neighborhoods.includes(area)) {
    throw new Error("이름과 거주 지역을 확인해 주세요.");
  }

  const file = fields.get("profilePhoto");
  let photo = fields.has("removePhoto") ? "" : previousPhoto;
  if (file?.size) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 12 * 1024 * 1024) {
      throw new Error("12MB 이하의 JPG, PNG 또는 WEBP 사진을 선택해 주세요.");
    }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = Math.min(192, side);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2,
        side, side, 0, 0, canvas.width, canvas.height);
      photo = canvas.toDataURL("image/jpeg", 0.82);
      if (!photo.startsWith("data:image/jpeg;base64,") || photo.length > 48000) throw new Error();
    } catch {
      throw new Error("사진을 읽지 못했어요. 다른 사진을 선택해 주세요.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return { displayName, area, photo };
}

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

export function accountPage(signup, escape) {
  return `<header class="page-header"><h1>렌토</h1></header>
    <div class="content">
      <form class="form-card plain" data-form="${signup ? "signup" : "login"}">
        <h2>${signup ? "회원가입" : "로그인"}</h2>
        <label>이메일<input name="email" type="email" autocomplete="username" maxlength="254" required></label>
        <label>비밀번호<input name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}"
          ${signup ? 'minlength="8"' : ""} maxlength="128" required></label>
        ${signup ? profileFields({ area: neighborhoods[0] }, escape) : ""}
        <p class="form-error" role="alert" hidden></p>
        <button class="button primary" type="submit">${signup ? "가입하기" : "로그인"}</button>
        <a class="button secondary" href="${signup ? "#login" : "#signup"}">${signup ? "로그인으로 돌아가기" : "회원가입"}</a>
      </form>
    </div>`;
}
