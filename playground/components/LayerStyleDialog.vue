<script setup lang="ts">
import { ref } from "vue";
import {
  editorModel,
  LAYER_EFFECTS_META,
  setLayerEffectFromDialog,
  type EffectId,
  type LayerItem,
} from "../layersModel";
import {
  pointerHitsDisabledFormControl,
  pointerHitsReadonlyFieldNum,
  useShake,
} from "../shake";

const props = defineProps<{
  layer: LayerItem;
}>();

const emit = defineEmits<{
  close: [];
}>();

const selectedEffect = ref<EffectId>("stroke");

function dialogEffectEnabled(id: EffectId): boolean {
  return editorModel.effects[props.layer.id]?.[id]?.enabled ?? false;
}

const dialogRoot = ref<HTMLElement | null>(null);
const { isShaking, triggerShake } = useShake();

const pos = ref({ x: 280, y: 80 });
const dragging = ref(false);
let dragStart = { x: 0, y: 0, px: 0, py: 0 };

function onHeaderPointerDown(e: PointerEvent) {
  if ((e.target as HTMLElement).closest("button, input, label")) return;
  dragging.value = true;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  dragStart = {
    x: e.clientX,
    y: e.clientY,
    px: pos.value.x,
    py: pos.value.y,
  };
}

function onHeaderPointerMove(e: PointerEvent) {
  if (!dragging.value) return;
  pos.value = {
    x: dragStart.px + (e.clientX - dragStart.x),
    y: dragStart.py + (e.clientY - dragStart.y),
  };
}

function onHeaderPointerUp(e: PointerEvent) {
  if (!dragging.value) return;
  dragging.value = false;
  try {
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
}

function noop() {
  triggerShake();
}

function onDialogPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  const root = dialogRoot.value;
  if (!root) return;
  if (
    pointerHitsDisabledFormControl(root, e.clientX, e.clientY) ||
    pointerHitsReadonlyFieldNum(root, e.clientX, e.clientY)
  ) {
    triggerShake();
  }
}

function close() {
  emit("close");
}

function selectEffect(id: EffectId) {
  selectedEffect.value = id;
}

function onEffectCheckboxChange(id: EffectId, ev: Event) {
  const t = ev.target as HTMLInputElement;
  setLayerEffectFromDialog(props.layer.id, id, t.checked);
}
</script>

<template>
  <div
    ref="dialogRoot"
    class="layer-style-dialog"
    :class="{ 'shake-anim': isShaking }"
    :style="{ left: `${pos.x}px`, top: `${pos.y}px` }"
    @pointerdown.capture="onDialogPointerDown"
  >
    <header
      class="dialog-title-bar"
      @pointerdown="onHeaderPointerDown"
      @pointermove="onHeaderPointerMove"
      @pointerup="onHeaderPointerUp"
      @pointercancel="onHeaderPointerUp"
    >
      <span class="title-text">Layer Style</span>
    </header>

    <div class="dialog-body">
      <aside class="effects-column">
        <div class="effects-header">Styles</div>
        <button type="button" class="pseudo-item" @click="noop">Blending Options…</button>
        <div class="effects-divider" />
        <ul class="effects-list" role="list">
          <li
            v-for="fx in LAYER_EFFECTS_META"
            :key="fx.id"
            class="effect-item"
            :class="{ selected: selectedEffect === fx.id }"
            @click="selectEffect(fx.id)"
          >
            <input
              type="checkbox"
              :checked="dialogEffectEnabled(fx.id)"
              @click.stop
              @change="onEffectCheckboxChange(fx.id, $event)"
            />
            <span class="effect-label">{{ fx.label }}</span>
            <span v-if="fx.plus" class="effect-plus">+</span>
          </li>
        </ul>
        <div class="effects-divider" />
        <div class="effects-toolbar">
          <button type="button" class="tb-btn" title="Add" @click="noop">fx</button>
          <button type="button" class="tb-btn" title="Move up" @click="noop">▲</button>
          <button type="button" class="tb-btn" title="Move down" @click="noop">▼</button>
          <button type="button" class="tb-btn" title="Delete" @click="noop">🗑</button>
        </div>
      </aside>

      <main class="options-column">
        <!-- Stroke -->
        <section v-show="selectedEffect === 'stroke'" class="effect-panel">
          <h2 class="panel-heading">Stroke</h2>
          <div class="field-row">
            <span class="field-label">Size:</span>
            <input class="slider" type="range" min="0" max="20" value="3" disabled />
            <input class="field-num" type="text" value="3" readonly />
            <span class="unit">px</span>
          </div>
          <div class="field-row">
            <span class="field-label">Position:</span>
            <select class="field-select wide" disabled @change="noop">
              <option>Outside</option>
              <option>Inside</option>
              <option>Center</option>
            </select>
          </div>
          <div class="field-row">
            <span class="field-label">Blend Mode:</span>
            <select class="field-select" disabled @change="noop">
              <option>Normal</option>
            </select>
            <span class="swatch" style="background: #000" />
          </div>
          <div class="field-row">
            <span class="field-label">Opacity:</span>
            <input class="slider" type="range" min="0" max="100" value="100" disabled />
            <input class="field-num" type="text" value="100%" readonly />
          </div>
          <div class="field-row">
            <span class="field-label">Fill Type:</span>
            <select class="field-select wide" disabled @change="noop">
              <option>Color</option>
              <option>Gradient</option>
              <option>Pattern</option>
            </select>
          </div>
        </section>

        <!-- Inner Shadow -->
        <section v-show="selectedEffect === 'innerShadow'" class="effect-panel">
          <h2 class="panel-heading">Inner Shadow</h2>
          <div class="field-row">
            <span class="field-label">Blend Mode:</span>
            <select class="field-select" disabled @change="noop">
              <option>Multiply</option>
            </select>
            <span class="swatch" style="background: #000" />
          </div>
          <div class="field-row">
            <span class="field-label">Opacity:</span>
            <input class="slider" type="range" min="0" max="100" value="75" disabled />
            <input class="field-num" type="text" value="75%" readonly />
          </div>
          <div class="field-row angle-row">
            <span class="field-label">Angle:</span>
            <div class="angle-dial" aria-hidden="true" />
            <input class="field-num narrow" type="text" value="120°" readonly />
            <label class="inline-check">
              <input type="checkbox" checked disabled />
              Use Global Light
            </label>
          </div>
          <div class="field-row">
            <span class="field-label">Distance:</span>
            <input class="slider" type="range" min="0" max="50" value="5" disabled />
            <input class="field-num" type="text" value="5" readonly />
            <span class="unit">px</span>
          </div>
          <div class="field-row">
            <span class="field-label">Choke:</span>
            <input class="slider" type="range" min="0" max="100" value="0" disabled />
            <input class="field-num" type="text" value="0%" readonly />
          </div>
          <div class="field-row">
            <span class="field-label">Size:</span>
            <input class="slider" type="range" min="0" max="50" value="5" disabled />
            <input class="field-num" type="text" value="5" readonly />
            <span class="unit">px</span>
          </div>
          <div class="field-row">
            <span class="field-label">Contour:</span>
            <span class="contour-thumb" />
            <label class="inline-check">
              <input type="checkbox" disabled />
              Anti-aliased
            </label>
          </div>
          <div class="field-row">
            <span class="field-label">Noise:</span>
            <input class="slider" type="range" min="0" max="100" value="0" disabled />
            <input class="field-num" type="text" value="0%" readonly />
          </div>
        </section>

        <!-- Inner Glow -->
        <section v-show="selectedEffect === 'innerGlow'" class="effect-panel">
          <h2 class="panel-heading">Inner Glow</h2>
          <div class="field-row">
            <span class="field-label">Blend Mode:</span>
            <select class="field-select" disabled @change="noop">
              <option>Screen</option>
            </select>
            <span class="swatch" style="background: #ffffff" />
          </div>
          <div class="field-row">
            <span class="field-label">Opacity:</span>
            <input class="slider" type="range" min="0" max="100" value="75" disabled />
            <input class="field-num" type="text" value="75%" readonly />
          </div>
          <div class="field-row">
            <span class="field-label">Noise:</span>
            <input class="slider" type="range" min="0" max="100" value="0" disabled />
            <input class="field-num" type="text" value="0%" readonly />
          </div>
          <div class="field-row radio-row">
            <label><input type="radio" name="ig-src" checked disabled /> Color</label>
            <label><input type="radio" name="ig-src" disabled /> Gradient</label>
          </div>
          <div class="field-row">
            <span class="field-label">Technique:</span>
            <select class="field-select wide" disabled @change="noop">
              <option>Softer</option>
              <option>Precise</option>
            </select>
          </div>
          <div class="field-row radio-row">
            <span class="field-label">Source:</span>
            <label><input type="radio" name="ig-edge" checked disabled /> Edge</label>
            <label><input type="radio" name="ig-edge" disabled /> Center</label>
          </div>
          <div class="field-row">
            <span class="field-label">Choke:</span>
            <input class="slider" type="range" min="0" max="100" value="0" disabled />
            <input class="field-num" type="text" value="0%" readonly />
          </div>
          <div class="field-row">
            <span class="field-label">Size:</span>
            <input class="slider" type="range" min="0" max="50" value="5" disabled />
            <input class="field-num" type="text" value="5" readonly />
            <span class="unit">px</span>
          </div>
          <div class="field-row">
            <span class="field-label">Contour:</span>
            <span class="contour-thumb" />
            <label class="inline-check">
              <input type="checkbox" disabled />
              Anti-aliased
            </label>
          </div>
          <div class="field-row">
            <span class="field-label">Range:</span>
            <input class="slider" type="range" min="0" max="100" value="50" disabled />
            <input class="field-num" type="text" value="50%" readonly />
          </div>
          <div class="field-row">
            <span class="field-label">Jitter:</span>
            <input class="slider" type="range" min="0" max="100" value="0" disabled />
            <input class="field-num" type="text" value="0%" readonly />
          </div>
        </section>

        <!-- Color Overlay -->
        <section v-show="selectedEffect === 'colorOverlay'" class="effect-panel">
          <h2 class="panel-heading">Color Overlay</h2>
          <div class="field-row">
            <span class="field-label">Blend Mode:</span>
            <select class="field-select" disabled @change="noop">
              <option>Normal</option>
            </select>
            <span class="swatch" :style="{ background: props.layer.color }" />
          </div>
          <div class="field-row">
            <span class="field-label">Opacity:</span>
            <input class="slider" type="range" min="0" max="100" value="100" disabled />
            <input class="field-num" type="text" value="100%" readonly />
          </div>
        </section>

        <!-- Gradient Overlay -->
        <section v-show="selectedEffect === 'gradientOverlay'" class="effect-panel">
          <h2 class="panel-heading">Gradient Overlay</h2>
          <div class="field-row">
            <span class="field-label">Blend Mode:</span>
            <select class="field-select" disabled @change="noop">
              <option>Normal</option>
            </select>
            <span class="swatch gradient-swatch" />
          </div>
          <div class="field-row">
            <span class="field-label">Dither:</span>
            <label class="inline-check">
              <input type="checkbox" disabled />
            </label>
          </div>
          <div class="field-row">
            <span class="field-label">Opacity:</span>
            <input class="slider" type="range" min="0" max="100" value="100" disabled />
            <input class="field-num" type="text" value="100%" readonly />
          </div>
          <div class="field-row block">
            <span class="field-label">Gradient:</span>
            <div class="gradient-bar" />
          </div>
          <div class="field-row">
            <label class="inline-check">
              <input type="checkbox" disabled />
              Reverse
            </label>
          </div>
          <div class="field-row">
            <span class="field-label">Style:</span>
            <select class="field-select wide" disabled @change="noop">
              <option>Linear</option>
              <option>Radial</option>
              <option>Angle</option>
              <option>Reflected</option>
              <option>Diamond</option>
            </select>
          </div>
          <div class="field-row">
            <label class="inline-check">
              <input type="checkbox" checked disabled />
              Align with Layer
            </label>
          </div>
          <div class="field-row angle-row">
            <span class="field-label">Angle:</span>
            <div class="angle-dial" aria-hidden="true" />
            <input class="field-num narrow" type="text" value="90°" readonly />
          </div>
          <div class="field-row">
            <span class="field-label">Scale:</span>
            <input class="slider" type="range" min="0" max="200" value="100" disabled />
            <input class="field-num" type="text" value="100%" readonly />
          </div>
          <div class="field-row footer-btns">
            <button type="button" class="small-btn" @click="noop">Reset Alignment</button>
          </div>
          <div class="field-row footer-btns">
            <button type="button" class="small-btn" @click="noop">Make Default</button>
            <button type="button" class="small-btn" @click="noop">Reset to Default</button>
          </div>
        </section>

        <!-- Outer Glow -->
        <section v-show="selectedEffect === 'outerGlow'" class="effect-panel">
          <h2 class="panel-heading">Outer Glow</h2>
          <div class="field-row">
            <span class="field-label">Blend Mode:</span>
            <select class="field-select" disabled @change="noop">
              <option>Screen</option>
            </select>
            <span class="swatch" style="background: #ffffcc" />
          </div>
          <div class="field-row">
            <span class="field-label">Opacity:</span>
            <input class="slider" type="range" min="0" max="100" value="75" disabled />
            <input class="field-num" type="text" value="75%" readonly />
          </div>
          <div class="field-row">
            <span class="field-label">Noise:</span>
            <input class="slider" type="range" min="0" max="100" value="0" disabled />
            <input class="field-num" type="text" value="0%" readonly />
          </div>
          <div class="field-row radio-row">
            <label><input type="radio" name="og-fill" checked disabled /> Color</label>
            <label><input type="radio" name="og-fill" disabled /> Gradient</label>
          </div>
          <div class="field-row">
            <span class="field-label">Technique:</span>
            <select class="field-select wide" disabled @change="noop">
              <option>Softer</option>
              <option>Precise</option>
            </select>
          </div>
          <div class="field-row">
            <span class="field-label">Spread:</span>
            <input class="slider" type="range" min="0" max="100" value="0" disabled />
            <input class="field-num" type="text" value="0%" readonly />
          </div>
          <div class="field-row">
            <span class="field-label">Size:</span>
            <input class="slider" type="range" min="0" max="50" value="5" disabled />
            <input class="field-num" type="text" value="5" readonly />
            <span class="unit">px</span>
          </div>
          <div class="field-row">
            <span class="field-label">Contour:</span>
            <span class="contour-thumb" />
            <label class="inline-check">
              <input type="checkbox" disabled />
              Anti-aliased
            </label>
          </div>
          <div class="field-row">
            <span class="field-label">Range:</span>
            <input class="slider" type="range" min="0" max="100" value="50" disabled />
            <input class="field-num" type="text" value="50%" readonly />
          </div>
          <div class="field-row">
            <span class="field-label">Jitter:</span>
            <input class="slider" type="range" min="0" max="100" value="0" disabled />
            <input class="field-num" type="text" value="0%" readonly />
          </div>
        </section>

        <!-- Drop Shadow -->
        <section v-show="selectedEffect === 'dropShadow'" class="effect-panel">
          <h2 class="panel-heading">Drop Shadow</h2>
          <div class="field-row">
            <span class="field-label">Blend Mode:</span>
            <select class="field-select" disabled @change="noop">
              <option>Multiply</option>
            </select>
            <span class="swatch" style="background: #000" />
          </div>
          <div class="field-row">
            <span class="field-label">Opacity:</span>
            <input class="slider" type="range" min="0" max="100" value="75" disabled />
            <input class="field-num" type="text" value="75%" readonly />
          </div>
          <div class="field-row angle-row">
            <span class="field-label">Angle:</span>
            <div class="angle-dial" aria-hidden="true" />
            <input class="field-num narrow" type="text" value="120°" readonly />
            <label class="inline-check">
              <input type="checkbox" checked disabled />
              Use Global Light
            </label>
          </div>
          <div class="field-row">
            <span class="field-label">Distance:</span>
            <input class="slider" type="range" min="0" max="50" value="5" disabled />
            <input class="field-num" type="text" value="5" readonly />
            <span class="unit">px</span>
          </div>
          <div class="field-row">
            <span class="field-label">Spread:</span>
            <input class="slider" type="range" min="0" max="100" value="0" disabled />
            <input class="field-num" type="text" value="0%" readonly />
          </div>
          <div class="field-row">
            <span class="field-label">Size:</span>
            <input class="slider" type="range" min="0" max="50" value="5" disabled />
            <input class="field-num" type="text" value="5" readonly />
            <span class="unit">px</span>
          </div>
          <div class="field-row">
            <span class="field-label">Contour:</span>
            <span class="contour-thumb" />
            <label class="inline-check">
              <input type="checkbox" disabled />
              Anti-aliased
            </label>
          </div>
          <div class="field-row">
            <span class="field-label">Noise:</span>
            <input class="slider" type="range" min="0" max="100" value="0" disabled />
            <input class="field-num" type="text" value="0%" readonly />
          </div>
          <div class="field-row">
            <label class="inline-check full">
              <input type="checkbox" disabled />
              Layer Knocks Out Drop Shadow
            </label>
          </div>
        </section>
      </main>

      <aside class="actions-sidebar">
        <button type="button" class="action-btn primary" @click="close">OK</button>
        <button type="button" class="action-btn" @click="close">Cancel</button>
        <button type="button" class="action-btn" @click="noop">New Style…</button>
        <label class="preview-check">
          <input type="checkbox" checked disabled />
          Preview
        </label>
        <div class="preview-thumb" title="Preview" />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.layer-style-dialog {
  position: fixed;
  z-index: 20;
  width: 560px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  pointer-events: auto;
  font-family:
    Tahoma,
    system-ui,
    -apple-system,
    Segoe UI,
    sans-serif;
  font-size: 11px;
  color: #1a1a1a;
  background: #c8c8c8;
  border: 1px solid #1a1a1a;
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
  user-select: none;
}

.dialog-title-bar {
  flex: 0 0 auto;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  background: linear-gradient(180deg, #d8d8d8 0%, #b8b8b8 100%);
  border-bottom: 1px solid #6a6a6a;
  cursor: grab;
  touch-action: none;
  min-width: 0;
}

.dialog-title-bar:active {
  cursor: grabbing;
}

.dialog-body {
  display: flex;
  flex-direction: row;
  flex: 1;
  align-items: stretch;
  min-height: 320px;
  max-height: 420px;
  min-width: 0;
}

.title-text {
  font-weight: 700;
  font-size: 12px;
}

.actions-sidebar {
  flex: 0 0 100px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  background: #b8b8b8;
  border-left: 1px solid #8a8a8a;
  box-sizing: border-box;
}

.action-btn {
  font-size: 11px;
  padding: 3px 8px;
  background: #e4e4e4;
  border: 1px solid #5a5a5a;
  cursor: default;
}

.action-btn.primary {
  font-weight: 600;
}

.preview-check {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  margin-top: 4px;
}

.preview-thumb {
  width: 56px;
  height: 56px;
  margin-top: auto;
  align-self: center;
  border: 1px solid #000;
  background: repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50% / 8px 8px;
  box-shadow: inset 0 0 0 1px #888;
}

.effects-column {
  flex: 0 0 160px;
  display: flex;
  flex-direction: column;
  background: #b0b0b0;
  border-right: 1px solid #5a5a5a;
}

.effects-header {
  padding: 4px 6px;
  font-weight: 600;
  font-size: 10px;
  color: #333;
  border-bottom: 1px solid #8a8a8a;
}

.pseudo-item {
  text-align: left;
  padding: 4px 8px;
  font-size: 11px;
  background: transparent;
  border: none;
  cursor: default;
  color: #1a1a1a;
}

.pseudo-item:hover {
  background: rgba(255, 255, 255, 0.15);
}

.effects-divider {
  height: 1px;
  background: #6a6a6a;
  margin: 2px 0;
}

.effects-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  flex: 1;
}

.effect-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  font-size: 11px;
  cursor: default;
  border-bottom: 1px solid #9a9a9a;
}

.effect-item:hover {
  background: rgba(255, 255, 255, 0.12);
}

.effect-item.selected {
  background: #a8c8e8;
}

.effect-label {
  flex: 1;
  min-width: 0;
}

.effect-plus {
  opacity: 0.6;
  font-size: 10px;
}

.effects-toolbar {
  display: flex;
  gap: 2px;
  padding: 4px;
  border-top: 1px solid #8a8a8a;
  background: #a8a8a8;
}

.tb-btn {
  flex: 1;
  height: 22px;
  font-size: 9px;
  background: #d0d0d0;
  border: 1px solid #5a5a5a;
  cursor: default;
}

.options-column {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  overflow-y: auto;
  background: #d0d0d0;
}

.effect-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.panel-heading {
  margin: 0 0 4px;
  font-size: 12px;
  font-weight: 700;
  border-bottom: 1px solid #8a8a8a;
  padding-bottom: 4px;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.field-row.block {
  flex-direction: column;
  align-items: stretch;
}

.field-label {
  flex: 0 0 88px;
  text-align: right;
  color: #222;
}

.field-row.block .field-label {
  text-align: left;
}

.slider {
  flex: 1;
  min-width: 60px;
  height: 4px;
  opacity: 0.85;
  pointer-events: none;
}

.field-num {
  width: 44px;
  font-size: 11px;
  padding: 2px 4px;
  border: 1px solid #5a5a5a;
  background: #fff;
  text-align: right;
}

.field-num.narrow {
  width: 40px;
}

.field-select {
  flex: 1;
  min-width: 80px;
  max-width: 140px;
  font-size: 11px;
  padding: 2px 4px;
  border: 1px solid #5a5a5a;
  background: #f0f0f0;
}

.field-select.wide {
  max-width: 200px;
}

.unit {
  flex: 0 0 auto;
  color: #444;
  font-size: 10px;
}

.swatch {
  width: 22px;
  height: 18px;
  border: 1px solid #000;
  flex-shrink: 0;
}

.gradient-swatch {
  background: linear-gradient(90deg, #f00, #0f0);
}

.gradient-bar {
  height: 18px;
  border: 1px solid #000;
  background: linear-gradient(90deg, #e02020, #20c020);
  margin-top: 2px;
}

.angle-row {
  align-items: center;
}

.angle-dial {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid #5a5a5a;
  background:
    conic-gradient(from 0deg, #ddd 0deg, #bbb 360deg),
    radial-gradient(circle at 50% 35%, #fff 0%, transparent 45%);
  box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.6);
}

.contour-thumb {
  width: 36px;
  height: 18px;
  border: 1px solid #000;
  background: linear-gradient(90deg, #333 0%, #999 50%, #333 100%);
}

.inline-check {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  white-space: nowrap;
}

.inline-check.full {
  flex: 1 1 100%;
  margin-left: 94px;
}

.radio-row {
  gap: 12px;
  margin-left: 94px;
}

.radio-row .field-label ~ label {
  margin: 0;
}

.footer-btns {
  gap: 8px;
  margin-top: 4px;
}

.small-btn {
  font-size: 10px;
  padding: 2px 8px;
  background: #e0e0e0;
  border: 1px solid #5a5a5a;
  cursor: default;
}
</style>
