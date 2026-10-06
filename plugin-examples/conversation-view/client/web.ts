import { Platform } from "react-native";

// DOM access stays in this web-only module; the plugin's shared TS config has no DOM library.
interface Element {
  parentElement: Element | null;
  textContent: string | null;
  isConnected: boolean;
  clientWidth: number;
  clientHeight: number;
  clientLeft: number;
  clientTop: number;
  scrollTop: number;
  scrollHeight: number;
  firstElementChild: Element | null;
  style: Record<string, string>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  closest(selector: string): Element | null;
  querySelector(selector: string): Element | null;
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
  getComputedStyle(element: Element): Record<string, string>;
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
  getLatestPrompt?: () => StickyPrompt | undefined,
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
  let lastPrompt: StickyPrompt | undefined;
  let lastContentBounds: { left: number; width: number } | undefined;
  const appliedStyles: Record<string, string> = {};

  function nativePrompt(row: Element): StickyPrompt | undefined {
    const text = row.querySelector(
      '[data-testid="user-message"] [data-message-text="true"]',
    )?.textContent;
    const id = row.getAttribute("data-history-row-id");
    return text?.trim() && id ? { id, text } : undefined;
  }

  function resolveRow(row: Element): StickyPrompt | undefined {
    return (
      nativePrompt(row) ??
      resolvePrompt(
        row.getAttribute("data-history-row-id") ?? "",
        row.getAttribute("data-message-id"),
      )
    );
  }

  function readingContext(rows: Element[], viewportTop: number, atBottom: boolean) {
    const firstIndex = rows.findIndex(
      (row) => row.getBoundingClientRect().bottom > viewportTop + 1,
    );
    const index = atBottom || firstIndex < 0 ? rows.length - 1 : firstIndex;
    let prompt = atBottom ? getLatestPrompt?.() : undefined;
    for (let previous = index; !prompt && previous >= 0; previous -= 1) {
      prompt = resolveRow(rows[previous]!);
    }
    // Keep context during a virtualizer's transient empty frame or an async history lookup.
    prompt ??= lastPrompt;
    if (prompt) lastPrompt = prompt;
    return { index, prompt };
  }

  function promptIsVisible(rows: Element[], prompt: StickyPrompt, top: number, bottom: number) {
    const ids = new Set([prompt.id, ...(prompt.aliases ?? [])]);
    const row = rows.find(
      (item) =>
        ids.has(item.getAttribute("data-history-row-id") ?? "") ||
        ids.has(item.getAttribute("data-message-id") ?? ""),
    );
    if (!row) return false;
    const rect = row.getBoundingClientRect();
    const threshold = overlay?.bar.style.display === "block" ? 4 : -4;
    return rect.bottom > top + threshold && rect.top < bottom;
  }

  function contentBounds(row: Element | undefined, viewportLeft: number) {
    const content = row?.firstElementChild;
    if (content) {
      const rect = content.getBoundingClientRect();
      const style = window.getComputedStyle(content);
      const paddingLeft = Number.parseFloat(style.paddingLeft ?? "0") || 0;
      const paddingRight = Number.parseFloat(style.paddingRight ?? "0") || 0;
      if (rect.width > 0)
        lastContentBounds = {
          left: rect.left + paddingLeft,
          width: rect.width - paddingLeft - paddingRight,
        };
    }
    return lastContentBounds ?? { left: viewportLeft + 16, width: scroller.clientWidth - 32 };
  }

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
      border: "1px solid",
      borderRadius: "8px",
      overflow: "hidden",
      fontFamily: "inherit",
      lineHeight: "20px",
    });
    const label = document.createElement("div");
    label.textContent = "当前提问";
    Object.assign(label.style, { fontSize: "11px", lineHeight: "16px", marginBottom: "2px" });
    label.style.color = colors.muted;
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
    const atBottom = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 2;
    const { index: readingIndex, prompt } = readingContext(rows, viewport.top, atBottom);
    if (
      !prompt ||
      !prompt.text.trim() ||
      (!atBottom && promptIsVisible(rows, prompt, viewport.top, viewport.bottom)) ||
      viewport.height <= 0 ||
      viewport.width <= 0
    ) {
      overlay.bar.style.display = "none";
      appliedStyles.display = "none";
      return;
    }
    const parent = scroller.parentElement;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    const bounds = contentBounds(rows[readingIndex], viewport.left);
    const styles = {
      display: "block",
      top: `${viewport.top - parentRect.top - parent.clientTop}px`,
      left: `${bounds.left - parentRect.left - parent.clientLeft}px`,
      width: `${bounds.width}px`,
      maxHeight: `${Math.min(82, viewport.height / 3)}px`,
      color: colors.foreground,
      backgroundColor: colors.background,
      borderColor: colors.border,
    };
    // Avoid writing identical inline styles on every stream/scroll frame.
    for (const [key, value] of Object.entries(styles)) {
      if (appliedStyles[key] !== value) {
        overlay.bar.style[key] = value;
        appliedStyles[key] = value;
      }
    }
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
