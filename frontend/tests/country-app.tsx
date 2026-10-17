import { createRoot } from 'react-dom/client';
import maplibre from 'maplibre-gl';
import App from '../src/App';
import '../src/index.css';

const original = maplibre.Map.prototype.addSource;
maplibre.Map.prototype.addSource = function (...args) {
  (window as unknown as { testMap: maplibre.Map }).testMap = this;
  return original.apply(this, args);
};
createRoot(document.getElementById('root')!).render(<App />);
