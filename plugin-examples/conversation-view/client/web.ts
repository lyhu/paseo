import { Platform } from "react-native";

// DOM access stays in this web-only module; the plugin's shared TS config has no DOM library.
interface Element {
  parentElement: Element | null;
  textContent: string | null;
  isConnected: boolean;
  clientWidth: number;
  style: Record<string, string>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  closest(selector: string): Element | null;
  querySelectorAll(selector: string): ArrayLike<Element>;
  getBoundingClientRect(): {
    top: number;
    bottom: number;
    left: number;
    width: number;
    height: number;
  };
  appendChild(element: Element): void;
  remove(): void;
}
declare const document: {
  body: Element;
  createElement(tag: string): Element;
  addEventListener(name: string, callback: () => void, capture?: boolean): void;
  removeEventListener(name: string, callback: () => void, capture?: boolean): void;
};
declare const window: {
  requestAnimationFrame(callback: () => void): number;
  cancelAnimationFrame(id: number): void;
  addEventListener(name: string, callback: () => void): void;
  removeEventListener(name: string, callback: () => void): void;
};
declare const MutationObserver: new (callback: (records: Array<{ target: unknown }>) => void) => {
  observe(element: Element, options: Record<string, boolean>): void;
  disconnect(): void;
};
declare const ResizeObserver: new (callback: () => void) => {
  observe(element: Element): void;
  disconnect(): void;
};

export interface StickyPrompt {
  id: string;
  text: string;
  aliases?: readonly string[];
}

/** Resolve the preceding user prompt for a mounted history row, including virtualized history. */
export type ResolveStickyPrompt = (
  rowId: string,
  messageId: string | null,
) => StickyPrompt | undefined;

const SCROLL_SELECTOR = '[data-testid="agent-chat-scroll"]';
const ROW_SELECTOR = "[data-history-row-id]";
export interface StickyColors {
  background: string;
  foreground: string;
  muted: string;
  border: string;
}
const installations = new Map<Element, { count: number; cleanup: () => void }>();

export function getStickyViewport(anchor: unknown): unknown | undefined {
  if (Platform.OS !== "web" || typeof document === "undefined") return undefined;
  return (anchor as Element | null)?.closest?.(SCROLL_SELECTOR) ?? undefined;
}

/** Decorate the host viewport without replacing native prompts or touching its scrolling model. */
export function installStickyMessages(
  anchor: unknown,
  resolvePrompt: ResolveStickyPrompt,
  colors: StickyColors,
  subscribeChanges?: (listener: () => void) => () => void,
  onDetached?: () => void,
): () => void {
  if (Platform.OS !== "web" || typeof document === "undefined") return () => {};
  const foundScroller = getStickyViewport(anchor) as Element | undefined;
  if (!foundScroller) return () => {};
  const scroller: Element = foundScroller;
  const existing = installations.get(scroller);
  if (existing) {
    existing.count += 1;
    return () => release(scroller);
  }

  let overlay: { bar: Element; label: Element; text: Element } | undefined;
  let frame: number | null = null;
  let stopped = false;

  function createOverlay() {
    const parent = scroller.parentElement;
    if (!parent) return undefined;
    const bar = document.createElement("div");
    bar.setAttribute("data-conversation-sticky-message", "true");
    bar.setAttribute("role", "note");
    Object.assign(bar.style, {
      position: "absolute",
      zIndex: "20",
      boxSizing: "border-box",
      display: "none",
      padding: "10px 16px",
      pointerEvents: "none",
      borderBottom: "1px solid",
      overflow: "hidden",
      fontFamily: "inherit",
      lineHeight: "20px",
    });
    const label = document.createElement("div");
    label.textContent = "当前提问";
    Object.assign(label.style, { fontSize: "11px", lineHeight: "16px", marginBottom: "2px" });
    const text = document.createElement("div");
    Object.assign(text.style, {
      fontSize: "13px",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
      display: "-webkit-box",
      WebkitBoxOrient: "vertical",
      WebkitLineClamp: "2",
      overflow: "hidden",
    });
    bar.appendChild(label);
    bar.appendChild(text);
    parent.appendChild(bar);
    return { bar, label, text };
  }

  function update() {
    frame = null;
    if (stopped) return;
    if (!scroller.isConnected) {
      installations.get(scroller)?.cleanup();
      installations.delete(scroller);
      onDetached?.();
      return;
    }
    overlay ??= createOverlay();
    if (!overlay) return;
    const viewport = scroller.getBoundingClientRect();
    const rows = Array.from(scroller.querySelectorAll(ROW_SELECTOR));
    const first = rows.find((row) => row.getBoundingClientRect().bottom > viewport.top + 1);
    const prompt = first
      ? resolvePrompt(
          first.getAttribute("data-history-row-id") ?? "",
          first.getAttribute("data-message-id"),
        )
      : undefined;
    // A visible native prompt already supplies the context. Pin only after it has left the viewport.
    const promptRow =
      prompt &&
      rows.find(
        (row) =>
          row.getAttribute("data-history-row-id") === prompt.id ||
          row.getAttribute("data-message-id") === prompt.id ||
          prompt.aliases?.includes(row.getAttribute("data-history-row-id") ?? "") ||
          prompt.aliases?.includes(row.getAttribute("data-message-id") ?? ""),
      );
    const promptVisible = promptRow && promptRow.getBoundingClientRect().bottom > viewport.top + 1;
    if (
      !prompt ||
      !prompt.text.trim() ||
      promptVisible ||
      viewport.height <= 0 ||
      viewport.width <= 0
    ) {
      overlay.bar.style.display = "none";
      return;
    }
    const parentRect = scroller.parentElement?.getBoundingClientRect();
    if (!parentRect) return;
    Object.assign(overlay.bar.style, {
      display: "block",
      top: `${viewport.top - parentRect.top}px`,
      left: `${viewport.left - parentRect.left}px`,
      width: `${scroller.clientWidth}px`,
      maxHeight: `${Math.min(82, viewport.height / 3)}px`,
      color: colors.foreground,
      backgroundColor: colors.background,
      borderColor: colors.border,
    });
    overlay.label.style.color = colors.muted;
    if (overlay.text.textContent !== prompt.text) overlay.text.textContent = prompt.text;
  }
  function schedule() {
    if (!stopped && frame === null) frame = window.requestAnimationFrame(update);
  }
  const observer = new MutationObserver(schedule);
  observer.observe(scroller, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });
  const detachObserver = new MutationObserver(() => {
    if (!scroller.isConnected) schedule();
  });
  detachObserver.observe(document.body, { childList: true, subtree: true });
  const resizeObserver = new ResizeObserver(schedule);
  resizeObserver.observe(scroller);
  document.addEventListener("scroll", schedule, true);
  window.addEventListener("resize", schedule);
  const unsubscribe = subscribeChanges?.(schedule);
  schedule();
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    detachObserver.disconnect();
    resizeObserver.disconnect();
    unsubscribe?.();
    document.removeEventListener("scroll", schedule, true);
    window.removeEventListener("resize", schedule);
    if (frame !== null) window.cancelAnimationFrame(frame);
    overlay?.bar.remove();
  };
  installations.set(scroller, { count: 1, cleanup });
  return () => release(scroller);
}

function release(scroller: Element) {
  const installation = installations.get(scroller);
  if (!installation) return;
  installation.count -= 1;
  if (installation.count === 0) {
    installation.cleanup();
    installations.delete(scroller);
  }
}
