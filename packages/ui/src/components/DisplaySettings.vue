<template>
    <section class="card">
        <h2 class="card-title">表示設定</h2>

        <div>
            <ToggleSwitch v-model="showRoleBadges">ロールバッジを表示する</ToggleSwitch>
            <span class="note">Misskeyのロールのアイコンを、わんコメのコメントのバッジとして表示します。</span>
        </div>

        <div class="mt-5 flex justify-end">
            <button type="button" class="btn-primary" :disabled="saving" @click="save">保存</button>
        </div>
    </section>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { PublicState } from '@onecomme-misskey/shared';

import { getErrorMessage, postApi } from '@/api.js';
import ToggleSwitch from '@/components/ToggleSwitch.vue';
import { useToast } from '@/composables/useToast.js';

const props = defineProps<{
    state: PublicState;
}>();

const emit = defineEmits<{
    'update:state': [state: PublicState];
}>();

const { show } = useToast();

// 編集中の値（保存するまでプラグインには反映しない）
const showRoleBadges = ref(false);

// 保存済みの値が変わったときだけ同期する（他のセクションの保存で編集中の値が上書きされないように）
watch(() => props.state.display.showRoleBadges, (value) => {
    showRoleBadges.value = value;
}, { immediate: true });

const saving = ref(false);

async function save() {
    saving.value = true;
    try {
        emit('update:state', await postApi('display', {
            showRoleBadges: showRoleBadges.value,
        }));
        show('保存しました');
    } catch (err) {
        show(getErrorMessage(err), 'error');
    } finally {
        saving.value = false;
    }
}
</script>
