// Only the Android wrapper build defines VITE_TRIPLO_NATIVE=android. In every
// other build this constant folds to false and native-only code is removed.
// The optional chain keeps this module loadable in Node, where the Playwright tests import it and import.meta.env is missing.
export const IS_NATIVE = import.meta.env?.VITE_TRIPLO_NATIVE === 'android';

export const NATIVE_PUBLIC_APP_URL = 'https://csanadtelbisz.github.io/triplo/';

// Injected by the wrapper (WebViewCompat.addWebMessageListener) for the app origin only.
type NativeChannel = {
  postMessage(message: string): void;
  onmessage: ((event: { data: string }) => void) | null;
};

type BinaryChannel = { postMessage(message: ArrayBuffer): void; onmessage: ((event: { data: string }) => void) | null };

declare global {
  interface Window {
    TriploNative?: NativeChannel;
    TriploPhotoWriter?: BinaryChannel;
    __triploHandleBack?: () => boolean;
  }
}

// The wrapper asks the page first when the system Back button is pressed.
const backHandlers: Array<() => void> = [];
if (IS_NATIVE) {
  window.__triploHandleBack = () => {
    const handler = backHandlers.at(-1);
    handler?.();
    return !!handler;
  };
}

export function registerNativeBackHandler(handler: () => void): () => void {
  backHandlers.push(handler);
  return () => {
    const index = backHandlers.lastIndexOf(handler);
    if (index >= 0) backHandlers.splice(index, 1);
  };
}

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void };
const pending = new Map<string, Pending>();

if (IS_NATIVE && window.TriploNative) {
  window.TriploNative.onmessage = event => {
    const response = JSON.parse(event.data) as { id: string; ok: boolean; result?: unknown; error?: string };
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.ok) request.resolve(response.result);
    else request.reject(new Error(response.error || 'Native call failed'));
  };
}

export function callNative<T>(method: string, args: unknown = {}): Promise<T> {
  const channel = window.TriploNative;
  if (!IS_NATIVE || !channel) return Promise.reject(new Error('Native bridge is not available'));
  const id = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    channel.postMessage(JSON.stringify({ id, method, args }));
  });
}

export async function requestPhotoWrite(ids: number[]): Promise<void> {
  const result = await callNative<{ granted: boolean }>('requestPhotoWrite', { ids });
  if (!result.granted) throw new Error('Android photo write access was not granted');
}

export function sendPhotoBytes(id: number, bytes: Uint8Array): Promise<void> {
  const channel = window.TriploPhotoWriter;
  if (!IS_NATIVE || !channel) return Promise.reject(new Error('Binary photo writing is unavailable in this WebView'));
  const header = new TextEncoder().encode(JSON.stringify({ id }));
  const packet = new Uint8Array(4 + header.length + bytes.length);
  new DataView(packet.buffer).setInt32(0, header.length);
  packet.set(header, 4);
  packet.set(bytes, 4 + header.length);
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => { channel.onmessage = null; reject(new Error('Timed out saving photo')); }, 120000);
    channel.onmessage = event => {
      try {
        const result = JSON.parse(event.data) as { ok: boolean; error?: string; id: number };
        if (result.id !== id) return;
        window.clearTimeout(timeout);
        channel.onmessage = null;
        if (result.ok) resolve();
        else reject(new Error(result.error || 'Could not save photo'));
      } catch (error) {
        window.clearTimeout(timeout);
        channel.onmessage = null;
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    try { channel.postMessage(packet.buffer); }
    catch (error) {
      window.clearTimeout(timeout);
      channel.onmessage = null;
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

// Base URL for links meant to be opened outside this app.
export const getPublicBaseUrl = () =>
  IS_NATIVE ? NATIVE_PUBLIC_APP_URL : `${window.location.origin}${import.meta.env.BASE_URL}`;
