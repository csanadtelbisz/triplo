import type { TransportMode } from '../../../shared/types';

export const ModeThemes: Record<TransportMode, { color: string }> = {
  walk: { color: '#2ecc71' }, // green
  hike: { color: '#27ae60' }, // dark green
  run: { color: '#e67e22' },  // orange
  car: { color: '#3498db' },  // blue
  flight: { color: '#9b59b6' }, // purple
  train: { color: '#e74c3c' }, // red
  light_rail: { color: '#e84393' }, // pink
  tram: { color: '#fd79a8' }, // light pink
  ferry: { color: '#00cec9' }, // teal
  waterway: { color: '#0984e3' }, // dark teal
};
