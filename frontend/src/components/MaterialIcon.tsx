/* eslint-disable react-refresh/only-export-components */
import type { TransportMode } from '../../../shared/types';

export const MaterialIcon = ({ name, size = 20, style }: { name: string, size?: number, style?: React.CSSProperties }) => (
  <span className="material-symbols-rounded" style={{ fontSize: size, userSelect: 'none', ...style }}>{name}</span>
);

export function getModeIcon(mode: TransportMode, size: number = 18) {
  switch (mode) {
    case 'walk': return <MaterialIcon name="directions_walk" size={size} />;
    case 'hike': return <MaterialIcon name="hiking" size={size} />;
    case 'run': return <MaterialIcon name="directions_run" size={size} />;
    case 'car': return <MaterialIcon name="directions_car" size={size} />;
    case 'flight': return <MaterialIcon name="flight" size={size} />;
    case 'train': return <MaterialIcon name="train" size={size} />;
    case 'light_rail':
    case 'tram': return <MaterialIcon name="tram" size={size} />;
    case 'ferry': return <MaterialIcon name="directions_boat" size={size} />;
    case 'waterway': return <MaterialIcon name="water" size={size} />;
    default: return <MaterialIcon name="navigation" size={size} />;
  }
}