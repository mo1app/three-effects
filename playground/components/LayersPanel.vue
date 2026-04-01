<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import LayerStyleDialog from "./LayerStyleDialog.vue";
import {
  buildAllGroupsSceneSnapshot,
  editorModel,
  effectsGroupEyeIsDim,
  initializedEffectsForLayer,
  toggleEffectsGroupEye,
  toggleGroupHelpers,
  toggleLayerEffectEye,
  type LayerItem,
  type EffectId,
} from "../layersModel";
import { pointerHitsDisabledFormControl, useShake } from "../shake";

const props = defineProps<{
  layers: LayerItem[];
  toggleLayerVisibility?: (id: string) => void;
}>();

function toggleVisibility(id: string) {
  props.toggleLayerVisibility?.(id);
}

const { isShaking, triggerShake } = useShake();
const panelRoot = ref<HTMLElement | null>(null);

watch(
  () => props.layers,
  (layers) => {
    const ui = editorModel.value.ui;
    if (ui.layersSelectedIndex >= layers.length) {
      ui.layersSelectedIndex = Math.max(0, layers.length - 1);
    }
  },
  { deep: true, immediate: true },
);

function noop() {
  triggerShake();
}

function onPanelPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  const root = panelRoot.value;
  if (!root) return;
  if (pointerHitsDisabledFormControl(root, e.clientX, e.clientY)) {
    triggerShake();
  }
}

function openStyleDialog(layer: LayerItem) {
  const i = props.layers.findIndex((l) => l.id === layer.id);
  if (i >= 0) editorModel.value.ui.layersSelectedIndex = i;
}

function openStyleDialogForSelection() {
  const layer = props.layers[editorModel.value.ui.layersSelectedIndex];
  if (layer) openStyleDialog(layer);
}

function openStyleDialogAtEffect(
  layerIndex: number,
  _layer: LayerItem,
  effectId: EffectId,
) {
  const ui = editorModel.value.ui;
  ui.layersSelectedIndex = layerIndex;
  ui.layerStyleSelectedEffect = effectId;
  ui.gradientEditorOpen = false;
  void nextTick(() => {
    document.getElementById(`layer-style-panel-${effectId}`)?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  });
}

function subEffects(layerId: string) {
  return initializedEffectsForLayer(layerId);
}

function onEffectEye(layerId: string, effectId: EffectId) {
  toggleLayerEffectEye(layerId, effectId);
}

function onEffectsGroupEye(layerId: string) {
  toggleEffectsGroupEye(layerId);
}

const groupsSnapshotCopied = ref(false);
let groupsSnapshotCopyTimer: ReturnType<typeof setTimeout> | null = null;

async function onCopyAllGroupsSnapshot() {
  const snap = buildAllGroupsSceneSnapshot();
  const text = JSON.stringify(snap, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    if (groupsSnapshotCopyTimer) clearTimeout(groupsSnapshotCopyTimer);
    groupsSnapshotCopied.value = true;
    groupsSnapshotCopyTimer = setTimeout(() => {
      groupsSnapshotCopied.value = false;
      groupsSnapshotCopyTimer = null;
    }, 1500);
  } catch {
    triggerShake();
  }
}

const selectedLayer = computed(
  () => props.layers[editorModel.value.ui.layersSelectedIndex] ?? null,
);

function onOpacityEnabledChange(e: Event) {
  const layer = selectedLayer.value;
  if (!layer?.opacity) return;
  layer.opacity.enabled = (e.target as HTMLInputElement).checked;
}

function onOpacityValueInput(e: Event) {
  const layer = selectedLayer.value;
  if (!layer?.opacity) return;
  const raw = parseFloat((e.target as HTMLInputElement).value);
  if (Number.isNaN(raw)) return;
  layer.opacity.value = Math.min(100, Math.max(0, raw)) / 100;
  layer.opacity.enabled = true;
}

const opacityPopoverOpen = ref(false);
const opacityPopoverRoot = ref<HTMLElement | null>(null);
const opacitySliderTriggerRef = ref<HTMLElement | null>(null);
let removeOpacityOutsideListener: (() => void) | null = null;

function unbindOpacityOutsideClose() {
  removeOpacityOutsideListener?.();
  removeOpacityOutsideListener = null;
}

function bindOpacityOutsideClose() {
  unbindOpacityOutsideClose();
  requestAnimationFrame(() => {
    const handler = (e: PointerEvent) => {
      const t = e.target as Node;
      if (opacityPopoverRoot.value?.contains(t) || opacitySliderTriggerRef.value?.contains(t)) return;
      opacityPopoverOpen.value = false;
    };
    document.addEventListener("pointerdown", handler, true);
    removeOpacityOutsideListener = () => document.removeEventListener("pointerdown", handler, true);
  });
}

function toggleOpacitySliderPopover() {
  if (!selectedLayer.value) {
    triggerShake();
    return;
  }
  opacityPopoverOpen.value = !opacityPopoverOpen.value;
  if (opacityPopoverOpen.value) bindOpacityOutsideClose();
  else unbindOpacityOutsideClose();
}

function onOpacitySliderInput(e: Event) {
  const layer = selectedLayer.value;
  if (!layer?.opacity) return;
  const v = Number((e.target as HTMLInputElement).value);
  if (Number.isNaN(v)) return;
  layer.opacity.value = Math.min(100, Math.max(0, v)) / 100;
  layer.opacity.enabled = true;
}

watch(selectedLayer, () => {
  opacityPopoverOpen.value = false;
  unbindOpacityOutsideClose();
});

onUnmounted(() => {
  unbindOpacityOutsideClose();
  if (groupsSnapshotCopyTimer) clearTimeout(groupsSnapshotCopyTimer);
});
</script>

<template>
  <LayerStyleDialog v-if="selectedLayer" :layer="selectedLayer" />
  <div
    ref="panelRoot"
    class="layers-panel"
    :class="{ 'shake-anim': isShaking }"
    @pointerdown.capture="onPanelPointerDown"
  >
    <header class="panel-header">
      <span class="tab-label">Layers</span>
      <span class="header-spacer" />
      <button
        type="button"
        class="helpers-btn"
        :class="{ pressed: editorModel.groupHelpersVisible }"
        :title="editorModel.groupHelpersVisible ? 'Hide group debug helpers' : 'Show group debug helpers'"
        @click="toggleGroupHelpers"
      >
        Helpers
      </button>
    </header>

    <div class="toolbar">
      <select class="blend-select" disabled>
        <option>Normal</option>
        <option>Multiply</option>
        <option>Screen</option>
      </select>
      <div class="opacity-row opacity-row-wrap">
        <label class="opacity-checkbox-label">
          <input
            type="checkbox"
            class="opacity-fx"
            title="Layer opacity on/off"
            :checked="selectedLayer?.opacity.enabled ?? false"
            :disabled="!selectedLayer"
            @change="onOpacityEnabledChange"
          />
        </label>
        <span class="lbl">Opacity:</span>
        <input
          class="num-input opacity-value"
          type="number"
          min="0"
          max="100"
          step="1"
          :value="Math.round((selectedLayer?.opacity.value ?? 1) * 100)"
          :disabled="!selectedLayer || !selectedLayer.opacity.enabled"
          @input="onOpacityValueInput"
        />
        <span class="pct-suffix">%</span>
        <button
          ref="opacitySliderTriggerRef"
          type="button"
          class="arrow-btn"
          title="Opacity slider"
          @click.stop="toggleOpacitySliderPopover"
        >
          ▾
        </button>
        <div
          v-show="opacityPopoverOpen"
          ref="opacityPopoverRoot"
          class="opacity-slider-popover"
          @pointerdown.stop
        >
          <input
            type="range"
            class="opacity-slider-range"
            min="0"
            max="100"
            step="1"
            :value="Math.round((selectedLayer?.opacity.value ?? 1) * 100)"
            :disabled="!selectedLayer"
            @input="onOpacitySliderInput"
          />
        </div>
      </div>
    </div>

    <div class="lock-row">
      <span class="lbl">Lock:</span>
      <button type="button" class="lock-btn" title="Lock transparent pixels" @click="noop">▦</button>
      <button type="button" class="lock-btn" title="Lock image pixels" @click="noop">✎</button>
      <button type="button" class="lock-btn" title="Lock position" @click="noop">✥</button>
      <button type="button" class="lock-btn" title="Lock all" @click="noop">🔒</button>
    </div>

    <div class="fill-row">
      <span class="lbl">Fill:</span>
      <input class="num-input fill-input" type="text" value="100%" readonly @click="noop" />
      <button type="button" class="arrow-btn" title="Slider" @click="noop">▾</button>
    </div>

    <div class="layer-list" role="list">
      <div
        v-for="(layer, i) in props.layers"
        :key="layer.id"
        class="layer-block"
      >
        <button
          type="button"
          class="layer-row"
          :class="{ active: editorModel.ui.layersSelectedIndex === i }"
          role="listitem"
          @click="editorModel.ui.layersSelectedIndex = i"
          @dblclick.stop="openStyleDialog(layer)"
        >
          <span
            class="eye"
            :class="{ dim: !layer.visible }"
            title="Toggle visibility"
            role="button"
            tabindex="0"
            @click.stop="toggleVisibility(layer.id)"
            @keydown.enter.stop.prevent="toggleVisibility(layer.id)"
            @keydown.space.stop.prevent="toggleVisibility(layer.id)"
          >👁</span>
          <span class="thumb" :style="{ backgroundColor: layer.color }" />
          <span class="mask-thumb" title="Layer mask" />
          <span class="layer-name">{{ layer.name }}</span>
        </button>

        <div v-if="subEffects(layer.id).length" class="effects-nest">
          <div class="effects-header-row">
            <span
              class="eye effects-group-eye"
              :class="{ dim: effectsGroupEyeIsDim(layer.id) }"
              title="Toggle all effects visibility"
              role="button"
              tabindex="0"
              @click.stop="onEffectsGroupEye(layer.id)"
              @keydown.enter.stop.prevent="onEffectsGroupEye(layer.id)"
              @keydown.space.stop.prevent="onEffectsGroupEye(layer.id)"
            >👁</span>
            <span class="effects-title">Effects</span>
          </div>
          <div
            v-for="fx in subEffects(layer.id)"
            :key="fx.id"
            class="effect-subrow"
            title="Double-click to open Layer Style"
            @dblclick.stop="openStyleDialogAtEffect(i, layer, fx.id)"
          >
            <span
              class="eye effect-eye"
              :class="{ dim: !fx.enabled }"
              title="Toggle effect visibility"
              role="button"
              tabindex="0"
              @click.stop="onEffectEye(layer.id, fx.id)"
              @keydown.enter.stop.prevent="onEffectEye(layer.id, fx.id)"
              @keydown.space.stop.prevent="onEffectEye(layer.id, fx.id)"
            >👁</span>
            <span class="effect-subrow-name">{{ fx.label }}</span>
          </div>
        </div>
      </div>
    </div>

    <footer class="footer-tools">
      <button type="button" class="ft-btn" title="Link layers" @click="noop">⧉</button>
      <button type="button" class="ft-btn fx" title="Layer style" @click="openStyleDialogForSelection">
        fx
      </button>
      <button type="button" class="ft-btn" title="Add layer mask" @click="noop">▢</button>
      <button type="button" class="ft-btn yin" title="New fill/adjustment" @click="noop">◐</button>
      <button
        type="button"
        class="ft-btn"
        title="Copy all groups: layer visibility, opacity, and every layer's effects (JSON)"
        @click="onCopyAllGroupsSnapshot"
      >{{ groupsSnapshotCopied ? "✓" : "📁" }}</button>
      <button type="button" class="ft-btn" title="New layer" @click="noop">▤</button>
      <button type="button" class="ft-btn" title="Delete" @click="noop">🗑</button>
    </footer>
  </div>
</template>

<style scoped>
.layers-panel {
  position: fixed;
  top: 40px;
  left: 20px;
  z-index: 25;
  width: 240px;
  pointer-events: auto;
  font-family:
    Tahoma,
    system-ui,
    -apple-system,
    Segoe UI,
    sans-serif;
  font-size: 11px;
  color: #1a1a1a;
  background: #b8b8b8;
  border: 1px solid #1a1a1a;
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  user-select: none;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  background: linear-gradient(180deg, #d0d0d0 0%, #b0b0b0 100%);
  border-bottom: 1px solid #6a6a6a;
  cursor: default;
}

.tab-label {
  font-weight: 600;
  font-size: 11px;
}

.header-spacer {
  flex: 1;
}

.icon-btn {
  pointer-events: auto;
  background: transparent;
  border: 1px solid transparent;
  color: inherit;
  cursor: default;
  padding: 2px 4px;
  border-radius: 2px;
}
.icon-btn:hover {
  border-color: #888;
  background: rgba(255, 255, 255, 0.2);
}

.helpers-btn {
  pointer-events: auto;
  flex: 0 0 auto;
  padding: 2px 8px;
  font: inherit;
  font-weight: 600;
  font-size: 10px;
  color: #1a1a1a;
  background: #d8d8d8;
  border: 1px solid #5a5a5a;
  border-radius: 2px;
  cursor: pointer;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
}
.helpers-btn:hover {
  background: #e4e4e4;
}
.helpers-btn.pressed {
  background: #9a9a9a;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.25);
}

.toolbar {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 6px 4px;
  border-bottom: 1px solid #8a8a8a;
}

.blend-select {
  width: 100%;
  font-size: 11px;
  padding: 2px 4px;
  background: #e8e8e8;
  border: 1px solid #5a5a5a;
}

.opacity-row,
.fill-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.opacity-checkbox-label {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  cursor: default;
}

.opacity-row-wrap {
  position: relative;
}

.opacity-slider-popover {
  position: absolute;
  right: 0;
  left: auto;
  top: calc(100% + 2px);
  z-index: 50;
  width: 160px;
  padding: 6px 8px;
  background: #8a8a8a;
  border: 1px solid #3a3a3a;
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
}

.opacity-slider-range {
  width: 100%;
  height: 6px;
  accent-color: #c8d4e0;
  cursor: pointer;
}

.opacity-fx {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  margin: 0;
}

.pct-suffix {
  flex: 0 0 auto;
  font-size: 11px;
  color: #222;
}

.opacity-value {
  flex: 0 1 48px;
}

.lbl {
  flex: 0 0 auto;
  color: #222;
}

.num-input {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  padding: 2px 4px;
  background: #fff;
  border: 1px solid #5a5a5a;
  text-align: right;
}

.fill-row {
  padding: 4px 6px 6px;
  border-bottom: 1px solid #8a8a8a;
}

.fill-input {
  flex: 0 1 56px;
}

.arrow-btn {
  flex: 0 0 18px;
  height: 20px;
  padding: 0;
  font-size: 10px;
  line-height: 1;
  background: #e0e0e0;
  border: 1px solid #5a5a5a;
  cursor: default;
}

.lock-row {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px;
  border-bottom: 1px solid #8a8a8a;
}

.lock-btn {
  width: 22px;
  height: 20px;
  padding: 0;
  font-size: 10px;
  line-height: 18px;
  background: #d4d4d4;
  border: 1px solid #6a6a6a;
  cursor: default;
}

.layer-list {
  max-height: 220px;
  overflow-y: auto;
  background: #a8a8a8;
  border-bottom: 1px solid #6a6a6a;
}

.layer-block {
  border-bottom: 1px solid #6a6a6a;
}

.layer-row {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 3px 4px;
  border: none;
  background: #a8a8a8;
  color: #1a1a1a;
  text-align: left;
  font: inherit;
  cursor: default;
}

.layer-row:hover {
  background: #9c9c9c;
}

.layer-row.active {
  background: #4a4a4a;
  color: #fff;
}

.layer-row.active .eye.dim {
  opacity: 0.45;
}

.effects-nest {
  border-top: 1px solid #949494;
  background: #9a9a9a;
}

.effects-header-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px 3px 28px;
  font-size: 10px;
  font-weight: 600;
  color: #1a1a1a;
  border-bottom: 1px solid #888;
}

.effects-group-eye {
  cursor: pointer;
}

.effects-title {
  flex: 1;
  min-width: 0;
}

.effect-subrow {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px 3px 48px;
  background: #969696;
  font-size: 10px;
  color: #1a1a1a;
  border-top: 1px solid #8a8a8a;
}

.effect-subrow-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.effect-eye {
  cursor: pointer;
}

.eye {
  flex: 0 0 18px;
  text-align: center;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.eye.dim {
  opacity: 0.35;
}

.thumb {
  flex: 0 0 28px;
  height: 22px;
  border: 1px solid #000;
  background: #888;
}

.mask-thumb {
  flex: 0 0 22px;
  height: 22px;
  border: 1px solid #000;
  background: repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 6px 6px;
}

.layer-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-left: 2px;
}

.footer-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2px;
  padding: 4px 4px 6px;
  background: #b0b0b0;
}

.ft-btn {
  flex: 1;
  min-width: 0;
  height: 22px;
  padding: 0 2px;
  font-size: 10px;
  background: #d0d0d0;
  border: 1px solid #5a5a5a;
  cursor: default;
}

.ft-btn.fx {
  font-weight: 700;
  font-size: 9px;
}

.ft-btn.yin {
  font-size: 12px;
}
</style>
