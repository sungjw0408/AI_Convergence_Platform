const rowSelector = "[data-swipe-row]";
const contentSelector = "[data-swipe-content]";
const actionSelector = "[data-swipe-action]";
const movementThreshold = 8;

export function bindSwipeActions(root) {
  let openRow;
  let gesture;
  let draggedRow;

  function setOpen(row) {
    if (openRow !== row) openRow?.classList.remove("swipe-open");
    openRow = row;
    row?.classList.add("swipe-open");
  }

  root.addEventListener("pointerdown", event => {
    if (event.isPrimary === false || event.button !== 0) return;
    draggedRow = null;
    gesture = null;
    const row = event.target.closest(rowSelector);
    if (row !== openRow) setOpen(null);
    const content = event.target.closest(contentSelector);
    if (!row || !content) return;
    gesture = { row, content, id: event.pointerId, x: event.clientX, y: event.clientY, begun: false };
  });

  root.addEventListener("pointermove", event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const { row, content } = gesture;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.begun) {
      if (Math.abs(dy) > movementThreshold && Math.abs(dy) >= Math.abs(dx)) {
        gesture = null;
        return;
      }
      if (Math.abs(dx) < movementThreshold || Math.abs(dx) <= Math.abs(dy)) return;
      gesture.begun = true;
      gesture.width = row.querySelector(actionSelector).offsetWidth;
      gesture.start = row === openRow ? gesture.width : 0;
      row.classList.add("swipe-dragging");
      content.setPointerCapture?.(event.pointerId);
    }
    gesture.revealed = Math.max(0, Math.min(gesture.width, gesture.start - dx));
    row.style.setProperty("--swipe-distance", `${gesture.revealed}px`);
  });

  function finish(event) {
    if (!gesture || gesture.id !== event.pointerId) return;
    if (event.type === "lostpointercapture" && event.target !== gesture.content) return;
    const { row, width, revealed, begun } = gesture;
    gesture = null;
    if (!begun) return;
    if (event.type === "pointerup") {
      draggedRow = row;
      setOpen(revealed >= width / 2 ? row : null);
    }
    row.classList.remove("swipe-dragging");
    row.style.removeProperty("--swipe-distance");
  }
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) root.addEventListener(event, finish);

  root.addEventListener("dragstart", event => {
    if (event.target.closest(contentSelector)) event.preventDefault();
  });

  root.addEventListener("click", event => {
    const row = event.target.closest(rowSelector);
    if (!event.target.closest(contentSelector) || event.detail === 0 || (row !== draggedRow && row !== openRow)) return;
    event.preventDefault();
    event.stopPropagation();
    if (row !== draggedRow) setOpen(null);
    draggedRow = null;
  }, true);

  root.addEventListener("keydown", event => {
    const row = event.target.closest(rowSelector);
    if (!row) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setOpen(row);
      row.querySelector(actionSelector).focus();
    } else if (event.key === "Escape" || event.key === "ArrowRight") {
      if (row !== openRow && !event.target.closest(actionSelector)) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(null);
      row.querySelector(contentSelector).focus();
    }
  }, true);
}
