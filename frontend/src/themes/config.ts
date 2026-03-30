import type { TransportMode } from '../../../shared/types';

export const ModeThemes: Record<TransportMode, { color: string }> = {
  run: { color: '#2ecc71' }, // green
  walk: { color: '#27ae60' }, // middle green
  hike: { color: '#08813b' },  // dark green
  bike: { color: '#f39c12' }, // orange
  car: { color: '#3498db' },  // blue
  flight: { color: '#9b59b6' }, // purple
  rail: { color: '#e74c3c' }, // red
  ferry: { color: '#00cec9' }, // teal
  waterway: { color: '#0984e3' }, // dark teal
  other: { color: '#95a5a6' }, // gray
};
