import { callNative, requestPhotoWrite, sendPhotoBytes } from './native';
import { writeGps } from './exiftool';

export type GalleryImage = {
  id: number;
  /** Milliseconds since epoch from the photo library. */
  taken: number;
  /** Pixel size as displayed, 0 when unknown. */
  width: number;
  height: number;
  lat: number | null;
  lon: number | null;
  /** EXIF capture time as the camera clock showed it: "YYYY:MM:DD HH:MM:SS". */
  label: string | null;
  /** EXIF UTC offset of that clock, such as "+02:00". Missing on older cameras. */
  offset: string | null;
  screenshot: boolean;
  name?: string;
};

// Large enough to look sharp full width, much smaller than the original.
const PANEL_IMAGE_SIZE = 2048;
const GALLERY_QUERY_BATCH_DAYS = 2;

const imageRevisions = new Map<number, number>();
const revisionQuery = (id: number) => imageRevisions.get(id) ? `?v=${imageRevisions.get(id)}` : '';
export const thumbnailUrl = (id: number, size = 256) => `/native/thumb/${id}/${size}${revisionQuery(id)}`;
export const panelImageUrl = (id: number) => thumbnailUrl(id, PANEL_IMAGE_SIZE);
export const fullImageUrl = (id: number) => `/native/full/${id}${revisionQuery(id)}`;
export const originalImageUrl = (id: number) => `/native/original/${id}`;

export async function requestGalleryAccess(): Promise<boolean> {
  const { granted } = await callNative<{ granted: boolean }>('galleryPermission');
  return granted;
}

/** Photos taken between the two instants, reported in each completed batch. */
export async function queryGallery(from: number, to: number, onBatch?: (images: GalleryImage[]) => void): Promise<GalleryImage[]> {
  const images: GalleryImage[] = [];
  for (let batchFrom = from; batchFrom <= to;) {
    const batchEnd = new Date(batchFrom);
    batchEnd.setDate(batchEnd.getDate() + GALLERY_QUERY_BATCH_DAYS);
    const batchTo = Math.min(to, batchEnd.getTime() - 1);
    const response = await fetch(`/native/query/${batchFrom}/${batchTo}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Gallery query failed (${response.status})`);
    const batchImages = ((await response.json()) as GalleryImage[]).map(image => image.lat === 0 && image.lon === 0 ? { ...image, lat: null, lon: null } : image);
    images.push(...batchImages);
    onBatch?.(batchImages);
    batchFrom = batchTo + 1;
  }
  return images;
}

export const hasGps = (image: GalleryImage): image is GalleryImage & { lat: number; lon: number } =>
  image.lat !== null && image.lon !== null;

export type GpsEditProgress = { id: number | null; current: number; total: number; phase: string };
export type GpsEditFailure = { id: number; name?: string; error: string };
export type GpsEditResult = { savedIds: number[]; failures: GpsEditFailure[] };

export async function persistGpsEdits(
  edits: Record<number, [number, number]>,
  onProgress?: (progress: GpsEditProgress) => void,
  names: Record<number, string> = {},
): Promise<GpsEditResult> {
  const entries = Object.entries(edits).map(([rawId, position]) => [Number(rawId), position] as const);
  const ids = entries.map(([id]) => id);
  const savedIds: number[] = [];
  const failures: GpsEditFailure[] = [];

  onProgress?.({ id: ids[0] ?? null, current: 0, total: ids.length, phase: 'permission' });
  await requestPhotoWrite(ids);

  for (let index = 0; index < entries.length; index++) {
    const [id, [lat, lon]] = entries[index];
    try {
      onProgress?.({ id, current: index, total: entries.length, phase: 'editing' });
      const response = await fetch(originalImageUrl(id), { cache: 'no-store' });
      if (!response.ok) throw new Error(`Could not read original photo (${response.status})`);
      const blob = await response.blob();
      const file = new File([blob], names[id] || `photo-${id}${extensionFor(blob.type)}`, { type: blob.type });
      const bytes = await writeGps(file, { lat, lon });
      onProgress?.({ id, current: index, total: entries.length, phase: 'writing' });
      await sendPhotoBytes(id, bytes);
      imageRevisions.set(id, (imageRevisions.get(id) || 0) + 1);
      savedIds.push(id);
    } catch (error) {
      failures.push({ id, name: names[id], error: error instanceof Error ? error.message : String(error) });
      console.error(`Could not save GPS metadata for photo ${names[id] || id}`, error);
    }
    onProgress?.({ id, current: index + 1, total: entries.length, phase: 'complete' });
  }

  return { savedIds, failures };
}

const extensionFor = (type: string) => ({ 'image/heic': '.heic', 'image/heif': '.heif', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[type] || '.img');

export const imageAspect = (image: GalleryImage): number | null =>
  image.width > 0 && image.height > 0 ? image.width / image.height : null;

const two = (value: number) => String(value).padStart(2, '0');
const EXIF_TIME = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?/;

const offsetMinutes = (offset: string | null): number | null => {
  const match = offset?.match(/^([+-])(\d{2}):?(\d{2})$/);
  return match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : null;
};

/** The moment of capture, using the EXIF clock and offset when both exist. */
export function imageInstant(image: GalleryImage): number {
  const exif = image.label?.match(EXIF_TIME);
  const offset = offsetMinutes(image.offset);
  if (!exif || offset === null) return image.taken;
  return Date.UTC(Number(exif[1]), Number(exif[2]) - 1, Number(exif[3]), Number(exif[4]), Number(exif[5]), Number(exif[6] ?? 0)) - offset * 60_000;
}

/** "YYYY-MM-DD HH:MM" in the photo's own clock, falling back to the device time zone. */
export function imageTimeText(image: GalleryImage): string {
  const exif = image.label?.match(EXIF_TIME);
  if (exif) return `${exif[1]}-${exif[2]}-${exif[3]} ${exif[4]}:${exif[5]}`;
  const date = new Date(image.taken);
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** "UTC+09:00" when the photo was taken in another zone than the phone's, otherwise null. */
export function imageTimezoneText(image: GalleryImage): string | null {
  const offset = offsetMinutes(image.offset);
  if (offset === null) return null;
  const phoneOffset = -new Date(imageInstant(image)).getTimezoneOffset();
  if (offset === phoneOffset) return null;
  const size = Math.abs(offset);
  return `UTC${offset < 0 ? '-' : '+'}${two(Math.floor(size / 60))}:${two(size % 60)}`;
}

export const imageCaption = (image: GalleryImage): string =>
  [imageTimeText(image), imageTimezoneText(image)].filter(Boolean).join(' ');

export const sortImagesByTime = (images: GalleryImage[]): GalleryImage[] =>
  [...images].sort((a, b) => imageInstant(a) - imageInstant(b) || a.id - b.id);
