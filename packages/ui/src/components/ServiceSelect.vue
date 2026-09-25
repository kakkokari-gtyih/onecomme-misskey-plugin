<template>
    <select v-model="selectValue" class="input">
        <option value="">（新しく「Misskey」枠を作成する）</option>
        <option v-for="service in services" :key="service.id" :value="service.id">{{ service.name }}</option>
    </select>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ServiceSummary } from '@onecomme-misskey/shared';

const props = defineProps<{
    services: ServiceSummary[];
}>();

/** null は「新しく枠を作成する」 */
const model = defineModel<string | null>({ required: true });

const selectValue = computed({
    // 選択中の枠が削除されている場合は「新しく作成」扱いにする
    get: () => (model.value != null && props.services.some((s) => s.id === model.value) ? model.value : ''),
    set: (value: string) => {
        model.value = value === '' ? null : value;
    },
});
</script>
