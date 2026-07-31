/* eslint-disable react-refresh/only-export-components */
import type { CSSProperties, ComponentPropsWithoutRef } from 'react';
import type { TransportMode } from '../../../shared/types';

import trolleyBusUrl from '../assets/custom-icons/trolley_bus.svg';
import horseUrl from '../assets/custom-icons/horse.svg';
import skiTourUrl from '../assets/custom-icons/ski_tour.svg';

/**
 * Add custom SVGs here. Callers only use the icon name, regardless of its source.
 */
export const CUSTOM_ICONS: Readonly<Record<string, string>> = {
  trolley_bus: trolleyBusUrl,
  horse: horseUrl,
  ski_tour: skiTourUrl,
};

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
  return name in CUSTOM_ICONS;
}

/** Renders either a registered SVG or a Google Material Symbol by the same name. */
export function Icon({ name, size = 20, className, style, ...props }: IconProps) {
  name = name.trim().toLowerCase();
  const customIconUrl = CUSTOM_ICONS[name];

  if (customIconUrl) {
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
  const customIconUrl = CUSTOM_ICONS[name];

  Object.assign(element.style, { ...baseStyle(size), fontSize: `${size}px` });
  if (customIconUrl) {
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
