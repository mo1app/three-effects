<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import {
  editorModel,
  LAYER_EFFECTS_META,
  setLayerEffectFromDialog,
  type BlurEffectState,
  type DropShadowEffectState,
  type EffectId,
  type InnerGlowEffectState,
  type InnerShadowEffectState,
  type LayerItem,
  type ColorOverlayEffectState,
  type GradientOverlayEffectState,
  type GradientOverlayStop,
  type OuterGlowEffectState,
  type StrokeEffectState,
} from "../layersModel";
import {
  pointerHitsDisabledFormControl,
  pointerHitsReadonlyFieldNum,
  useShake,
} from "../shake";
import AngleDial from "./AngleDial.vue";
import GradientEditorDialog from "./GradientEditorDialog.vue";

const props = defineProps<{
  layer: LayerItem;
}>();

const emit = defineEmits<{
  close: [];
}>();

const selectedEffect = computed({
  get: () => editorModel.value.ui.layerStyleSelectedEffect,
  set: (v: EffectId) => {
    editorModel.value.ui.layerStyleSelectedEffect = v;
  },
});

function dialogEffectEnabled(id: EffectId): boolean {
  return editorModel.value.effects[props.layer.id]?.[id]?.enabled ?? false;
}

const dialogRoot = ref<HTMLElement | null>(null);
const { isShaking, triggerShake } = useShake();

const dragging = ref(false);
let dragStart = { x: 0, y: 0, px: 0, py: 0 };

function onHeaderPointerDown(e: PointerEvent) {
  if ((e.target as HTMLElement).closest("button, input, label")) return;
  dragging.value = true;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  const p = editorModel.value.ui.layerStyleDialog;
  dragStart = {
    x: e.clientX,
    y: e.clientY,
    px: p.x,
    py: p.y,
  };
}

function onHeaderPointerMove(e: PointerEvent) {
  if (!dragging.value) return;
  const p = editorModel.value.ui.layerStyleDialog;
  p.x = dragStart.px + (e.clientX - dragStart.x);
  p.y = dragStart.py + (e.clientY - dragStart.y);
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

function setGradientEditorOpen(open: boolean) {
  editorModel.value.ui.gradientEditorOpen = open;
}

function onEffectCheckboxChange(id: EffectId, ev: Event) {
  const t = ev.target as HTMLInputElement;
  setLayerEffectFromDialog(props.layer.id, id, t.checked);
  selectedEffect.value = id;
  nextTick(() => {
    document.getElementById(`layer-style-panel-${id}`)?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  });
}

/** Reactive stroke row for this layer (undefined until stroke is checked once). */
const strokeState = computed(
  () => editorModel.value.effects[props.layer.id]?.stroke as StrokeEffectState | undefined,
);

function patchStroke(partial: Partial<Pick<StrokeEffectState, "sizePx" | "position" | "opacity" | "color">>) {
  const s = editorModel.value.effects[props.layer.id]?.stroke as StrokeEffectState | undefined;
  if (!s?.initialized) return;
  Object.assign(s, partial);
}

const strokeOpacityPercent = computed({
  get: () => Math.round((strokeState.value?.opacity ?? 1) * 100),
  set: (v: number) => patchStroke({ opacity: Math.min(100, Math.max(0, v)) / 100 }),
});

function onStrokeOpacityInput(e: Event) {
  strokeOpacityPercent.value = Number((e.target as HTMLInputElement).value);
}

const colorOverlayState = computed(
  () => editorModel.value.effects[props.layer.id]?.colorOverlay as ColorOverlayEffectState | undefined,
);

function patchColorOverlay(
  partial: Partial<Pick<ColorOverlayEffectState, "opacity" | "color">>,
) {
  const s = editorModel.value.effects[props.layer.id]?.colorOverlay as ColorOverlayEffectState | undefined;
  if (!s?.initialized) return;
  Object.assign(s, partial);
}

const colorOverlayOpacityPercent = computed({
  get: () => Math.round((colorOverlayState.value?.opacity ?? 1) * 100),
  set: (v: number) => patchColorOverlay({ opacity: Math.min(100, Math.max(0, v)) / 100 }),
});

function onColorOverlayOpacityInput(e: Event) {
  colorOverlayOpacityPercent.value = Number((e.target as HTMLInputElement).value);
}

const dropShadowState = computed(
  () => editorModel.value.effects[props.layer.id]?.dropShadow as DropShadowEffectState | undefined,
);

function patchDropShadow(
  partial: Partial<
    Pick<DropShadowEffectState, "opacity" | "angle" | "distancePx" | "spread" | "sizePx" | "color">
  >,
) {
  const s = editorModel.value.effects[props.layer.id]?.dropShadow as DropShadowEffectState | undefined;
  if (!s?.initialized) return;
  Object.assign(s, partial);
}

const dropShadowOpacityPercent = computed({
  get: () => Math.round((dropShadowState.value?.opacity ?? 0.75) * 100),
  set: (v: number) => patchDropShadow({ opacity: Math.min(100, Math.max(0, v)) / 100 }),
});

function onDropShadowOpacityInput(e: Event) {
  dropShadowOpacityPercent.value = Number((e.target as HTMLInputElement).value);
}

const dropShadowSpreadPercent = computed({
  get: () => Math.round((dropShadowState.value?.spread ?? 0) * 100),
  set: (v: number) => patchDropShadow({ spread: Math.min(100, Math.max(0, v)) / 100 }),
});

function onDropShadowSpreadInput(e: Event) {
  dropShadowSpreadPercent.value = Number((e.target as HTMLInputElement).value);
}

const innerShadowState = computed(
  () => editorModel.value.effects[props.layer.id]?.innerShadow as InnerShadowEffectState | undefined,
);

function patchInnerShadow(
  partial: Partial<
    Pick<InnerShadowEffectState, "color" | "opacity" | "angle" | "distancePx" | "choke" | "sizePx">
  >,
) {
  const s = editorModel.value.effects[props.layer.id]?.innerShadow as InnerShadowEffectState | undefined;
  if (!s?.initialized) return;
  Object.assign(s, partial);
}

const innerShadowOpacityPercent = computed({
  get: () => Math.round((innerShadowState.value?.opacity ?? 0.6) * 100),
  set: (v: number) => patchInnerShadow({ opacity: Math.min(100, Math.max(0, v)) / 100 }),
});

function onInnerShadowOpacityInput(e: Event) {
  innerShadowOpacityPercent.value = Number((e.target as HTMLInputElement).value);
}

const innerShadowChokePercent = computed({
  get: () => Math.round((innerShadowState.value?.choke ?? 0) * 100),
  set: (v: number) => patchInnerShadow({ choke: Math.min(100, Math.max(0, v)) / 100 }),
});

function onInnerShadowChokeInput(e: Event) {
  innerShadowChokePercent.value = Number((e.target as HTMLInputElement).value);
}

const innerGlowState = computed(
  () => editorModel.value.effects[props.layer.id]?.innerGlow as InnerGlowEffectState | undefined,
);

function patchInnerGlow(
  partial: Partial<Pick<InnerGlowEffectState, "color" | "opacity" | "source" | "choke" | "sizePx">>,
) {
  const s = editorModel.value.effects[props.layer.id]?.innerGlow as InnerGlowEffectState | undefined;
  if (!s?.initialized) return;
  Object.assign(s, partial);
}

const innerGlowOpacityPercent = computed({
  get: () => Math.round((innerGlowState.value?.opacity ?? 0.5) * 100),
  set: (v: number) => patchInnerGlow({ opacity: Math.min(100, Math.max(0, v)) / 100 }),
});

function onInnerGlowOpacityInput(e: Event) {
  innerGlowOpacityPercent.value = Number((e.target as HTMLInputElement).value);
}

const innerGlowChokePercent = computed({
  get: () => Math.round((innerGlowState.value?.choke ?? 0) * 100),
  set: (v: number) => patchInnerGlow({ choke: Math.min(100, Math.max(0, v)) / 100 }),
});

function onInnerGlowChokeInput(e: Event) {
  innerGlowChokePercent.value = Number((e.target as HTMLInputElement).value);
}

const outerGlowState = computed(
  () => editorModel.value.effects[props.layer.id]?.outerGlow as OuterGlowEffectState | undefined,
);

function patchOuterGlow(
  partial: Partial<Pick<OuterGlowEffectState, "color" | "opacity" | "spread" | "sizePx">>,
) {
  const s = editorModel.value.effects[props.layer.id]?.outerGlow as OuterGlowEffectState | undefined;
  if (!s?.initialized) return;
  Object.assign(s, partial);
}

const outerGlowOpacityPercent = computed({
  get: () => Math.round((outerGlowState.value?.opacity ?? 0.8) * 100),
  set: (v: number) => patchOuterGlow({ opacity: Math.min(100, Math.max(0, v)) / 100 }),
});

function onOuterGlowOpacityInput(e: Event) {
  outerGlowOpacityPercent.value = Number((e.target as HTMLInputElement).value);
}

const outerGlowSpreadPercent = computed({
  get: () => Math.round((outerGlowState.value?.spread ?? 0) * 100),
  set: (v: number) => patchOuterGlow({ spread: Math.min(100, Math.max(0, v)) / 100 }),
});

function onOuterGlowSpreadInput(e: Event) {
  outerGlowSpreadPercent.value = Number((e.target as HTMLInputElement).value);
}

const gradientOverlayState = computed(
  () => editorModel.value.effects[props.layer.id]?.gradientOverlay as GradientOverlayEffectState | undefined,
);

function patchGradientOverlay(
  partial: Partial<
    Pick<GradientOverlayEffectState, "opacity" | "style" | "angle" | "scale" | "reverse" | "stops">
  >,
) {
  const s = editorModel.value.effects[props.layer.id]?.gradientOverlay as GradientOverlayEffectState | undefined;
  if (!s?.initialized) return;
  Object.assign(s, partial);
}

const gradientOverlayOpacityPercent = computed({
  get: () => Math.round((gradientOverlayState.value?.opacity ?? 0.9) * 100),
  set: (v: number) => patchGradientOverlay({ opacity: Math.min(100, Math.max(0, v)) / 100 }),
});

function onGradientOverlayOpacityInput(e: Event) {
  gradientOverlayOpacityPercent.value = Number((e.target as HTMLInputElement).value);
}

const gradientOverlayScalePercent = computed({
  get: () => Math.round((gradientOverlayState.value?.scale ?? 1) * 100),
  set: (v: number) => patchGradientOverlay({ scale: Math.min(400, Math.max(10, v)) / 100 }),
});

function onGradientOverlayScaleInput(e: Event) {
  gradientOverlayScalePercent.value = Number((e.target as HTMLInputElement).value);
}

const gradientOverlayPreviewCss = computed(() => {
  const st = gradientOverlayState.value?.stops;
  if (!st || st.length === 0) return "linear-gradient(to right, #000, #fff)";
  const s = [...st].sort((a, b) => a.position - b.position);
  return `linear-gradient(to right, ${s.map((x) => `${x.color} ${x.position * 100}%`).join(", ")})`;
});

function onGradientEditorApply(stops: GradientOverlayStop[]) {
  patchGradientOverlay({ stops: stops.map((x) => ({ ...x })) });
}

const blurState = computed(
  () => editorModel.value.effects[props.layer.id]?.blur as BlurEffectState | undefined,
);

function patchBlur(partial: Partial<Pick<BlurEffectState, "sizePx">>) {
  const s = editorModel.value.effects[props.layer.id]?.blur as BlurEffectState | undefined;
  if (!s?.initialized) return;
  Object.assign(s, partial);
}
</script>

<template>
  <div
    ref="dialogRoot"
    class="layer-style-dialog"
    :class="{ 'shake-anim': isShaking }"
    :style="{
      left: `${editorModel.ui.layerStyleDialog.x}px`,
      top: `${editorModel.ui.layerStyleDialog.y}px`,
    }"
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
        <section id="layer-style-panel-stroke" v-show="selectedEffect === 'stroke'" class="effect-panel">
          <h2 class="panel-heading">Stroke</h2>
          <p v-if="!strokeState?.initialized" class="effect-hint">
            Check “Stroke” in the list to enable these options.
          </p>
          <template v-else>
            <div class="field-row">
              <span class="field-label">Size:</span>
              <input
                class="slider"
                type="range"
                min="0"
                max="64"
                step="1"
                :value="strokeState.sizePx"
                @input="patchStroke({ sizePx: +($event.target as HTMLInputElement).value })"
              />
              <input
                class="field-num"
                type="number"
                min="0"
                max="256"
                step="1"
                :value="strokeState.sizePx"
                @input="patchStroke({ sizePx: +($event.target as HTMLInputElement).value })"
              />
              <span class="unit">px</span>
            </div>
            <div class="field-row">
              <span class="field-label">Position:</span>
              <select
                class="field-select wide"
                :value="strokeState.position"
                @change="
                  patchStroke({
                    position: ($event.target as HTMLSelectElement).value as StrokeEffectState['position'],
                  })
                "
              >
                <option value="outside">Outside</option>
                <option value="inside">Inside</option>
                <option value="center">Center</option>
              </select>
            </div>
            <div class="field-row">
              <span class="field-label">Color:</span>
              <input
                type="color"
                class="color-input"
                :value="strokeState.color"
                title="Stroke color"
                @input="patchStroke({ color: ($event.target as HTMLInputElement).value })"
              />
            </div>
            <div class="field-row">
              <span class="field-label">Opacity:</span>
              <input
                class="slider"
                type="range"
                min="0"
                max="100"
                step="1"
                :value="strokeOpacityPercent"
                @input="onStrokeOpacityInput"
              />
              <input
                class="field-num"
                type="text"
                :value="`${strokeOpacityPercent}%`"
                readonly
              />
            </div>
          </template>
        </section>

        <!-- Inner Shadow -->
        <section id="layer-style-panel-innerShadow" v-show="selectedEffect === 'innerShadow'" class="effect-panel">
          <h2 class="panel-heading">Inner Shadow</h2>
          <p v-if="!innerShadowState?.initialized" class="effect-hint">
            Check "Inner Shadow" in the list to enable these options.
          </p>
          <template v-else>
            <div class="field-row">
              <span class="field-label">Color:</span>
              <input
                type="color"
                class="color-input"
                :value="innerShadowState.color"
                title="Inner shadow color"
                @input="patchInnerShadow({ color: ($event.target as HTMLInputElement).value })"
              />
            </div>
            <div class="field-row">
              <span class="field-label">Opacity:</span>
              <input
                class="slider"
                type="range"
                min="0"
                max="100"
                step="1"
                :value="innerShadowOpacityPercent"
                @input="onInnerShadowOpacityInput"
              />
              <input
                class="field-num"
                type="text"
                :value="`${innerShadowOpacityPercent}%`"
                readonly
              />
            </div>
            <div class="field-row angle-row">
              <span class="field-label">Angle:</span>
              <AngleDial
                :model-value="innerShadowState.angle"
                @update:model-value="patchInnerShadow({ angle: $event })"
              />
              <input
                class="field-num narrow"
                type="number"
                min="0"
                max="360"
                step="1"
                :value="innerShadowState.angle"
                @input="patchInnerShadow({ angle: +($event.target as HTMLInputElement).value })"
              />
              <span class="unit">°</span>
            </div>
            <div class="field-row">
              <span class="field-label">Distance:</span>
              <input
                class="slider"
                type="range"
                min="0"
                max="50"
                step="1"
                :value="innerShadowState.distancePx"
                @input="patchInnerShadow({ distancePx: +($event.target as HTMLInputElement).value })"
              />
              <input
                class="field-num"
                type="number"
                min="0"
                max="50"
                step="1"
                :value="innerShadowState.distancePx"
                @input="patchInnerShadow({ distancePx: +($event.target as HTMLInputElement).value })"
              />
              <span class="unit">px</span>
            </div>
            <div class="field-row">
              <span class="field-label">Choke:</span>
              <input
                class="slider"
                type="range"
                min="0"
                max="100"
                step="1"
                :value="innerShadowChokePercent"
                @input="onInnerShadowChokeInput"
              />
              <input
                class="field-num"
                type="text"
                :value="`${innerShadowChokePercent}%`"
                readonly
              />
            </div>
            <div class="field-row">
              <span class="field-label">Size:</span>
              <input
                class="slider"
                type="range"
                min="0"
                max="50"
                step="1"
                :value="innerShadowState.sizePx"
                @input="patchInnerShadow({ sizePx: +($event.target as HTMLInputElement).value })"
              />
              <input
                class="field-num"
                type="number"
                min="0"
                max="50"
                step="1"
                :value="innerShadowState.sizePx"
                @input="patchInnerShadow({ sizePx: +($event.target as HTMLInputElement).value })"
              />
              <span class="unit">px</span>
            </div>
          </template>
        </section>

        <!-- Inner Glow -->
        <section id="layer-style-panel-innerGlow" v-show="selectedEffect === 'innerGlow'" class="effect-panel">
          <h2 class="panel-heading">Inner Glow</h2>
          <p v-if="!innerGlowState?.initialized" class="effect-hint">
            Check "Inner Glow" in the list to enable these options.
          </p>
          <template v-else>
            <div class="field-row">
              <span class="field-label">Color:</span>
              <input
                type="color"
                class="color-input"
                :value="innerGlowState.color"
                title="Inner glow color"
                @input="patchInnerGlow({ color: ($event.target as HTMLInputElement).value })"
              />
            </div>
            <div class="field-row">
              <span class="field-label">Opacity:</span>
              <input
                class="slider"
                type="range"
                min="0"
                max="100"
                step="1"
                :value="innerGlowOpacityPercent"
                @input="onInnerGlowOpacityInput"
              />
              <input
                class="field-num"
                type="text"
                :value="`${innerGlowOpacityPercent}%`"
                readonly
              />
            </div>
            <div class="field-row radio-row">
              <span class="field-label">Source:</span>
              <label>
                <input
                  type="radio"
                  :name="'ig-src-' + layer.id"
                  value="edge"
                  :checked="innerGlowState.source === 'edge'"
                  @change="patchInnerGlow({ source: 'edge' })"
                />
                Edge
              </label>
              <label>
                <input
                  type="radio"
                  :name="'ig-src-' + layer.id"
                  value="center"
                  :checked="innerGlowState.source === 'center'"
                  @change="patchInnerGlow({ source: 'center' })"
                />
                Center
              </label>
            </div>
            <div class="field-row">
              <span class="field-label">Choke:</span>
              <input
                class="slider"
                type="range"
                min="0"
                max="100"
                step="1"
                :value="innerGlowChokePercent"
                @input="onInnerGlowChokeInput"
              />
              <input
                class="field-num"
                type="text"
                :value="`${innerGlowChokePercent}%`"
                readonly
              />
            </div>
            <div class="field-row">
              <span class="field-label">Size:</span>
              <input
                class="slider"
                type="range"
                min="0"
                max="50"
                step="1"
                :value="innerGlowState.sizePx"
                @input="patchInnerGlow({ sizePx: +($event.target as HTMLInputElement).value })"
              />
              <input
                class="field-num"
                type="number"
                min="0"
                max="50"
                step="1"
                :value="innerGlowState.sizePx"
                @input="patchInnerGlow({ sizePx: +($event.target as HTMLInputElement).value })"
              />
              <span class="unit">px</span>
            </div>
          </template>
        </section>

        <!-- Color Overlay -->
        <section id="layer-style-panel-colorOverlay" v-show="selectedEffect === 'colorOverlay'" class="effect-panel">
          <h2 class="panel-heading">Color Overlay</h2>
          <p v-if="!colorOverlayState?.initialized" class="effect-hint">
            Check “Color Overlay” in the list to enable these options.
          </p>
          <template v-else>
            <div class="field-row">
              <span class="field-label">Color:</span>
              <input
                type="color"
                class="color-input"
                :value="colorOverlayState.color"
                title="Overlay color"
                @input="patchColorOverlay({ color: ($event.target as HTMLInputElement).value })"
              />
            </div>
            <div class="field-row">
              <span class="field-label">Opacity:</span>
              <input
                class="slider"
                type="range"
                min="0"
                max="100"
                step="1"
                :value="colorOverlayOpacityPercent"
                @input="onColorOverlayOpacityInput"
              />
              <input
                class="field-num"
                type="text"
                :value="`${colorOverlayOpacityPercent}%`"
                readonly
              />
            </div>
          </template>
        </section>

        <!-- Gradient Overlay -->
        <section id="layer-style-panel-gradientOverlay" v-show="selectedEffect === 'gradientOverlay'" class="effect-panel">
          <h2 class="panel-heading">Gradient Overlay</h2>
          <p v-if="!gradientOverlayState?.initialized" class="effect-hint">
            Check "Gradient Overlay" in the list to enable these options.
          </p>
          <template v-else>
            <div class="field-row block">
              <span class="field-label">Gradient:</span>
              <div class="gradient-preview-bar" :style="{ background: gradientOverlayPreviewCss }" />
              <button type="button" class="small-btn" @click="setGradientEditorOpen(true)">
                Edit Gradient…
              </button>
            </div>
            <div class="field-row">
              <span class="field-label">Opacity:</span>
              <input
                class="slider"
                type="range"
                min="0"
                max="100"
                step="1"
                :value="gradientOverlayOpacityPercent"
                @input="onGradientOverlayOpacityInput"
              />
              <input
                class="field-num"
                type="text"
                :value="`${gradientOverlayOpacityPercent}%`"
                readonly
              />
            </div>
            <div class="field-row">
              <span class="field-label">Style:</span>
              <select
                class="field-select wide"
                :value="gradientOverlayState.style"
                @change="
                  patchGradientOverlay({
                    style: ($event.target as HTMLSelectElement).value as GradientOverlayEffectState['style'],
                  })
                "
              >
                <option value="linear">Linear</option>
                <option value="radial">Radial</option>
              </select>
            </div>
            <div class="field-row angle-row">
              <span class="field-label">Angle:</span>
              <AngleDial
                :model-value="gradientOverlayState.angle"
                @update:model-value="patchGradientOverlay({ angle: $event })"
              />
              <input
                class="field-num narrow"
                type="number"
                min="0"
                max="360"
                step="1"
                :value="gradientOverlayState.angle"
                @input="patchGradientOverlay({ angle: +($event.target as HTMLInputElement).value })"
              />
              <span class="unit">°</span>
            </div>
            <div class="field-row">
              <span class="field-label">Scale:</span>
              <input
                class="slider"
                type="range"
                min="10"
                max="400"
                step="1"
                :value="gradientOverlayScalePercent"
                @input="onGradientOverlayScaleInput"
              />
              <input
                class="field-num"
                type="text"
                :value="`${gradientOverlayScalePercent}%`"
                readonly
              />
            </div>
            <div class="field-row">
              <label class="inline-check full">
                <input
                  type="checkbox"
                  :checked="gradientOverlayState.reverse"
                  @change="
                    patchGradientOverlay({ reverse: ($event.target as HTMLInputElement).checked })
                  "
                />
                Reverse
              </label>
            </div>
          </template>
        </section>

        <!-- Outer Glow -->
        <section id="layer-style-panel-outerGlow" v-show="selectedEffect === 'outerGlow'" class="effect-panel">
          <h2 class="panel-heading">Outer Glow</h2>
          <p v-if="!outerGlowState?.initialized" class="effect-hint">
            Check "Outer Glow" in the list to enable these options.
          </p>
          <template v-else>
            <div class="field-row">
              <span class="field-label">Color:</span>
              <input
                type="color"
                class="color-input"
                :value="outerGlowState.color"
                title="Outer glow color"
                @input="patchOuterGlow({ color: ($event.target as HTMLInputElement).value })"
              />
            </div>
            <div class="field-row">
              <span class="field-label">Opacity:</span>
              <input
                class="slider"
                type="range"
                min="0"
                max="100"
                step="1"
                :value="outerGlowOpacityPercent"
                @input="onOuterGlowOpacityInput"
              />
              <input
                class="field-num"
                type="text"
                :value="`${outerGlowOpacityPercent}%`"
                readonly
              />
            </div>
            <div class="field-row">
              <span class="field-label">Spread:</span>
              <input
                class="slider"
                type="range"
                min="0"
                max="100"
                step="1"
                :value="outerGlowSpreadPercent"
                @input="onOuterGlowSpreadInput"
              />
              <input
                class="field-num"
                type="text"
                :value="`${outerGlowSpreadPercent}%`"
                readonly
              />
            </div>
            <div class="field-row">
              <span class="field-label">Size:</span>
              <input
                class="slider"
                type="range"
                min="0"
                max="50"
                step="1"
                :value="outerGlowState.sizePx"
                @input="patchOuterGlow({ sizePx: +($event.target as HTMLInputElement).value })"
              />
              <input
                class="field-num"
                type="number"
                min="0"
                max="50"
                step="1"
                :value="outerGlowState.sizePx"
                @input="patchOuterGlow({ sizePx: +($event.target as HTMLInputElement).value })"
              />
              <span class="unit">px</span>
            </div>
          </template>
        </section>

        <!-- Drop Shadow -->
        <section id="layer-style-panel-dropShadow" v-show="selectedEffect === 'dropShadow'" class="effect-panel">
          <h2 class="panel-heading">Drop Shadow</h2>
          <p v-if="!dropShadowState?.initialized" class="effect-hint">
            Check "Drop Shadow" in the list to enable these options.
          </p>
          <template v-else>
            <div class="field-row">
              <span class="field-label">Color:</span>
              <input
                type="color"
                class="color-input"
                :value="dropShadowState.color"
                title="Shadow color"
                @input="patchDropShadow({ color: ($event.target as HTMLInputElement).value })"
              />
            </div>
            <div class="field-row">
              <span class="field-label">Opacity:</span>
              <input
                class="slider"
                type="range"
                min="0"
                max="100"
                step="1"
                :value="dropShadowOpacityPercent"
                @input="onDropShadowOpacityInput"
              />
              <input
                class="field-num"
                type="text"
                :value="`${dropShadowOpacityPercent}%`"
                readonly
              />
            </div>
            <div class="field-row angle-row">
              <span class="field-label">Angle:</span>
              <AngleDial
                :model-value="dropShadowState.angle"
                @update:model-value="patchDropShadow({ angle: $event })"
              />
              <input
                class="field-num narrow"
                type="number"
                min="0"
                max="360"
                step="1"
                :value="dropShadowState.angle"
                @input="patchDropShadow({ angle: +($event.target as HTMLInputElement).value })"
              />
              <span class="unit">°</span>
            </div>
            <div class="field-row">
              <span class="field-label">Distance:</span>
              <input
                class="slider"
                type="range"
                min="0"
                max="50"
                step="1"
                :value="dropShadowState.distancePx"
                @input="patchDropShadow({ distancePx: +($event.target as HTMLInputElement).value })"
              />
              <input
                class="field-num"
                type="number"
                min="0"
                max="50"
                step="1"
                :value="dropShadowState.distancePx"
                @input="patchDropShadow({ distancePx: +($event.target as HTMLInputElement).value })"
              />
              <span class="unit">px</span>
            </div>
            <div class="field-row">
              <span class="field-label">Spread:</span>
              <input
                class="slider"
                type="range"
                min="0"
                max="100"
                step="1"
                :value="dropShadowSpreadPercent"
                @input="onDropShadowSpreadInput"
              />
              <input
                class="field-num"
                type="text"
                :value="`${dropShadowSpreadPercent}%`"
                readonly
              />
            </div>
            <div class="field-row">
              <span class="field-label">Size:</span>
              <input
                class="slider"
                type="range"
                min="0"
                max="50"
                step="1"
                :value="dropShadowState.sizePx"
                @input="patchDropShadow({ sizePx: +($event.target as HTMLInputElement).value })"
              />
              <input
                class="field-num"
                type="number"
                min="0"
                max="50"
                step="1"
                :value="dropShadowState.sizePx"
                @input="patchDropShadow({ sizePx: +($event.target as HTMLInputElement).value })"
              />
              <span class="unit">px</span>
            </div>
          </template>
        </section>

        <!-- Blur -->
        <section id="layer-style-panel-blur" v-show="selectedEffect === 'blur'" class="effect-panel">
          <h2 class="panel-heading">Blur</h2>
          <p v-if="!blurState?.initialized" class="effect-hint">
            Check "Blur" in the list to enable these options.
          </p>
          <template v-else>
            <div class="field-row">
              <span class="field-label">Size:</span>
              <input
                class="slider"
                type="range"
                min="0"
                max="50"
                step="1"
                :value="blurState.sizePx"
                @input="patchBlur({ sizePx: +($event.target as HTMLInputElement).value })"
              />
              <input
                class="field-num"
                type="number"
                min="0"
                max="256"
                step="1"
                :value="blurState.sizePx"
                @input="patchBlur({ sizePx: +($event.target as HTMLInputElement).value })"
              />
              <span class="unit">px</span>
            </div>
          </template>
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

  <GradientEditorDialog
    :open="editorModel.ui.gradientEditorOpen"
    :initial-stops="
      gradientOverlayState?.stops ?? [
        { color: '#000000', position: 0 },
        { color: '#ffffff', position: 1 },
      ]
    "
    @apply="onGradientEditorApply"
    @close="setGradientEditorOpen(false)"
  />
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

.effect-hint {
  margin: 0;
  color: #444;
  font-size: 10px;
}

.color-input {
  width: 28px;
  height: 18px;
  padding: 0;
  border: 1px solid #555;
  cursor: pointer;
  vertical-align: middle;
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
}

/* Mock sliders are disabled; keep them inert without blocking real stroke sliders. */
.slider:disabled {
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
  width: 48px;
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

.gradient-preview-bar {
  width: 100%;
  height: 22px;
  border: 1px solid #1a1a1a;
  margin: 4px 0;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.15);
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
