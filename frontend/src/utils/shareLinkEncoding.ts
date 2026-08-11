export type SharedTripService = 'Google Drive' | 'GitHub';

export interface SharedTripReference {
  service: SharedTripService;
  data: string;
}

const SERVICE_CODES: Record<SharedTripService, string> = {
  'Google Drive': 'gd',
  'GitHub': 'gh',
};

const SERVICE_NAMES: Record<string, SharedTripService> = {
  gd: 'Google Drive',
  gh: 'GitHub',
};

function encodeBase64Url(value: string): string {
  return btoa(unescape(encodeURIComponent(value)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function decodeBase64Url(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return decodeURIComponent(escape(atob(padded)));
  } catch {
    return null;
  }
}

export function encodeSharePayload(payload: SharedTripReference): string {
  const code = SERVICE_CODES[payload.service];
  return `${code}${encodeBase64Url(payload.data)}`;
}

export function decodeSharePayload(encoded: string): SharedTripReference | null {
  if (!encoded || encoded.length < 3) return null;

  const serviceCode = encoded.slice(0, 2);
  const service = SERVICE_NAMES[serviceCode];
  if (!service) return null;

  const data = decodeBase64Url(encoded.slice(2));
  if (data === null) return null;

  return { service, data };
}
