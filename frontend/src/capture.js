import { photoUrl } from "./photo-store.js";

export const faces = ["정면", "후면", "왼쪽 면", "오른쪽 면", "윗면", "아랫면"];
const capturedFrames = new WeakMap();

// Bind the exact image bytes and their source to the flow that accepted them.
export function isRecordedCapture(photo, context = null) {
  const frame = photo?.blob && capturedFrames.get(photo.blob);
  return Boolean(frame && frame.context === context && frame.capturedAt === photo.capturedAt
    && frame.width === photo.width && frame.height === photo.height && frame.origin === photo.origin);
}

export function pickCaptureFile(form, { face, context = null, onCapture, onError }) {
  if (form.querySelector("[data-capture-file]")) return;
  const types = ["image/jpeg", "image/png", "image/webp"];
  const input = document.createElement("input");
  input.type = "file";
  input.accept = types.join(",");
  input.hidden = true;
  input.setAttribute("data-capture-file", "");
  form.append(input);
  input.addEventListener("cancel", () => input.remove(), { once: true });
  input.addEventListener("change", async () => {
    try {
      const file = input.files[0];
      if (!file) return;
      if (!types.includes(file.type) || !file.size || file.size > 4 * 1024 * 1024) {
        throw new Error("4MB 이하의 JPG, PNG 또는 WebP 사진을 골라 주세요.");
      }
      const image = await createImageBitmap(file).catch(() => {
        throw new Error("사진을 열 수 없어요. 다른 사진으로 다시 시도해 주세요.");
      });
      const { width, height } = image;
      image.close();
      if (Math.min(width, height) < 96 || width * height > 20_000_000) {
        throw new Error("가로·세로가 각각 96픽셀 이상이고 2,000만 픽셀 이하인 사진을 골라 주세요.");
      }
      if (!form.isConnected) return;
      const capturedAt = new Date().toISOString();
      const capture = { blob: file, width, height, capturedAt, face, origin: "file" };
      capturedFrames.set(file, { context, capturedAt, width, height, origin: capture.origin });
      onCapture(capture);
    } catch (error) {
      if (form.isConnected) onError(error.message);
    } finally {
      input.remove();
    }
  }, { once: true });
  input.click();
}

// The guide is a separate DOM layer. Only the unmirrored video frame is saved.
export function openCapture({ reference, face = "정면", instruction, returning = Boolean(reference), title, context = null, sequence, onComplete, onCapture }) {
  const shots = sequence?.length ? sequence.map((view) => ({ ...view })) : null;
  let shotIndex = 0;
  if (shots) { face = shots[0].label; instruction = shots[0].instruction; }
  const dialog = document.createElement("dialog");
  dialog.className = "camera-dialog";
  dialog.setAttribute("aria-label", `${face} 직접 촬영`);
  dialog.innerHTML = `<header class="dialog-header"><h2></h2>
    <button class="icon-button" data-camera="close" aria-label="촬영 닫기">×</button></header>
    <p class="camera-face"></p><p class="camera-instruction hint"></p>
    <div class="camera-stage"><video playsinline muted autoplay></video>
      <img class="camera-reference" alt="반투명 대여 전 사진 가이드" hidden>
      <img class="camera-still" alt="방금 촬영한 원본" hidden>
      <div class="camera-frame" aria-hidden="true"></div>
      <p class="camera-placeholder">카메라 시작을 누르면 촬영 화면이 열려요.</p></div>
    ${reference ? `<div class="guide-controls"><label><input type="checkbox" name="guide" checked> 대여 전 사진 겹쳐 보기</label>
      <label>투명도 <input name="opacity" type="range" min="10" max="80" value="35" aria-label="대여 전 사진 투명도"></label></div>` : ""}
    <p class="camera-status hint" role="status" aria-live="polite"></p>
    <div class="camera-actions"><button class="button primary" data-camera="start">카메라 시작</button>
      <button class="button primary" data-camera="shoot" hidden>촬영하기</button>
      <button class="button secondary" data-camera="retake" hidden>다시 촬영</button>
      <button class="button primary" data-camera="use" hidden>이 사진 등록</button></div>`;
  document.body.append(dialog);
  dialog.querySelector("h2").textContent = title || (returning ? "반납 사진 촬영" : "대여 전 사진 촬영");
  const video = dialog.querySelector("video"), overlay = dialog.querySelector(".camera-reference");
  const still = dialog.querySelector(".camera-still"), status = dialog.querySelector(".camera-status");
  const placeholder = dialog.querySelector(".camera-placeholder");
  const button = (action) => dialog.querySelector(`[data-camera="${action}"]`);
  const updateFace = () => {
    if (shots) { face = shots[shotIndex].label; instruction = shots[shotIndex].instruction; }
    dialog.setAttribute("aria-label", `${face} 직접 촬영`);
    dialog.querySelector(".camera-face").textContent = shots ? `${shotIndex + 1} / ${shots.length} · ${face}` : `촬영 면 · ${face}`;
    dialog.querySelector(".camera-instruction").textContent = instruction || "물품이 가려지지 않도록 선명하게 촬영해 주세요.";
  };
  updateFace();
  dialog.querySelector(".camera-instruction").textContent = instruction || "물품이 가려지지 않도록 선명하게 촬영해 주세요.";
  let stream, capture, pending = false, closed = false, stillUrl;
  if (reference) { overlay.src = photoUrl(reference); overlay.style.opacity = ".35"; }
  const stop = () => { stream?.getTracks().forEach((track) => track.stop()); stream = undefined; video.srcObject = null; };
  const onNavigation = () => { if (dialog.open) dialog.close(); };
  const clean = () => { closed = true; stop(); URL.revokeObjectURL(stillUrl); document.removeEventListener("visibilitychange", onVisibility); window.removeEventListener("hashchange", onNavigation); dialog.remove(); };
  const onVisibility = () => { if (document.hidden) dialog.close(); };
  document.addEventListener("visibilitychange", onVisibility);
  dialog.addEventListener("close", clean, { once: true });
  window.addEventListener("hashchange", onNavigation);
  dialog.addEventListener("input", () => {
    if (!reference) return;
    overlay.hidden = !stream || Boolean(capture) || !dialog.querySelector('[name="guide"]').checked;
    overlay.style.opacity = dialog.querySelector('[name="opacity"]').value / 100;
  });
  dialog.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-camera]")?.dataset.camera;
    if (action === "close") { dialog.close(); return; }
    if (action === "start" || action === "retake") {
      if (pending) return;
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        status.textContent = "카메라는 HTTPS 또는 localhost에서 지원되는 브라우저로 열어 주세요."; return;
      }
      pending = true; button("start").disabled = true; button("retake").disabled = true;
      status.textContent = "카메라 접근 권한을 확인하고 있어요.";
      try {
        const acquired = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" },
          width: { ideal: 1280, max: 1280 }, height: { ideal: 960, max: 960 } }, audio: false });
        if (closed) { acquired.getTracks().forEach((track) => track.stop()); return; }
        stop(); stream = acquired; video.srcObject = stream; await video.play();
        if (closed) { stop(); return; }
        capture = undefined; still.hidden = true; video.hidden = false; placeholder.hidden = true;
        for (const key of ["start", "retake", "use"]) button(key).hidden = true;
        button("shoot").hidden = false;
        overlay.hidden = !reference || !dialog.querySelector('[name="guide"]').checked;
        status.textContent = reference ? "대여 전 사진과 물품의 윤곽을 맞춰 주세요." : "흔들리지 않게 촬영해 주세요.";
      } catch (error) {
        stop(); overlay.hidden = true;
        status.textContent = error.name === "NotAllowedError" ? "카메라 권한이 필요해요. 브라우저의 사이트 설정에서 허용한 뒤 다시 시도해 주세요."
          : error.name === "NotFoundError" ? "사용할 수 있는 카메라가 없어요. 카메라가 있는 기기에서 열어 주세요."
          : "카메라를 열 수 없어요. 다른 앱의 카메라 사용을 종료하고 다시 시도해 주세요.";
      } finally { pending = false; button("start").disabled = false; button("retake").disabled = false; }
    } else if (action === "shoot" && stream && !pending) {
      pending = true; button("shoot").disabled = true;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        if (!canvas.width || !canvas.height) throw new Error("촬영 화면이 준비되면 다시 눌러 주세요.");
        canvas.getContext("2d").drawImage(video, 0, 0);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("촬영에 실패했어요. 다시 시도해 주세요.");
        if (closed) return;
        capture = { blob, capturedAt: new Date().toISOString(), width: canvas.width, height: canvas.height, face, source: "camera", origin: "camera" };
        capturedFrames.set(blob, { context, capturedAt: capture.capturedAt, width: capture.width, height: capture.height, origin: capture.origin });
        if (shots) {
          // Keep one stream open; each fresh frame advances to the next part.
          const accepted = onCapture(capture, shots[shotIndex]);
          if (accepted === false) { dialog.close(); return; }
          shotIndex++;
          if (shotIndex === shots.length) { dialog.close(); onComplete?.(); return; }
          capture = undefined;
          updateFace();
          status.textContent = "저장했어요. 물품을 돌려 다음 부위를 촬영해 주세요.";
          return;
        }
        URL.revokeObjectURL(stillUrl); stillUrl = URL.createObjectURL(blob); still.src = stillUrl;
        stop(); video.hidden = true; overlay.hidden = true; still.hidden = false;
        button("shoot").hidden = true; button("retake").hidden = false; button("use").hidden = false;
        status.textContent = "흔들림과 가려짐을 확인한 뒤 사진을 등록해 주세요.";
      } catch (error) { status.textContent = error.message; }
      finally { pending = false; button("shoot").disabled = false; }
    } else if (action === "use" && capture) {
      onCapture(capture); dialog.close();
    }
  });
  dialog.showModal();
  return dialog;
}
