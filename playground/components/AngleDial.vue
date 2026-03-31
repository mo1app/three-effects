<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{
  modelValue: number; // degrees, 0 = right (+X), 90 = up, counter-clockwise
}>();

const emit = defineEmits<{
  "update:modelValue": [value: number];
}>();

const dialEl = ref<HTMLElement | null>(null);
const dragging = ref(false);

/** Convert a pointer position to a Photoshop-convention angle (CCW from +X). */
function angleFromPointer(e: PointerEvent): number {
  const el = dialEl.value;
  if (!el) return props.modelValue;
  const rect = el.getBoundingClientRect();
  const dx = e.clientX - (rect.left + rect.width / 2);
  const dy = -(e.clientY - (rect.top + rect.height / 2)); // flip: screen-Y is down, math-Y is up
  let deg = Math.atan2(dy, dx) * (180 / Math.PI);
  if (deg < 0) deg += 360;
  return Math.round(deg);
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  dragging.value = true;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  emit("update:modelValue", angleFromPointer(e));
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return;
  emit("update:modelValue", angleFromPointer(e));
}

function onPointerUp(e: PointerEvent) {
  if (!dragging.value) return;
  dragging.value = false;
  try {
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
}

function onKeyDown(e: KeyboardEvent) {
  const step = e.shiftKey ? 10 : 1;
  if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
    e.preventDefault();
    emit("update:modelValue", (props.modelValue - step + 360) % 360);
  } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
    e.preventDefault();
    emit("update:modelValue", (props.modelValue + step) % 360);
  }
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -1 : 1;
  emit("update:modelValue", (props.modelValue + delta + 360) % 360);
}

/**
 * CSS `rotate` is clockwise; the Photoshop angle is CCW from +X (right).
 * The hand starts pointing up (12 o'clock), so adding 90° aligns it with
 * 0° = right, then subtracting modelValue rotates CCW.
 */
const handRotation = (modelValue: number) => `rotate(${90 - modelValue}deg)`;
</script>

<template>
  <div
    ref="dialEl"
    class="angle-dial"
    :class="{ dragging }"
    role="slider"
    :aria-valuenow="modelValue"
    aria-valuemin="0"
    aria-valuemax="360"
    aria-label="Angle"
    tabindex="0"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @keydown="onKeyDown"
    @wheel.prevent="onWheel"
  >
    <div class="dial-hand" :style="{ transform: handRotation(modelValue) }">
      <div class="dial-tip" />
    </div>
    <div class="dial-hub" />
  </div>
</template>

<style scoped>
.angle-dial {
  position: relative;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 1px solid #5a5a5a;
  background: radial-gradient(circle at 50% 38%, #e6e6e6 0%, #a8a8a8 100%);
  box-shadow:
    inset 0 1px 2px rgba(255, 255, 255, 0.55),
    inset 0 -1px 2px rgba(0, 0, 0, 0.15);
  cursor: crosshair;
  touch-action: none;
  outline: none;
  box-sizing: border-box;
}

.angle-dial:focus-visible {
  outline: 2px solid #4d90fe;
  outline-offset: 1px;
}

.angle-dial.dragging {
  cursor: crosshair;
}

/* The hand fills the full circle and rotates around the center. */
.dial-hand {
  position: absolute;
  inset: 0;
  transform-origin: 50% 50%;
}

/* The tip is a small dot near the 12 o'clock rim. */
.dial-tip {
  position: absolute;
  width: 5px;
  height: 5px;
  background: #1a1a1a;
  border-radius: 50%;
  top: 3px;
  left: 50%;
  transform: translateX(-50%);
}

/* Center hub pin. */
.dial-hub {
  position: absolute;
  width: 4px;
  height: 4px;
  background: #2a2a2a;
  border-radius: 50%;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
}
</style>
