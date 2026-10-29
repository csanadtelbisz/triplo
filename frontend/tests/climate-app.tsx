import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Trip } from '../../shared/types';
import PreferencesPanel from '../src/components/PreferencesPanel';
import { SegmentInfo } from '../src/components/SegmentInfo';
import { TripEditor } from '../src/components/TripEditor';
import { AnalyticsPanel } from '../src/components/AnalyticsPanel';
import { emptyAnalyticsSelection } from '../src/countries/analytics';
import { FlightProfileTripsContext } from '../src/climate/flightProfileTrips';
import '../src/index.css';
import '../src/styles/App.css';
import '../src/styles/Shared.css';
import '../src/styles/TripEditor.css';
import '../src/styles/WaypointInfo.css';

const fixture: Trip = {
  id: 'climate', name: 'Climate trip', startDate: '2026-05-01', endDate: '2026-05-01', createdAt: '2026-05-01', updatedAt: '',
  tripDistanceSummary: { totalDistance: 100, distanceByMode: { car: 100 } },
  segments: [{ id: 'car', name: 'Drive', transportMode: 'car', routingProfile: 'straight_line', routingService: 'Straight Line Router', source: 'manual',
    geometry: { type: 'LineString', coordinates: [[19, 47], [20, 47]] },
    waypoints: [{ id: 'start', name: 'Start', coordinates: [19, 47] }, { id: 'end', name: 'End', coordinates: [20, 47] }],
    distanceStats: { totalDistance: 100, hasElevation: false, elevationUp: 0, elevationDown: 0 }, countryDistances: { HU: 75, DE: 25 },
  }],
};
export default function ClimateApp() {
  const [panel, setPanel] = useState('preferences');
  const [segmentId, setSegmentId] = useState('car');
  const [readOnly, setReadOnly] = useState(false);
  const [selection, setSelection] = useState(emptyAnalyticsSelection);
  const [additionalTrips] = useState<Trip[]>(() => JSON.parse(localStorage.getItem('climate-test-additional-trips') || '[]'));
  const [trip, setTrip] = useState<Trip>(() => JSON.parse(localStorage.getItem('climate-test-trip') || 'null') || fixture);
  const update = (next: Trip) => { setTrip(next); localStorage.setItem('climate-test-trip', JSON.stringify(next)); };
  return <FlightProfileTripsContext value={[trip, ...additionalTrips]}><div className="sidebar" style={{ width: 390, height: '100vh', maxWidth: '100%' }}>
    <nav>{['preferences', 'trip', 'segment', 'analytics'].map(p => <button key={p} onClick={() => setPanel(p)}>{p}</button>)}<label><input type="checkbox" checked={readOnly} onChange={e => setReadOnly(e.target.checked)} />Read only</label></nav>
    {panel === 'preferences' && <PreferencesPanel onGoBack={() => {}} onSetHome={() => {}} onZoomHome={() => {}} editingConfigId={null} onEditingConfigChange={() => {}} />}
    {panel === 'segment' && <SegmentInfo trip={trip} segmentId={segmentId} isReadOnly={readOnly} onGoBack={() => {}} onUpdateTrip={update} />}
    {panel === 'trip' && <TripEditor trip={trip} isReadOnly={readOnly} onGoBack={() => {}} onSelectSegment={id => { setSegmentId(id); setPanel('segment'); }} onSelectWaypoint={() => {}} onZoomToTrip={() => {}} onZoomToSegment={() => {}} onJumpToWaypoint={() => {}} onUndo={() => {}} onRedo={() => {}} canUndo={false} canRedo={false} onSave={() => {}} canSave={false} onUpdateTrip={update} onWaitingForCoords={() => {}} />}
    {panel === 'analytics' && <AnalyticsPanel trips={[trip, ...additionalTrips]} isReadOnly={readOnly} onGoBack={() => {}} onUpdateTrip={update} onOpenSegmentInfo={() => setPanel('segment')} onFocusSegment={() => {}} timeSliderVisible={false} onToggleTimeSlider={() => {}} selection={selection} onSelectionChange={setSelection} countryLoading={false} onRetryCountries={() => {}} />}
  </div></FlightProfileTripsContext>;
}
createRoot(document.getElementById('root')!).render(<ClimateApp />);
