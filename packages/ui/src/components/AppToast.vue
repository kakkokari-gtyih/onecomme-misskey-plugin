<template>
    <Transition
        enterFromClass="opacity-0 translate-y-2"
        leaveToClass="opacity-0 translate-y-2"
        enterActiveClass="transition duration-200"
        leaveActiveClass="transition duration-200"
    >
        <div
            v-if="toast != null"
            :key="toast.id"
            role="status"
            aria-live="polite"
            class="fixed bottom-6 left-1/2 max-w-[calc(100%-32px)] rounded-full px-4.5 py-2.5 shadow-lg -translate-x-1/2"
            :class="toast.type === 'error' ? 'bg-danger text-white' : 'bg-fg text-canvas'"
        >
            {{ toast.message }}
        </div>
    </Transition>
</template>

<script setup lang="ts">
import { useToast } from '@/composables/useToast.js';

const { toast } = useToast();
</script>
