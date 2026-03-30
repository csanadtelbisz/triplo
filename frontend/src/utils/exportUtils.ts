import type { Trip, Segment, Waypoint } from '../../../shared/types';
import { ModeThemes } from '../themes/config';

export function exportGPX(segment: Segment, trip?: Trip, includeAppMetadata: boolean = true): string {
  let gpx = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  gpx += `<gpx version="1.1" creator="Triplo" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd"`;
  
  if (includeAppMetadata) {
    gpx += ` xmlns:triplo="http://triplo.app"`;
  }
  gpx += `>\n`;

  if (trip) {
    gpx += `  <metadata>\n    <name><![CDATA[${escapeXml(trip.name)}]]></name>\n`;
    if (trip.description) gpx += `    <desc><![CDATA[${escapeXml(trip.description)}]]></desc>\n`;
    gpx += `  </metadata>\n`;
  } else if (segment.name) {
    gpx += `  <metadata>\n    <name><![CDATA[${escapeXml(segment.name)}]]></name>\n  </metadata>\n`;
  }

  // Add waypoints
  for (const wp of segment.waypoints) {
    gpx += buildWaypointXml(wp, includeAppMetadata);
  }

  // Add track
  gpx += `  <trk>\n`;
  if (segment.name) gpx += `    <name><![CDATA[${escapeXml(segment.name)}]]></name>\n`;
  if (segment.transportMode) {
    gpx += `    <type>${segment.transportMode}</type>\n`;
  }

  if (includeAppMetadata) {
    gpx += `    <extensions>\n`;
    if (segment.customColor) gpx += `      <triplo:color>${segment.customColor}</triplo:color>\n`;
    if (segment.customIcon) gpx += `      <triplo:icon>${segment.customIcon}</triplo:icon>\n`;
    gpx += `    </extensions>\n`;
  }

  gpx += `    <trkseg>\n`;
  if (segment.geometry && segment.geometry.coordinates) {
    for (const coord of segment.geometry.coordinates) {
      gpx += `      <trkpt lat="${coord[1]}" lon="${coord[0]}">`;
      if (coord.length > 2 && coord[2] !== undefined) {
        gpx += `<ele>${coord[2]}</ele>`;
      }
      gpx += `</trkpt>\n`;
    }
  }
  gpx += `    </trkseg>\n`;
  gpx += `  </trk>\n`;
  
  gpx += `</gpx>`;
  return gpx;
}

export function exportTripGPX(trip: Trip, includeAppMetadata: boolean = true): string {
  let gpx = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  gpx += `<gpx version="1.1" creator="Triplo" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd"`;
  
  if (includeAppMetadata) {
    gpx += ` xmlns:triplo="http://triplo.app"`;
  }
  gpx += `>\n`;

  gpx += `  <metadata>\n    <name><![CDATA[${escapeXml(trip.name)}]]></name>\n`;
  if (trip.description) gpx += `    <desc><![CDATA[${escapeXml(trip.description)}]]></desc>\n`;
  gpx += `  </metadata>\n`;

  const writtenWpIds = new Set<string>();

  for (const segment of trip.segments) {
    for (const wp of segment.waypoints) {
      if (!writtenWpIds.has(wp.id)) {
        writtenWpIds.add(wp.id);
        gpx += buildWaypointXml(wp, includeAppMetadata);
      }
    }
  }

  for (const segment of trip.segments) {
    gpx += `  <trk>\n`;
    const label = segment.name || `Segment ${segment.id.slice(0, 8)}`;
    gpx += `    <name><![CDATA[${escapeXml(label)}]]></name>\n`;
    if (segment.transportMode) {
      gpx += `    <type>${segment.transportMode}</type>\n`;
    }

    if (includeAppMetadata) {
      gpx += `    <extensions>\n`;
      const color = segment.customColor || ModeThemes[segment.transportMode]?.color;
      if (color) gpx += `      <triplo:color>${color}</triplo:color>\n`;
      if (segment.customIcon) gpx += `      <triplo:icon>${segment.customIcon}</triplo:icon>\n`;
      gpx += `    </extensions>\n`;
    }

    gpx += `    <trkseg>\n`;
    if (segment.geometry && segment.geometry.coordinates) {
      for (const coord of segment.geometry.coordinates) {
        gpx += `      <trkpt lat="${coord[1]}" lon="${coord[0]}">`;
        if (coord.length > 2 && coord[2] !== undefined) {
          gpx += `<ele>${coord[2]}</ele>`;
        }
        gpx += `</trkpt>\n`;
      }
    }
    gpx += `    </trkseg>\n`;
    gpx += `  </trk>\n`;
  }

  gpx += `</gpx>`;
  return gpx;
}

export function exportTripGeoJSON(trip: Trip, includeAppMetadata: boolean = true, minify: boolean = false): string {
  const geojson: any = {
    type: "FeatureCollection",
    properties: {
       name: trip.name,
       description: trip.description
    },
    features: []
  };

  const writtenWpIds = new Set<string>();

  for (const segment of trip.segments) {
    for (const wp of segment.waypoints) {
      if (!writtenWpIds.has(wp.id)) {
        writtenWpIds.add(wp.id);
        const feature: any = {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: wp.coordinates
          },
          properties: {
            name: wp.name,
            description: wp.description,
          }
        };
        if (includeAppMetadata) {
          feature.properties.id = wp.id;
          if (wp.date) feature.properties.date = wp.date;
          if (wp.icon) feature.properties.icon = wp.icon;
          if (wp.picture) feature.properties.picture = wp.picture;
          if (wp.poi) feature.properties.poi = wp.poi;
        }
        geojson.features.push(feature);
      }
    }

    if (segment.geometry) {
      const feature: any = {
        type: "Feature",
        geometry: segment.geometry,
        properties: {
          name: segment.name || `Segment ${segment.id.slice(0, 8)}`,
          transportMode: segment.transportMode
        }
      };
      if (includeAppMetadata) {
        feature.properties.id = segment.id;
        feature.properties.routingProfile = segment.routingProfile;
        feature.properties.routingService = segment.routingService;
        feature.properties.source = segment.source;
        if (segment.customColor) feature.properties.customColor = segment.customColor;
        if (segment.customIcon) feature.properties.customIcon = segment.customIcon;
      }
      geojson.features.push(feature);
    }
  }

  return minify ? JSON.stringify(geojson) : JSON.stringify(geojson, null, 2);
}

function buildWaypointXml(wp: Waypoint, includeAppMetadata: boolean): string {
  let xml = `  <wpt lat="${wp.coordinates[1]}" lon="${wp.coordinates[0]}">\n`;
  if ((wp.coordinates as any).length > 2 && (wp.coordinates as any)[2] !== undefined) {
      xml += `    <ele>${(wp.coordinates as any)[2]}</ele>\n`;
  }
  if (wp.name) xml += `    <name><![CDATA[${escapeXml(wp.name)}]]></name>\n`;
  if (wp.description) xml += `    <desc><![CDATA[${escapeXml(wp.description)}]]></desc>\n`;
  
  if (includeAppMetadata) {
    xml += `    <extensions>\n`;
    xml += `      <triplo:id>${wp.id}</triplo:id>\n`;
    if (wp.icon) xml += `      <triplo:icon>${wp.icon}</triplo:icon>\n`;
    if (wp.date) xml += `      <triplo:date>${wp.date}</triplo:date>\n`;
    if (wp.poi) xml += `      <triplo:poi>${escapeXml(JSON.stringify(wp.poi))}</triplo:poi>\n`;
    xml += `    </extensions>\n`;
  }
  xml += `  </wpt>\n`;
  return xml;
}

function escapeXml(unsafe: string): string {
  return (unsafe || '').replace(/[<>&'"]/g, function (c) {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case "'": return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}