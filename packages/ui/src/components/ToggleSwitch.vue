<template>
    <label class="inline-flex cursor-pointer items-center gap-2.5">
        <input v-model="model" type="checkbox" class="peer sr-only">
        <span
            class="relative h-5.5 w-10 shrink-0 rounded-full bg-line transition-colors
                after:absolute after:left-0.75 after:top-0.75 after:size-4 after:rounded-full after:bg-white after:transition-transform after:content-empty
                peer-checked:bg-accent peer-checked:after:translate-x-4.5
                peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2"
        ></span>
        <span><slot></slot></span>
    </label>
</template>

<script setup lang="ts">
const model = defineModel<boolean>({ required: true });
</script>
