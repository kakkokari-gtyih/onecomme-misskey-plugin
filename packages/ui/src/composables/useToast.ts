import { readonly, ref } from 'vue';

export type Toast = {
    id: number;
    message: string;
    type: 'info' | 'error';
};

const TOAST_DURATION = 4000;

const current = ref<Toast | null>(null);
let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

export function useToast() {
    function show(message: string, type: Toast['type'] = 'info') {
        current.value = { id: ++seq, message, type };
        clearTimeout(timer);
        timer = setTimeout(() => {
            current.value = null;
        }, TOAST_DURATION);
    }

    return {
        toast: readonly(current),
        show,
    };
}
