export type GpsPosition = { lat: number; lon: number };

type RequestInput = { operation: 'read'; file: File } | { operation: 'write'; file: File; position: GpsPosition };
type Response = { id: number; ok: true; value: GpsPosition | null | ArrayBuffer } | { id: number; ok: false; error: string };
type Pending = { resolve: (value: any) => void; reject: (error: Error) => void };

const pending = new Map<number, Pending>();
let nextId = 0;
let worker: Worker | null = null;

function failWorker(instance: Worker, reason: Error) {
  instance.terminate();
  if (worker === instance) worker = null;
  for (const [id, request] of pending) {
    pending.delete(id);
    request.reject(reason);
  }
}

function getWorker(): Worker {
  if (worker) return worker;
  const instance = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker = instance;
  instance.addEventListener('message', (event: MessageEvent<Response>) => {
    const response = event.data;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.ok) request.resolve(response.value);
    else request.reject(new Error(response.error));
  });
  instance.addEventListener('error', event => {
    event.preventDefault();
    failWorker(instance, new Error(event.message || 'EXIF worker stopped unexpectedly'));
  });
  instance.addEventListener('messageerror', () => failWorker(instance, new Error('Could not read the EXIF worker response')));
  return instance;
}

function run<T>(request: RequestInput): Promise<T> {
  const id = ++nextId;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try { getWorker().postMessage({ ...request, id }); }
    catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export const readGps = (file: File): Promise<GpsPosition | null> => run({ operation: 'read', file });

export async function writeGps(file: File, position: GpsPosition): Promise<Uint8Array> {
  if (!Number.isFinite(position.lat) || Math.abs(position.lat) > 90
    || !Number.isFinite(position.lon) || Math.abs(position.lon) > 180) {
    throw new RangeError('GPS coordinates are outside the valid range');
  }
  return new Uint8Array(await run<ArrayBuffer>({ operation: 'write', file, position }));
}

export function editedPhotoFile(original: File, bytes: Uint8Array): File {
  return new File([bytes.slice().buffer as ArrayBuffer], original.name, { type: original.type, lastModified: original.lastModified });
}
