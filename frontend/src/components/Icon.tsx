/* eslint-disable react-refresh/only-export-components */
import type { CSSProperties, ComponentPropsWithoutRef } from 'react';
import type { TransportMode } from '../../../shared/types';
import customIconsData from '../assets/material-icons/custom-icons-metadata.json';

// Create a fast lookup Set for custom icon names using the JSON metadata
const CUSTOM_ICON_NAMES = new Set(customIconsData.icons.map((icon) => icon.name));

/**
 * Dynamically resolves the URL for a custom icon.
 * Note: `new URL(..., import.meta.url)` is standard in Vite/Webpack 5 for dynamic asset bundling.
 */
function getCustomIconUrl(name: string): string {
  return new URL(`../assets/material-icons/${name}.svg`, import.meta.url).href;
}

export type IconProps = Omit<ComponentPropsWithoutRef<'span'>, 'children'> & {
  name: string;
  size?: number;
};

const baseStyle = (size: number): CSSProperties => ({
  fontSize: size,
  userSelect: 'none',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: size,
  display: 'inline-block',
  verticalAlign: 'middle',
});

export function isCustomIcon(name: string): boolean {
  return CUSTOM_ICON_NAMES.has(name);
}

/** Renders either a registered SVG or a Google Material Symbol by the same name. */
export function Icon({ name, size = 20, className, style, ...props }: IconProps) {
  name = name.trim().toLowerCase();
  
  if (isCustomIcon(name)) {
    const customIconUrl = getCustomIconUrl(name);
    return (
      <span
        {...props}
        className={['triplo-icon', className].filter(Boolean).join(' ')}
        style={{
          ...baseStyle(size),
          maskImage: `url("${customIconUrl}")`,
          WebkitMaskImage: `url("${customIconUrl}")`,
          ...style,
        }}
      />
    );
  }

  return (
    <span {...props} className={['material-symbols-rounded', className].filter(Boolean).join(' ')} style={{ ...baseStyle(size), ...style }}>
      {name}
    </span>
  );
}

// Kept as a compatibility export while callers are migrated to the neutral Icon name.
export const MaterialIcon = Icon;

/** Creates an icon for imperative DOM locations such as MapLibre markers. */
export function createIconElement(name: string, size = 20): HTMLSpanElement {
  const element = document.createElement('span');
  
  Object.assign(element.style, { ...baseStyle(size), fontSize: `${size}px` });
  
  if (isCustomIcon(name)) {
    const customIconUrl = getCustomIconUrl(name);
    element.className = 'triplo-icon';
    element.style.maskImage = `url("${customIconUrl}")`;
    element.style.webkitMaskImage = `url("${customIconUrl}")`;
  } else {
    element.className = 'material-symbols-rounded';
    element.textContent = name;
  }
  
  return element;
}

export function getModeIcon(mode: TransportMode, size: number = 18) {
  switch (mode) {
    case 'walk': return <Icon name="directions_walk" size={size} />;
    case 'bike': return <Icon name="pedal_bike" size={size} />;
    case 'hike': return <Icon name="hiking" size={size} />;
    case 'run': return <Icon name="directions_run" size={size} />;
    case 'car': return <Icon name="directions_car" size={size} />;
    case 'taxi': return <Icon name="local_taxi" size={size} />;
    case 'bus': return <Icon name="directions_bus" size={size} />;
    case 'rail': return <Icon name="train" size={size} />;
    case 'subway': return <Icon name="subway" size={size} />;
    case 'flight': return <Icon name="flight" size={size} />;
    case 'ferry': return <Icon name="directions_boat" size={size} />;
    default: return <Icon name="navigation" size={size} />;
  }
}
