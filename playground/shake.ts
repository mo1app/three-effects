import { nextTick, onUnmounted, ref } from "vue";

const SHAKE_MS = 450;
/** Outline / glow on `.playground-interactive` after shake ends. */
const POST_SHAKE_HINT_MS = 1400;

export function useShake() {
  const isShaking = ref(false);
  const isInteractiveHint = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let hintTimer: ReturnType<typeof setTimeout> | null = null;

  function triggerShake() {
    if (timer) clearTimeout(timer);
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = null;
    isShaking.value = false;
    isInteractiveHint.value = false;
    nextTick(() => {
      isShaking.value = true;
      timer = setTimeout(() => {
        isShaking.value = false;
        timer = null;
        isInteractiveHint.value = true;
        hintTimer = setTimeout(() => {
          isInteractiveHint.value = false;
          hintTimer = null;
        }, POST_SHAKE_HINT_MS);
      }, SHAKE_MS);
    });
  }

  onUnmounted(() => {
    if (timer) clearTimeout(timer);
    if (hintTimer) clearTimeout(hintTimer);
  });

  return { isShaking, isInteractiveHint, triggerShake };
}

/**
 * Disabled / inert form controls (events often don’t target `disabled`; use hit-test).
 */
export function pointerHitsDisabledFormControl(
  root: HTMLElement,
  clientX: number,
  clientY: number,
): boolean {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const raw of stack) {
    if (!(raw instanceof HTMLElement)) continue;
    if (!root.contains(raw)) break;
    if (
      raw.matches("input[disabled], select[disabled], textarea[disabled], button[disabled]")
    ) {
      return true;
    }
    if (raw.tagName === "LABEL") {
      const d = raw.querySelector("input[disabled], select[disabled]");
      if (d) return true;
    }
  }
  return false;
}

/** Readonly dummy value fields in Layer Style (no per-input @click handlers). */
export function pointerHitsReadonlyFieldNum(
  root: HTMLElement,
  clientX: number,
  clientY: number,
): boolean {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const raw of stack) {
    if (!(raw instanceof HTMLElement)) continue;
    if (!root.contains(raw)) break;
    if (raw.matches("input.field-num[readonly]")) return true;
  }
  return false;
}
