<script setup lang="ts">
import LayersPanel from "./components/LayersPanel.vue";
import PlaygroundTopBar from "./components/PlaygroundTopBar.vue";
import SmallScreenNotice from "./components/SmallScreenNotice.vue";
import { editorModel } from "./layersModel";

defineProps<{
  toggleLayerVisibility: (id: string) => void;
}>();
</script>

<template>
  <PlaygroundTopBar />
  <SmallScreenNotice />
  <LayersPanel
    :layers="editorModel.layers"
    :toggle-layer-visibility="toggleLayerVisibility"
  />
</template>
