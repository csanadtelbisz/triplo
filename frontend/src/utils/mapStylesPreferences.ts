import type { Segment, Waypoint } from '../../../shared/types';

export interface StyleConfigurationContext {
  isNoTripSelected: boolean;
  showHiddenSegments: boolean;
  isReadOnly: boolean;
  selectedSegment: Segment | null;
  mapLayer: string;
  waypointInfo?: {
    isLastSegment: boolean;
    isLastInSeg: boolean;
    isBordering: boolean;
    segIndex: number;
    wpIndex: number;
    currSegColor: string;
  };
}

export interface RenderStyleConfig {
  id: string; // UUID
  name: string;
  script: string;
  readonly?: boolean;
}

import defaultStyleRaw from '../themes/default.js?raw';
export const DEFAULT_STYLE_SCRIPT = defaultStyleRaw;

export const DEFAULT_STYLE_CONFIG: RenderStyleConfig = {
  id: 'default',
  name: 'Default Style',
  script: DEFAULT_STYLE_SCRIPT,
  readonly: true
};

export function getStyleConfigs(): RenderStyleConfig[] {
  const data = localStorage.getItem('renderStyleConfigs');
  if (data) {
    try {
      const parsed = JSON.parse(data) as RenderStyleConfig[];
      // Ensure we never load a persisted default config from storage — always use the runtime DEFAULT_STYLE_CONFIG
      const filtered = parsed.filter(c => c.id !== 'default');
      // Prepend runtime default config so it's always first in the list
      filtered.unshift(DEFAULT_STYLE_CONFIG);
      return filtered;
    } catch (e) {
        // ignore
    }
  }
  return [DEFAULT_STYLE_CONFIG];
}

export function saveStyleConfigs(configs: RenderStyleConfig[]) {
  // Never persist the default runtime config. Persist only user-defined configs.
  const toSave = configs.filter(c => c.id !== 'default');
  localStorage.setItem('renderStyleConfigs', JSON.stringify(toSave));
  // Notify listeners that preferences changed (saved configs exclude default)
  window.dispatchEvent(new Event('preferences-updated'));
}

export function getActiveStyleConfigId(): string {
  return localStorage.getItem('activeRenderStyleConfigId') || 'default';
}

export function setActiveStyleConfigId(id: string) {
  localStorage.setItem('activeRenderStyleConfigId', id);
  window.dispatchEvent(new Event('preferences-updated'));
}

export interface EvaluatedStyles {
  getWaypointStyle?: (wp: Waypoint, segments: Segment[], colors: string[], context: StyleConfigurationContext) => { hidden?: boolean, color?: string | string[], type?: 'dot' | 'pin', size?: number, html?: string, width?: number, height?: number, dropShadow?: boolean, borderRadius?: string, border?: string, opacity?: number } | null;
  getSegmentStyle?: (seg: Segment, color: string, context: StyleConfigurationContext) => { hidden?: boolean, color?: string, width?: number, opacity?: number } | null;
}

export function evaluateStyleConfig(script: string): EvaluatedStyles | null {
  try {
    const fn = new Function(script);
    return fn() as EvaluatedStyles;
  } catch (e) {
    console.error('Failed to evaluate style config script:', e);
    return null;
  }
}
