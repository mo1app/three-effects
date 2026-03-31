import { reactive } from "vue";

/** Toolbar layer opacity; maps to {@link GroupEffects.opacity}. */
export type LayerOpacityState = {
  enabled: boolean;
  /** 0–1 */
  value: number;
};

export type LayerItem = {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  opacity: LayerOpacityState;
};

export type EffectId =
  | "stroke"
  | "innerShadow"
  | "innerGlow"
  | "colorOverlay"
  | "gradientOverlay"
  | "outerGlow"
  | "dropShadow"
  | "blur";

/** Base checkbox + visibility for non-parameterized effects. */
export type LayerEffectState = {
  /** Once true, the effect row appears in the Layers panel (Photoshop-style). */
  initialized: boolean;
  /** Matches Layer Style checkbox and sub-row eye. */
  enabled: boolean;
};

/** Stroke row: drives {@link layerStyles} `.stroke()` in the playground. */
export type StrokeEffectState = LayerEffectState & {
  sizePx: number;
  position: "outside" | "inside" | "center";
  /** 0–1 */
  opacity: number;
  /** `#rrggbb` */
  color: string;
};

/** Color Overlay row: drives {@link layerStyles} `.colorOverlay()` in the playground. */
export type ColorOverlayEffectState = LayerEffectState & {
  /** 0–1 */
  opacity: number;
  /** `#rrggbb` */
  color: string;
};

/** Drop Shadow row: drives {@link layerStyles} `.dropShadow()` in the playground. */
export type DropShadowEffectState = LayerEffectState & {
  /** 0–1 */
  opacity: number;
  /** Lighting angle in degrees (shadow falls opposite). 0–360. */
  angle: number;
  /** Shadow offset in screen pixels (converted to UV at sync time). */
  distancePx: number;
  /** Matte expansion before blur, 0–1 (dialog shows 0–100%). */
  spread: number;
  /** Blur size in screen pixels (converted to blurRadius at sync time). */
  sizePx: number;
  /** `#rrggbb` */
  color: string;
};

/** Inner Shadow row: drives {@link layerStyles} `.innerShadow()` in the playground. */
export type InnerShadowEffectState = LayerEffectState & {
  /** `#rrggbb` */
  color: string;
  /** 0–1 */
  opacity: number;
  /** Light direction in degrees. */
  angle: number;
  /** Offset in screen pixels (converted to UV at sync time). */
  distancePx: number;
  /** Matte shrink before blur, 0–1 (dialog shows 0–100%). */
  choke: number;
  /** Blur size in screen pixels. */
  sizePx: number;
};

/** Inner Glow row: drives {@link layerStyles} `.innerGlow()` in the playground. */
export type InnerGlowEffectState = LayerEffectState & {
  /** `#rrggbb` */
  color: string;
  /** 0–1 */
  opacity: number;
  source: "edge" | "center";
  /** Inner matte shrink, 0–1 (dialog shows 0–100%). */
  choke: number;
  /** Blur size in screen pixels. */
  sizePx: number;
};

/** Outer Glow row: drives {@link layerStyles} `.outerGlow()` in the playground. */
export type OuterGlowEffectState = LayerEffectState & {
  /** `#rrggbb` */
  color: string;
  /** 0–1 */
  opacity: number;
  /** Matte expansion before blur, 0–1 (dialog shows 0–100%). */
  spread: number;
  /** Blur size in screen pixels. */
  sizePx: number;
};

/** Blur row: drives {@link GroupEffects.blur} (two-pass full-stack blur). */
export type BlurEffectState = LayerEffectState & {
  /** Blur radius in screen pixels. */
  sizePx: number;
};

/** One color stop in the gradient ramp (`#rrggbb` + 0…1 position). */
export type GradientOverlayStop = {
  color: string;
  position: number;
};

/** Gradient Overlay row: drives {@link layerStyles} `.gradientOverlay()` in the playground. */
export type GradientOverlayEffectState = LayerEffectState & {
  /** 0–1 */
  opacity: number;
  style: "linear" | "radial";
  /** Degrees; linear axis rotation. */
  angle: number;
  /** Repeat scale (1 = default). */
  scale: number;
  reverse: boolean;
  /** At least two stops recommended; editor enforces minimum two. */
  stops: GradientOverlayStop[];
};

export function defaultStrokeEffect(enabled: boolean): StrokeEffectState {
  return {
    initialized: true,
    enabled,
    /** Default ~5–15 px reads well with playground `STROKE_PX_TO_UV`. */
    sizePx: 12,
    position: "outside",
    opacity: 1,
    color: "#000000",
  };
}

export const LAYER_EFFECTS_META: { id: EffectId; label: string; plus?: boolean }[] = [
  { id: "stroke", label: "Stroke", plus: true },
  { id: "innerShadow", label: "Inner Shadow" },
  { id: "innerGlow", label: "Inner Glow" },
  { id: "colorOverlay", label: "Color Overlay" },
  { id: "gradientOverlay", label: "Gradient Overlay" },
  { id: "outerGlow", label: "Outer Glow" },
  { id: "dropShadow", label: "Drop Shadow" },
  { id: "blur", label: "Blur" },
];

/** Per-effect state; parameterized effects use dedicated types. */
export type EditorModel = {
  layers: LayerItem[];
  effects: Record<
    string,
    Partial<
      Record<
        EffectId,
        | LayerEffectState
        | StrokeEffectState
        | ColorOverlayEffectState
        | DropShadowEffectState
        | InnerShadowEffectState
        | InnerGlowEffectState
        | OuterGlowEffectState
        | GradientOverlayEffectState
        | BlurEffectState
      >
    >
  >;
};

const defaultLayerOpacity = (): LayerOpacityState => ({
  enabled: true,
  value: 1,
});

export const editorModel = reactive<EditorModel>({
  layers: [
    {
      id: "group",
      name: "cube",
      color: "#00aa44",
      visible: true,
      opacity: defaultLayerOpacity(),
    },
    {
      id: "groupA",
      name: "sphere A",
      color: "#ff6600",
      visible: true,
      opacity: defaultLayerOpacity(),
    },
    {
      id: "groupB",
      name: "sphere B",
      color: "#ff0066",
      visible: true,
      opacity: defaultLayerOpacity(),
    },
  ],
  effects: {},
});

export function getLayerEffectState(
  layerId: string,
  effectId: EffectId,
):
  | LayerEffectState
  | StrokeEffectState
  | ColorOverlayEffectState
  | DropShadowEffectState
  | InnerShadowEffectState
  | InnerGlowEffectState
  | OuterGlowEffectState
  | GradientOverlayEffectState
  | BlurEffectState
  | undefined {
  return editorModel.effects[layerId]?.[effectId];
}

/** Returns drop shadow state when the effect row exists and is initialized. */
export function getDropShadowState(layerId: string): DropShadowEffectState | undefined {
  const s = editorModel.effects[layerId]?.dropShadow;
  if (!s || !("distancePx" in s) || !s.initialized) return undefined;
  return s as DropShadowEffectState;
}

/** Returns stroke state when the stroke effect row exists and is initialized. */
export function getStrokeState(layerId: string): StrokeEffectState | undefined {
  const s = editorModel.effects[layerId]?.stroke;
  if (!s || !("sizePx" in s) || !s.initialized) return undefined;
  return s as StrokeEffectState;
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
  if (effectId === "stroke") {
    const prev = editorModel.effects[layerId].stroke as StrokeEffectState | undefined;
    editorModel.effects[layerId].stroke = {
      initialized: true,
      enabled,
      sizePx: prev?.sizePx ?? 12,
      position: prev?.position ?? "outside",
      opacity: prev?.opacity ?? 1,
      color: prev?.color ?? "#000000",
    };
  } else if (effectId === "colorOverlay") {
    const prev = editorModel.effects[layerId].colorOverlay as ColorOverlayEffectState | undefined;
    editorModel.effects[layerId].colorOverlay = {
      initialized: true,
      enabled,
      opacity: prev?.opacity ?? 0.35,
      color: prev?.color ?? "#ff0000",
    };
  } else if (effectId === "dropShadow") {
    const prev = editorModel.effects[layerId].dropShadow as DropShadowEffectState | undefined;
    editorModel.effects[layerId].dropShadow = {
      initialized: true,
      enabled,
      opacity: prev?.opacity ?? 0.75,
      angle: prev?.angle ?? 120,
      distancePx: prev?.distancePx ?? 5,
      spread: prev?.spread ?? 0,
      sizePx: prev?.sizePx ?? 5,
      color: prev?.color ?? "#000000",
    };
  } else if (effectId === "innerShadow") {
    const prev = editorModel.effects[layerId].innerShadow as InnerShadowEffectState | undefined;
    editorModel.effects[layerId].innerShadow = {
      initialized: true,
      enabled,
      color: prev?.color ?? "#000000",
      opacity: prev?.opacity ?? 0.6,
      angle: prev?.angle ?? 120,
      distancePx: prev?.distancePx ?? 5,
      choke: prev?.choke ?? 0,
      sizePx: prev?.sizePx ?? 5,
    };
  } else if (effectId === "innerGlow") {
    const prev = editorModel.effects[layerId].innerGlow as InnerGlowEffectState | undefined;
    editorModel.effects[layerId].innerGlow = {
      initialized: true,
      enabled,
      color: prev?.color ?? "#ffffff",
      opacity: prev?.opacity ?? 0.5,
      source: prev?.source ?? "edge",
      choke: prev?.choke ?? 0,
      sizePx: prev?.sizePx ?? 5,
    };
  } else if (effectId === "outerGlow") {
    const prev = editorModel.effects[layerId].outerGlow as OuterGlowEffectState | undefined;
    editorModel.effects[layerId].outerGlow = {
      initialized: true,
      enabled,
      color: prev?.color ?? "#ffff00",
      opacity: prev?.opacity ?? 0.8,
      spread: prev?.spread ?? 0,
      sizePx: prev?.sizePx ?? 5,
    };
  } else if (effectId === "gradientOverlay") {
    const prev = editorModel.effects[layerId].gradientOverlay as GradientOverlayEffectState | undefined;
    const defaultStops: GradientOverlayStop[] = [
      { color: "#000000", position: 0 },
      { color: "#ffffff", position: 1 },
    ];
    editorModel.effects[layerId].gradientOverlay = {
      initialized: true,
      enabled,
      opacity: prev?.opacity ?? 0.9,
      style: prev?.style ?? "linear",
      angle: prev?.angle ?? 90,
      scale: prev?.scale ?? 1,
      reverse: prev?.reverse ?? false,
      stops: prev?.stops ? prev.stops.map((s) => ({ ...s })) : defaultStops.map((s) => ({ ...s })),
    };
  } else if (effectId === "blur") {
    const prev = editorModel.effects[layerId].blur as BlurEffectState | undefined;
    editorModel.effects[layerId].blur = {
      initialized: true,
      enabled,
      sizePx: prev?.sizePx ?? 10,
    };
  } else {
    editorModel.effects[layerId][effectId] = { initialized: true, enabled };
  }
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
