/** Keep the focused field inside the space above a software keyboard. */
export function followModalViewport(modal: HTMLElement, content: HTMLElement): () => void {
  const win = content.ownerDocument.defaultView;
  if (!win) return () => {};
  const viewport = win.visualViewport;
  const initialHeight = win.innerHeight;
  let frame: number | undefined;
  let keyboardOpen = false;
  const update = () => {
    frame = undefined;
    if (!modal.isConnected) return;
    const active = content.ownerDocument.activeElement;
    const editing = !!active && content.contains(active) && active.matches("input, textarea, [contenteditable=true]");
    const height = viewport?.height ?? win.innerHeight;
    keyboardOpen = (editing || keyboardOpen) && (viewport?.scale ?? 1) === 1 && initialHeight - height > 100;
    modal.classList.toggle("is-keyboard-open", keyboardOpen);
    if (keyboardOpen) {
      modal.style.setProperty("--temperans-keyboard-height", Math.max(0, height - 16) + "px");
      modal.style.setProperty("--temperans-keyboard-top", (viewport?.offsetTop ?? 0) + 8 + "px");
    } else {
      modal.style.removeProperty("--temperans-keyboard-height");
      modal.style.removeProperty("--temperans-keyboard-top");
    }
    if (editing) active.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  };
  const schedule = () => {
    if (frame !== undefined) win.cancelAnimationFrame(frame);
    frame = win.requestAnimationFrame(update);
  };
  content.addEventListener("focusin", schedule);
  content.addEventListener("focusout", schedule);
  win.addEventListener("resize", schedule);
  viewport?.addEventListener("resize", schedule);
  viewport?.addEventListener("scroll", schedule);
  return () => {
    if (frame !== undefined) win.cancelAnimationFrame(frame);
    content.removeEventListener("focusin", schedule);
    content.removeEventListener("focusout", schedule);
    win.removeEventListener("resize", schedule);
    viewport?.removeEventListener("resize", schedule);
    viewport?.removeEventListener("scroll", schedule);
    modal.classList.remove("is-keyboard-open");
    modal.style.removeProperty("--temperans-keyboard-height");
    modal.style.removeProperty("--temperans-keyboard-top");
  };
}
