<script setup lang="ts">
import LayersPanel from "./components/LayersPanel.vue";
import { editorModel } from "./layersModel";

defineProps<{
  toggleLayerVisibility: (id: string) => void;
}>();
</script>

<template>
  <LayersPanel
    :layers="editorModel.layers"
    :toggle-layer-visibility="toggleLayerVisibility"
  />
</template>
