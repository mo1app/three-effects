<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";

const STORAGE_KEY = "three-effects-playground-small-screen-dismiss";

/** Match fixed panels + margins (~240 + 560 + padding). Short viewports hide vertical space for the stack. */
const QUERY = "(max-width: 300px), (max-height: 520px)";

const mqSupported = typeof window !== "undefined" && "matchMedia" in window;
const mq = mqSupported ? window.matchMedia(QUERY) : null;

const matchesQuery = ref(mq?.matches ?? false);

function readDismissed() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

const dismissed = ref(
  typeof sessionStorage !== "undefined" ? readDismissed() : false,
);

function onMqChange() {
  if (!mq) return;
  matchesQuery.value = mq.matches;
  if (mq.matches) dismissed.value = readDismissed();
}

function dismiss() {
  dismissed.value = true;
  try {
    sessionStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* private mode */
  }
}

const visible = computed(() => matchesQuery.value && !dismissed.value);

onMounted(() => {
  if (!mq) return;
  matchesQuery.value = mq.matches;
  mq.addEventListener("change", onMqChange);
});

onUnmounted(() => {
  mq?.removeEventListener("change", onMqChange);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-show="visible"
      class="small-screen-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="small-screen-title"
      aria-describedby="small-screen-desc"
    >
      <div class="small-screen-card" @click.stop>
        <h2 id="small-screen-title" class="small-screen-title">
          Small viewport
        </h2>
        <p id="small-screen-desc" class="small-screen-text">
          This playground is laid out for a larger window. For the best
          experience, use a desktop-sized window or rotate to landscape.
        </p>
        <button type="button" class="small-screen-btn" @click="dismiss">
          Continue anyway
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.small-screen-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  pointer-events: auto;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
}

.small-screen-card {
  max-width: 22rem;
  padding: 18px 20px;
  border: 1px solid #1a1a1a;
  border-radius: 4px;
  background: linear-gradient(180deg, #e0e0e0 0%, #c8c8c8 100%);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
}

.small-screen-title {
  margin: 0 0 10px;
  font-size: 15px;
  font-weight: 700;
  color: #1a1a1a;
  font-family:
    Tahoma,
    system-ui,
    -apple-system,
    Segoe UI,
    sans-serif;
}

.small-screen-text {
  margin: 0 0 16px;
  font-size: 12px;
  line-height: 1.45;
  color: #2a2a2a;
  text-wrap: pretty;
  font-family:
    Tahoma,
    system-ui,
    -apple-system,
    Segoe UI,
    sans-serif;
}

.small-screen-btn {
  font-size: 12px;
  font-weight: 600;
  padding: 6px 14px;
  cursor: pointer;
  color: #1a1a1a;
  background: #d8d8d8;
  border: 1px solid #5a5a5a;
  border-radius: 3px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
  font-family: inherit;
}

.small-screen-btn:hover {
  background: #e8e8e8;
}

.small-screen-btn:active {
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.2);
}
</style>
