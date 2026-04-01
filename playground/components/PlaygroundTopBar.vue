<script setup lang="ts">
const GITHUB_URL = "https://github.com/mo1app/three-effects";
const NPM_URL = "https://www.npmjs.com/package/three-effects";
</script>

<template>
  <header class="playground-top-bar playground-interactive" aria-label="Playground">
    <span class="app-title">three-effects</span>
    <nav class="bar-links" aria-label="Project links">
      <a :href="GITHUB_URL" target="_blank" rel="noopener noreferrer">GitHub repo</a>
      <a :href="NPM_URL" target="_blank" rel="noopener noreferrer">npm module</a>
    </nav>
  </header>
</template>

<style scoped>
.playground-top-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 24px;
  padding: 3px 12px 4px;
  pointer-events: auto;
  font-family:
    Tahoma,
    system-ui,
    -apple-system,
    Segoe UI,
    sans-serif;
  font-size: 11px;
  font-weight: 500;
  color: #1a1a1a;
  background: linear-gradient(180deg, #d8d8d8 0%, #b8b8b8 48%, #a8a8a8 100%);
  border-bottom: 1px solid #6a6a6a;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.55),
    0 1px 3px rgba(0, 0, 0, 0.12);
  user-select: none;
}

.app-title {
  flex: 0 0 auto;
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.02em;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.35);
}

.bar-links {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}

.bar-links a {
  color: inherit;
  text-decoration: none;
  padding: 2px 8px;
  border-radius: 3px;
  border: 1px solid transparent;
}

.bar-links a:hover {
  background: rgba(255, 255, 255, 0.28);
  border-color: rgba(0, 0, 0, 0.12);
}

.bar-links a:active {
  background: rgba(0, 0, 0, 0.08);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.12);
}
</style>
