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

let transientStyleConfig: RenderStyleConfig | null = null;

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

export function getTransientStyleConfig(): RenderStyleConfig | null {
  return transientStyleConfig;
}

export function setTransientStyleConfig(config: RenderStyleConfig | null) {
  transientStyleConfig = config;
  window.dispatchEvent(new Event('preferences-updated'));
}

export function clearTransientStyleConfig() {
  if (!transientStyleConfig) return;
  transientStyleConfig = null;
  window.dispatchEvent(new Event('preferences-updated'));
}

export function getResolvedActiveStyleConfig(): RenderStyleConfig {
  if (transientStyleConfig) return transientStyleConfig;

  const activeId = getActiveStyleConfigId();
  const configs = getStyleConfigs();
  return configs.find(c => c.id === activeId) || configs[0];
}

function getModeFilterKey(modeKey: string) {
  return modeKey.trim();
}

function getModeFilterLabel(modeKey: string) {
  const normalized = getModeFilterKey(modeKey);
  if (normalized.startsWith('other:')) {
    const icon = normalized.slice('other:'.length);
    return icon ? `Filtered: other/${icon}` : 'Filtered: other';
  }
  return `Filtered: ${normalized}`;
}

export function buildTransportModeFilterStyleConfig(baseConfig: RenderStyleConfig, modeKey: string): RenderStyleConfig {
  const normalizedModeKey = getModeFilterKey(modeKey);
  const baseScript = JSON.stringify(baseConfig.script);
  const label = getModeFilterLabel(modeKey);

  return {
    id: `analytics-filter:${baseConfig.id}:${normalizedModeKey}`,
    name: `${baseConfig.name} - ${label}`,
    script: `const __baseScript = ${baseScript};
const __base = new Function(__baseScript)();
const __modeKey = ${JSON.stringify(normalizedModeKey)};

function __matchesSegment(segment) {
  if (!segment) return false;
  if (__modeKey.startsWith('other:')) {
    const __icon = __modeKey.slice('other:'.length);
    return segment.transportMode === 'other' && segment.customIcon === __icon;
  }
  return segment.transportMode === __modeKey;
}

function getWaypointStyle(waypoint, segments, colors, context) {
  return { hidden: true };
}

function getSegmentStyle(segment, color, context) {
  if (!__matchesSegment(segment)) {
    return { hidden: true };
  }
  const __selectedSegmentId = context?.selectedSegment?.id || null;
  const __isSelectedSegment = !!__selectedSegmentId && segment?.id === __selectedSegmentId;
  const __baseContext = { ...context, showHiddenSegments: true };
  const __baseStyle = __base.getSegmentStyle ? __base.getSegmentStyle(segment, color, __baseContext) : null;
  const __baseOpacity = typeof __baseStyle?.opacity === 'number' ? __baseStyle.opacity : 1;
  const __opacity = __selectedSegmentId && !__isSelectedSegment ? Math.min(__baseOpacity, 0.2) : __baseOpacity;
  if (__baseStyle && __baseStyle.hidden) {
    return { ...__baseStyle, hidden: false, opacity: __opacity };
  }
  if (__baseStyle) {
    return { ...__baseStyle, opacity: __opacity };
  }
  return { opacity: __opacity };
}

return { ...__base, getWaypointStyle, getSegmentStyle };`
  };
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
