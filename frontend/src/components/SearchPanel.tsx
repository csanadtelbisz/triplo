import { useState, useEffect } from 'react';
import { MaterialIcon } from './MaterialIcon';

export interface NominatimResult {
  place_id: number;
  osm_type?: string;
  osm_id?: number;
  lat: string;
  lon: string;
  display_name: string;
  class: string;
  type: string;
  name?: string;
  namedetails?: Record<string, string>;
}

interface SearchPanelProps {
  onGoBack: () => void;
  onResultClick: (result: NominatimResult | [number, number]) => void;
}

const parseCoordinates = (query: string): [number, number] | null => {
  // Simple check for lat, lon or lon, lat formats
  const match = query.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (match) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    if (!isNaN(lat) && !isNaN(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return [lon, lat];
    }
  }
  return null;
};

export const SearchPanel = ({ onGoBack, onResultClick }: SearchPanelProps) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const coords = parseCoordinates(query);
    if (coords) {
      onResultClick(coords);
      return;
    }

    if (!query.trim()) {
      setResults([]);
      return;
    }

    const timerId = setTimeout(async () => {
      setIsSearching(true);
      setError(null);
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&namedetails=1&q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data);
      } catch (err) {
        setError('Error fetching results');
      } finally {
        setIsSearching(false);
      }
    }, 1000);

    return () => clearTimeout(timerId);
  }, [query, onResultClick]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="toolbar">
        <button className="iconButton" onClick={onGoBack} title="Close Search">
          <MaterialIcon name="arrow_back" size={20} />
        </button>
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Search</h2>
        <div style={{ width: 28 }}></div>
      </div>
      
      <div className="content">
        <div className="form-group">
          <input
            type="text"
            placeholder="Search name, address or coordinates..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="form-input"
          />
        </div>
        
        {isSearching && <div style={{ fontSize: '0.9rem', color: '#666', marginTop: '8px' }}>Searching...</div>}
        {error && <div style={{ fontSize: '0.9rem', color: 'red', marginTop: '8px' }}>{error}</div>}
        {!isSearching && !error && query.trim() !== '' && results.length === 0 && parseCoordinates(query) === null && (
          <div style={{ fontSize: '0.9rem', color: '#666', marginTop: '8px' }}>No results.</div>
        )}
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
          {results.map(result => (
            <div
              key={result.place_id}
              onClick={() => onResultClick(result)}
              style={{
                padding: '12px', 
                border: '1px solid #eee', 
                borderRadius: '6px',
                cursor: 'pointer',
                backgroundColor: 'white',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f9f9f9'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'white'}
            >
              <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '4px' }}>
                {result.name || result.display_name.split(',')[0]}
              </div>
              <div style={{ fontSize: '12px', color: '#666', lineHeight: 1.4 }}>
                {result.display_name}
              </div>
              <div style={{ fontSize: '11px', color: '#999', marginTop: '6px', textTransform: 'capitalize' }}>
                {[result.class, result.type].filter(Boolean).join(' - ').replace(/_/g, ' ')}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
