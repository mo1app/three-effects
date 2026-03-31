import { reactive } from "vue";

export type LayerItem = {
  id: string;
  name: string;
  color: string;
  visible: boolean;
};

export type EffectId =
  | "stroke"
  | "innerShadow"
  | "innerGlow"
  | "colorOverlay"
  | "gradientOverlay"
  | "outerGlow"
  | "dropShadow";

export type LayerEffectState = {
  /** Once true, the effect row appears in the Layers panel (Photoshop-style). */
  initialized: boolean;
  /** Matches Layer Style checkbox and sub-row eye. */
  enabled: boolean;
};

export const LAYER_EFFECTS_META: { id: EffectId; label: string; plus?: boolean }[] = [
  { id: "stroke", label: "Stroke", plus: true },
  { id: "innerShadow", label: "Inner Shadow" },
  { id: "innerGlow", label: "Inner Glow" },
  { id: "colorOverlay", label: "Color Overlay" },
  { id: "gradientOverlay", label: "Gradient Overlay" },
  { id: "outerGlow", label: "Outer Glow" },
  { id: "dropShadow", label: "Drop Shadow" },
];

export type EditorModel = {
  layers: LayerItem[];
  /** Per layer id, per effect id */
  effects: Record<string, Partial<Record<EffectId, LayerEffectState>>>;
};

export const editorModel = reactive<EditorModel>({
  layers: [
    { id: "group", name: "cube", color: "#00aa44", visible: true },
    { id: "groupA", name: "sphere A", color: "#ff6600", visible: true },
    { id: "groupB", name: "sphere B", color: "#ff0066", visible: true },
  ],
  effects: {},
});

export function getLayerEffectState(
  layerId: string,
  effectId: EffectId,
): LayerEffectState | undefined {
  return editorModel.effects[layerId]?.[effectId];
}

/** Layer Style dialog: toggling checkbox always marks the effect as initialized. */
export function setLayerEffectFromDialog(
  layerId: string,
  effectId: EffectId,
  enabled: boolean,
): void {
  if (!editorModel.effects[layerId]) {
    editorModel.effects[layerId] = {};
  }
  editorModel.effects[layerId][effectId] = { initialized: true, enabled };
}

/** Layers panel: eye on sub-row toggles enabled only (keeps row visible). */
export function toggleLayerEffectEye(layerId: string, effectId: EffectId): void {
  const s = editorModel.effects[layerId]?.[effectId];
  if (!s?.initialized) return;
  s.enabled = !s.enabled;
}

export function initializedEffectsForLayer(layerId: string) {
  return LAYER_EFFECTS_META.filter((meta) => {
    const st = editorModel.effects[layerId]?.[meta.id];
    return st?.initialized === true;
  }).map((meta) => {
    const st = editorModel.effects[layerId]![meta.id]!;
    return {
      id: meta.id,
      label: meta.label,
      enabled: st.enabled,
    };
  });
}

/** Dim the Effects folder eye when any initialized effect is off. */
export function effectsGroupEyeIsDim(layerId: string): boolean {
  const list = initializedEffectsForLayer(layerId);
  if (list.length === 0) return true;
  return !list.every((e) => e.enabled);
}

/** Toggle all initialized effects on/off together (folder eye). */
export function toggleEffectsGroupEye(layerId: string): void {
  const list = initializedEffectsForLayer(layerId);
  if (list.length === 0) return;
  const allOn = list.every((e) => e.enabled);
  const next = !allOn;
  for (const e of list) {
    const st = editorModel.effects[layerId]?.[e.id];
    if (st) st.enabled = next;
  }
}
