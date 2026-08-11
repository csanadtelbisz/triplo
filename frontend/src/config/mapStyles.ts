import mapyIcon from '../assets/icons/mapy.png';
import openfreemapIcon from '../assets/icons/openfreemap.png';
import openstreetmapIcon from '../assets/icons/openstreetmap.png';
import opentopomapIcon from '../assets/icons/opentopomap.png';
import { getApiKey, MAPY_API_CONFIGURATION } from '../utils/apiKeyPreferences';
import type { ApiKeyServiceConfiguration } from '../utils/apiKeyPreferences';


export const MARKER_HIDE_THRESHOLD = 30;

// Define our target vector tile POI layers based on zoomed tiers
export const POI_LAYERS: any[] = [
  // Tier 1: Zoom >= 10: major peaks, passes, lakes (handled via generic poi classes where applicable in openmaptiles)
  {
    id: 'triplo-poi-peaks',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'mountain_peak',
    minzoom: 10,
    layout: {
      'text-field': ['get', 'name'],
      'icon-image': ['case', ['!', ['has', 'name']], 'poi-natural-rock', ['==', ['get', 'name'], ''], 'poi-natural-rock', 'poi-peak-peak'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 11,
      'text-offset': [0, 0.6],
      'text-anchor': 'top'
    },
    paint: {
      'text-color': '#555555',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1
    }
  },
  {
    id: 'triplo-poi-lakes',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'water_name',
    minzoom: 10,
    filter: ['all', ['==', 'class', 'lake']],
    layout: {
      'text-field': ['get', 'name'],
      'icon-image': 'poi-water-lake',
      'text-font': ['Noto Sans Italic'],
      'text-size': 11,
      'text-offset': [0, 0.6],
      'text-anchor': 'top'
    },
    paint: {
      'text-color': '#0066cc',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1
    }
  },
  // Tier 2: Zoom >= 13: huts, viewpoints, campsites, historic sites
  {
    id: 'triplo-poi-tier2',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'poi',
    minzoom: 13,
    filter: ['any',
      ['==', 'class', 'campsite'],
      ['==', 'subclass', 'alpine_hut'],
      ['==', 'subclass', 'viewpoint'],
      ['==', 'class', 'historic']
    ],
    layout: {
      'text-field': ['get', 'name'],
      'icon-image': ['concat', 'poi-', ['coalesce', ['get', 'class'], 'none'], '-', ['coalesce', ['get', 'subclass'], 'none']],
      'text-font': ['Noto Sans Regular'],
      'text-size': 11,
      'text-offset': [0, 0.6],
      'text-anchor': 'top'
    },
    paint: {
      'text-color': '#8B4513',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1
    }
  },
  // Tier 3: Zoom >= 15: everything else (amenities, shops, etc.)
  {
    id: 'triplo-poi-tier3',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'poi',
    minzoom: 15,
    filter: ['none',
      ['==', 'class', 'campsite'],
      ['==', 'subclass', 'alpine_hut'],
      ['==', 'subclass', 'viewpoint'],
      ['==', 'class', 'historic']
    ],
    layout: {
      'text-field': ['get', 'name'],
      'icon-image': ['concat', 'poi-', ['coalesce', ['get', 'class'], 'none'], '-', ['coalesce', ['get', 'subclass'], 'none']],
      'text-font': ['Noto Sans Regular'],
      'text-size': 10,
      'text-offset': [0, 0.6],
      'text-anchor': 'top'
    },
    paint: {
      'text-color': '#666666',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1
    }
  }
];

export const MAP_STYLES: Record<string, { name: string, url: any, attribution?: string, icon?: string, apiKeyConfiguration?: ApiKeyServiceConfiguration }> = {
  mapy_outdoor: {
    name: 'Mapy.com',
    icon: mapyIcon,
    apiKeyConfiguration: MAPY_API_CONFIGURATION,
    url: {
      version: 8,
      sources: {
        mapy: {
          type: 'raster',
          tiles: ['https://api.mapy.com/v1/maptiles/outdoor/256/{z}/{x}/{y}?apikey={triploApiKey}'],
          tileSize: 256,
          attribution: '&copy; <a href="https://api.mapy.com/copyright" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">Seznam.cz a.s. and others</a>'
        }
      },
      layers: [
        {
          id: 'mapy',
          type: 'raster',
          source: 'mapy'
        }
      ]
    }
  },
  openfreemap: {
    name: 'OpenFreeMap',
    icon: openfreemapIcon,
    url: 'https://tiles.openfreemap.org/styles/liberty',
    attribution: '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> &copy; <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'
  },
  osm: {
    name: 'OpenStreetMap',
    icon: openstreetmapIcon,
    url: {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> Contributors'
        }
      },
      layers: [
        {
          id: 'osm',
          type: 'raster',
          source: 'osm'
        }
      ]
    }
  },
  opentopomap: {
    name: 'OpenTopoMap',
    icon: opentopomapIcon,
    url: {
      version: 8,
      sources: {
        opentopomap: {
          type: 'raster',
          tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>, <a href="https://www2.jpl.nasa.gov/srtm/" target="_blank" rel="noreferrer">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org/" target="_blank" rel="noreferrer">OpenTopoMap (CC-BY-SA)</a>'
        }
      },
      layers: [
        {
          id: 'opentopomap',
          type: 'raster',
          source: 'opentopomap'
        }
      ]
    }
  }
};

export function getMapStyleUrl(styleId: string) {
  const style = MAP_STYLES[styleId];
  if (styleId !== 'mapy_outdoor' || typeof style?.url === 'string') return style?.url;
  return {
    ...style.url,
    sources: {
      ...style.url.sources,
      mapy: {
        ...style.url.sources.mapy,
        tiles: [`https://api.mapy.com/v1/maptiles/outdoor/256/{z}/{x}/{y}?apikey=${getApiKey('mapyApiKey')}`],
      },
    },
  };
}
