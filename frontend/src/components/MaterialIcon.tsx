/* eslint-disable react-refresh/only-export-components */
import type { TransportMode } from '../../../shared/types';

export const MaterialIcon = ({ name, size = 20, style, className }: { name: string, size?: number, style?: React.CSSProperties, className?: string }) => (
  <span className={`material-symbols-rounded ${className || ''}`.trim()} style={{ fontSize: size, userSelect: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: size, display: 'inline-block', verticalAlign: 'middle', ...style }}>{name}</span>
);

export function getModeIcon(mode: TransportMode, size: number = 18) {
  switch (mode) {
    case 'walk': return <MaterialIcon name="directions_walk" size={size} />;
    case 'bike': return <MaterialIcon name="pedal_bike" size={size} />;
    case 'hike': return <MaterialIcon name="hiking" size={size} />;
    case 'run': return <MaterialIcon name="directions_run" size={size} />;
    case 'car': return <MaterialIcon name="directions_car" size={size} />;
    case 'taxi': return <MaterialIcon name="local_taxi" size={size} />;
    case 'bus': return <MaterialIcon name="directions_bus" size={size} />;
    case 'rail': return <MaterialIcon name="train" size={size} />;
    case 'subway': return <MaterialIcon name="subway" size={size} />;
    case 'flight': return <MaterialIcon name="flight" size={size} />;
    case 'ferry': return <MaterialIcon name="directions_boat" size={size} />;
    default: return <MaterialIcon name="navigation" size={size} />;
  }
}