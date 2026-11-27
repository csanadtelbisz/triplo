import zeroperlWasmUrl from '@6over3/zeroperl-ts/zeroperl.wasm?url';

type Position = { lat: number; lon: number };
type Request = { id: number; operation: 'read'; file: File } | { id: number; operation: 'write'; file: File; position: Position };

const workerScope = self as unknown as {
  addEventListener: (type: 'message', listener: (event: MessageEvent<Request>) => void) => void;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};
const loadWasm = () => fetch(zeroperlWasmUrl);

function parseGps(json: string): Position | null {
  const [metadata] = JSON.parse(json) as { GPSLatitude?: number | string; GPSLatitudeRef?: string; GPSLongitude?: number | string; GPSLongitudeRef?: string }[];
  const lat = Number(metadata?.GPSLatitude), lon = Number(metadata?.GPSLongitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat: metadata?.GPSLatitudeRef === 'S' ? -Math.abs(lat) : Math.abs(lat), lon: metadata?.GPSLongitudeRef === 'W' ? -Math.abs(lon) : Math.abs(lon) };
}

let operationQueue = Promise.resolve();

workerScope.addEventListener('message', event => {
  const request = event.data;
  operationQueue = operationQueue.then(async () => {
    try {
      const browserGlobals = globalThis as unknown as { window?: unknown; document?: unknown };
      browserGlobals.window ??= globalThis;
      browserGlobals.document ??= {};
      const { parseMetadata, writeMetadata } = await import('@uswriting/exiftool');
      if (request.operation === 'read') {
        const result = await parseMetadata(request.file, { args: ['-json', '-n', '-GPS:all'], transform: data => data, fetch: loadWasm });
        if (!result.success) throw new Error(result.error || 'Could not read photo metadata');
        workerScope.postMessage({ id: request.id, ok: true, value: parseGps(result.data) });
        return;
      }
      const position = request.position;
      const result = await writeMetadata(request.file, {
        GPSLatitude: Math.abs(position.lat), GPSLatitudeRef: position.lat < 0 ? 'S' : 'N',
        GPSLongitude: Math.abs(position.lon), GPSLongitudeRef: position.lon < 0 ? 'W' : 'E',
      }, { args: ['-m'], fetch: loadWasm });
      if (!result.success || !result.data) throw new Error(result.error || 'Could not write photo metadata');
      workerScope.postMessage({ id: request.id, ok: true, value: result.data }, [result.data]);
    } catch (error) {
      workerScope.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }).catch(error => {
    workerScope.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  });
});
