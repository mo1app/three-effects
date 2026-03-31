<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { sampleSerializedGradient, type SerializedGradientStop } from "three-effects";
import { editorModel } from "../layersModel";

const props = defineProps<{
  open: boolean;
  initialStops: SerializedGradientStop[];
}>();

const emit = defineEmits<{
  close: [];
  apply: [stops: SerializedGradientStop[]];
}>();

const draftStops = ref<SerializedGradientStop[]>([]);
const selectedIndex = ref(0);

const dragging = ref(false);
const draggingDial = ref(false);
let dragStart = { x: 0, y: 0, px: 0, py: 0 };

const barRef = ref<HTMLElement | null>(null);
const dragStopIndex = ref<number | null>(null);

watch(
  () => props.open,
  (o) => {
    if (o) {
      draftStops.value = props.initialStops.map((s) => ({ ...s }));
      if (draftStops.value.length === 0) {
        draftStops.value = [
          { color: "#000000", position: 0 },
          { color: "#ffffff", position: 1 },
        ];
      }
      selectedIndex.value = 0;
    }
  },
);

const sortedForDisplay = computed(() =>
  draftStops.value.map((stop, index) => ({ stop, index })).sort((a, b) => a.stop.position - b.stop.position),
);

const gradientCss = computed(() => {
  const s = [...draftStops.value].sort((a, b) => a.position - b.position);
  if (s.length === 0) return "linear-gradient(to right, #000, #fff)";
  const parts = s.map((st) => `${st.color} ${st.position * 100}%`);
  return `linear-gradient(to right, ${parts.join(", ")})`;
});

function onHeaderPointerDown(e: PointerEvent) {
  if ((e.target as HTMLElement).closest("button")) return;
  draggingDial.value = true;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  const p = editorModel.value.ui.gradientEditor;
  dragStart = { x: e.clientX, y: e.clientY, px: p.x, py: p.y };
}

function onHeaderPointerMove(e: PointerEvent) {
  if (!draggingDial.value) return;
  const p = editorModel.value.ui.gradientEditor;
  p.x = dragStart.px + (e.clientX - dragStart.x);
  p.y = dragStart.py + (e.clientY - dragStart.y);
}

function onHeaderPointerUp(e: PointerEvent) {
  if (!draggingDial.value) return;
  draggingDial.value = false;
  try {
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
}

function getTFromBarEvent(e: PointerEvent): number {
  const el = barRef.value;
  if (!el) return 0;
  const rect = el.getBoundingClientRect();
  const t = (e.clientX - rect.left) / Math.max(1, rect.width);
  return Math.min(1, Math.max(0, t));
}

function onBarPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  if ((e.target as HTMLElement).closest(".grad-marker")) return;
  const t = getTFromBarEvent(e);
  const color = sampleSerializedGradient(draftStops.value, t);
  draftStops.value.push({ color, position: t });
  selectedIndex.value = draftStops.value.length - 1;
}

function onMarkerPointerDown(e: PointerEvent, index: number) {
  e.stopPropagation();
  if (e.button !== 0) return;
  selectedIndex.value = index;
  dragStopIndex.value = index;
  dragging.value = true;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onMarkerPointerMove(e: PointerEvent) {
  if (!dragging.value || dragStopIndex.value === null) return;
  const t = getTFromBarEvent(e);
  const i = dragStopIndex.value;
  if (draftStops.value[i]) draftStops.value[i].position = t;
}

function onMarkerPointerUp(e: PointerEvent) {
  if (!dragging.value) return;
  dragging.value = false;
  dragStopIndex.value = null;
  try {
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
}

function deleteSelected() {
  if (draftStops.value.length <= 2) return;
  const i = selectedIndex.value;
  draftStops.value.splice(i, 1);
  selectedIndex.value = Math.min(selectedIndex.value, draftStops.value.length - 1);
}

function patchSelectedColor(hex: string) {
  const s = draftStops.value[selectedIndex.value];
  if (s) s.color = hex;
}

function apply() {
  emit(
    "apply",
    draftStops.value.map((s) => ({ ...s })),
  );
  emit("close");
}

function cancel() {
  emit("close");
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="gradient-editor-overlay"
      @pointerdown.self="cancel"
    >
      <div
        class="gradient-editor"
        :style="{
          left: `${editorModel.ui.gradientEditor.x}px`,
          top: `${editorModel.ui.gradientEditor.y}px`,
        }"
        @pointerdown.stop
      >
        <header
          class="ge-title-bar"
          @pointerdown="onHeaderPointerDown"
          @pointermove="onHeaderPointerMove"
          @pointerup="onHeaderPointerUp"
          @pointercancel="onHeaderPointerUp"
        >
          <span class="ge-title">Gradient Editor</span>
        </header>
        <div class="ge-body">
          <div
            ref="barRef"
            class="ge-ramp-wrap"
            @pointerdown="onBarPointerDown"
          >
            <div class="ge-ramp" :style="{ background: gradientCss }" />
            <div class="ge-markers">
              <button
                v-for="{ stop, index } in sortedForDisplay"
                :key="index"
                type="button"
                class="grad-marker"
                :class="{ selected: selectedIndex === index }"
                :style="{ left: `${stop.position * 100}%` }"
                title="Drag to move; click bar to add stop"
                @pointerdown="onMarkerPointerDown($event, index)"
                @pointermove="onMarkerPointerMove"
                @pointerup="onMarkerPointerUp"
                @pointercancel="onMarkerPointerUp"
              />
            </div>
          </div>
          <p class="ge-hint">Click the ramp to add a stop. Drag diamonds to move.</p>
          <div class="ge-row">
            <span class="ge-label">Stop color:</span>
            <input
              type="color"
              class="ge-color"
              :value="draftStops[selectedIndex]?.color ?? '#000000'"
              @input="patchSelectedColor(($event.target as HTMLInputElement).value)"
            />
            <button
              type="button"
              class="ge-btn"
              :disabled="draftStops.length <= 2"
              @click="deleteSelected"
            >
              Delete stop
            </button>
          </div>
          <div class="ge-actions">
            <button type="button" class="ge-btn primary" @click="apply">OK</button>
            <button type="button" class="ge-btn" @click="cancel">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.gradient-editor-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(0, 0, 0, 0.25);
  pointer-events: auto;
}

.gradient-editor {
  position: fixed;
  z-index: 51;
  width: 360px;
  font-family: Tahoma, system-ui, sans-serif;
  font-size: 11px;
  color: #1a1a1a;
  background: #c8c8c8;
  border: 1px solid #1a1a1a;
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
  user-select: none;
}

.ge-title-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 10px;
  background: linear-gradient(180deg, #d8d8d8 0%, #b8b8b8 100%);
  border-bottom: 1px solid #6a6a6a;
  cursor: grab;
  touch-action: none;
}

.ge-title-bar:active {
  cursor: grabbing;
}

.ge-title {
  font-weight: 700;
  font-size: 12px;
}

.ge-body {
  padding: 10px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ge-ramp-wrap {
  position: relative;
  height: 36px;
  cursor: crosshair;
}

.ge-ramp {
  height: 24px;
  border: 1px solid #1a1a1a;
  border-radius: 1px;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.2);
}

.ge-markers {
  position: relative;
  height: 12px;
  margin-top: -1px;
}

.grad-marker {
  position: absolute;
  bottom: 0;
  width: 0;
  height: 0;
  padding: 0;
  border: none;
  background: transparent;
  cursor: grab;
  transform: translateX(-50%);
}

.grad-marker::after {
  content: "";
  display: block;
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 8px solid #333;
  margin-left: -6px;
}

.grad-marker.selected::after {
  border-top-color: #0a5;
}

.ge-hint {
  margin: 0;
  font-size: 10px;
  color: #444;
}

.ge-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ge-label {
  flex: 0 0 auto;
}

.ge-color {
  width: 32px;
  height: 22px;
  padding: 0;
  border: 1px solid #555;
  cursor: pointer;
}

.ge-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 4px;
}

.ge-btn {
  font-size: 11px;
  padding: 3px 12px;
  background: #e4e4e4;
  border: 1px solid #5a5a5a;
  cursor: default;
}

.ge-btn.primary {
  font-weight: 600;
}

.ge-btn:disabled {
  opacity: 0.45;
}
</style>
