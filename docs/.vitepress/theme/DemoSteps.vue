<script setup lang="ts">
defineProps<{ labels: string[]; active: number; label: string }>()
</script>
<template>
  <ol class="ds" :aria-label="label">
    <li
      v-for="(text, index) in labels"
      :key="text"
      :class="{ 'ds-current': index === active, 'ds-done': index < active }"
      :aria-current="index === active ? 'step' : undefined"
    >
      <span aria-hidden="true">{{ index < active ? '✓' : index + 1 }}</span>
      {{ text }}
    </li>
  </ol>
</template>
<style scoped>
.ds {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  gap: 24px;
  margin: 0;
  padding: 14px 20px;
  list-style: none;
  color: var(--fr-muted);
  font-size: 11px;
  line-height: 1.5;
}
.ds li {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin: 0;
}
.ds li > span {
  display: grid;
  place-items: center;
  flex: none;
  width: 17px;
  height: 17px;
  border: 1px solid var(--fr-line);
  border-radius: 50%;
  font-size: 9px;
}
.ds .ds-current {
  color: var(--vp-c-brand-1);
  font-weight: 650;
}
.ds-current > span {
  border-color: #ecc2cf !important;
  background: #fff4f7;
}
.ds-done > span {
  color: #39796c;
}
@container (max-width: 470px) {
  .ds {
    gap: 12px;
    padding-inline: 12px;
    font-size: 10px;
  }
}
@container (max-width: 320px) {
  .ds {
    gap: 8px;
    font-size: 9px;
  }
  .ds li {
    gap: 4px;
  }
}
</style>
