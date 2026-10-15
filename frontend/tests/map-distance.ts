import { Map } from 'maplibre-gl';
import { attachMobileDistanceMeasurement, formatMeasurementDistance } from '../src/utils/mobileDistanceMeasurement';

const fixture = window as unknown as {
  formatMeasurementDistance: typeof formatMeasurementDistance;
  map: Map;
  removeMeasurement: () => void;
  mapReady: boolean;
};
fixture.formatMeasurementDistance = formatMeasurementDistance;
fixture.map = new Map({
  container: 'map',
  style: { version: 8, sources: {}, layers: [] },
  center: [19, 47],
  zoom: 10,
  attributionControl: false,
});
fixture.removeMeasurement = attachMobileDistanceMeasurement(fixture.map);
fixture.map.on('load', () => { fixture.mapReady = true; });
