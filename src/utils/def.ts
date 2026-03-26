import type { OnePlugin } from '@onecomme.com/onesdk/types/Plugin';
import type { ConnectedData } from '@onecomme.com/onesdk/types/ApiOptions';
import type StoreType from 'electron-store';

type RemoveIndexSignature<T> = {
    [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};

/** defaultStateの型をelectron store側で使うための拡張 */
export interface OnecommePlugin<T extends Record<string, any>> extends Omit<RemoveIndexSignature<OnePlugin>, 'init'> {
    defaultState: T;
    init?: (api: {
        dir: string;
        filepath: string;
        store: StoreType<T>;
    }, initialData: ConnectedData) => void;
}

export function defineOnecommePlugin<T extends Record<string, any>>(plugin: OnecommePlugin<T> | (() => OnecommePlugin<T>)): OnecommePlugin<T> {
  return typeof plugin === 'function' ? plugin() : plugin;
}
