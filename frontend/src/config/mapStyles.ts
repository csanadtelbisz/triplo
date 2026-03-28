const mapyApiKey = import.meta.env.VITE_MAPY_API_KEY || '';

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

export const MAP_STYLES: Record<string, { name: string, url: any, attribution?: string }> = {
  mapy_outdoor: {
    name: 'Mapy.com',
    url: {
      version: 8,
      sources: {
        mapy: {
          type: 'raster',
          tiles: [`https://api.mapy.com/v1/maptiles/outdoor/256/{z}/{x}/{y}?apikey=${mapyApiKey}`],
          tileSize: 256,
          attribution: '&copy; <a href="https://api.mapy.com/copyright" target="_blank" rel="noreferrer">Seznam.cz a.s. and others</a>'
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
    url: 'https://tiles.openfreemap.org/styles/liberty',
    attribution: '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> &copy; <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'
  },
  osm: {
    name: 'OpenStreetMap',
    url: {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '&copy; OpenStreetMap Contributors'
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
    url: {
      version: 8,
      sources: {
        opentopomap: {
          type: 'raster',
          tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)'
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
