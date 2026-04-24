import type { TransportMode } from '../../../shared/types';

export const ModeThemes: Record<TransportMode, { color: string }> = {
  run: { color: '#2ecc71' }, // green
  walk: { color: '#27ae60' }, // middle green
  hike: { color: '#08813b' },  // dark green
  bike: { color: '#f39c12' }, // orange
  car: { color: '#3498db' },  // blue
  taxi: { color: '#ffce08' }, // yellow
  bus: { color: '#1173b5' }, // blue
  rail: { color: '#e74c3c' }, // red
  subway: { color: '#d35400' }, // orange-red
  flight: { color: '#9b59b6' }, // purple
  ferry: { color: '#00cec9' }, // teal
  other: { color: '#95a5a6' }, // gray
};
