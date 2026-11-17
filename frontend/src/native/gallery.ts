import { callNative } from './native';

export type GalleryImage = {
  id: number;
  /** Milliseconds since epoch from the photo library. */
  taken: number;
  /** Pixel size as displayed, 0 when unknown. */
  width: number;
  height: number;
  lat: number;
  lon: number;
  /** EXIF capture time as the camera clock showed it: "YYYY:MM:DD HH:MM:SS". */
  label: string | null;
  /** EXIF UTC offset of that clock, such as "+02:00". Missing on older cameras. */
  offset: string | null;
};

// Large enough to look sharp full width, much smaller than the original.
const PANEL_IMAGE_SIZE = 2048;

export const thumbnailUrl = (id: number, size = 256) => `/native/thumb/${id}/${size}`;
export const panelImageUrl = (id: number) => thumbnailUrl(id, PANEL_IMAGE_SIZE);
export const fullImageUrl = (id: number) => `/native/full/${id}`;

export async function requestGalleryAccess(): Promise<boolean> {
  const { granted } = await callNative<{ granted: boolean }>('galleryPermission');
  return granted;
}

/** Geotagged photos taken between the two instants. */
export async function queryGallery(from: number, to: number): Promise<GalleryImage[]> {
  const response = await fetch(`/native/query/${from}/${to}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Gallery query failed (${response.status})`);
  const images = (await response.json()) as GalleryImage[];
  // Some cameras write 0,0 when they have no fix.
  return images.filter(image => image.lat !== 0 || image.lon !== 0);
}

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
