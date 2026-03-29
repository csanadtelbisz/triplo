# Triplo Trip Logger — Requirements & Architecture Summary

Triplo is a personal trip logging web app that displays multi-modal travel routes on a detailed map,
with support for manual route planning between waypoints per transport mode.

---

## Functional Requirements

### Core Features

- Log travel trips as a sequence of **segments**, each with a **transport mode**.
- Each segment is defined by a series of **waypoints**; the route between them is
  automatically computed by a routing engine appropriate for that mode.
- Support for recording trips after the fact (no live GPS tracking required).
- View trips on an interactive map with OpenStreetMap/OpenTopoMap-quality tile detail (required for hikes and other activities needing topographic context).

### Transport Modes & Routing Strategy

| Display Mode | Routing Mode | Routing Engine | Notes |
|---|---|---|---|
| Walk | Foot | GraphHopper (`foot` profile) | |
| Hike | Foot | GraphHopper (`hike` profile) | More detailed display label |
| Run | Foot | GraphHopper (`foot` profile) | More detailed display label |
| Car | Car | GraphHopper (`car` profile) | |
| Flight | N/A — geometric | Turf.js `greatCircle` | Great-circle arc, no routing engine needed |
| Train | Rail | OpenRailRouting (`train` profile) | Routes constrained to railway tracks |
| Light Rail / Tram | Rail | OpenRailRouting (`light_rail`/`tram` profile) | |
| Ferry | Ferry | GraphHopper (`ferry` profile) | Follows OSM ferry lines; falls back to water direct path |
| Waterway (non-ferry) | Water | GraphHopper or shortest water path | Follow waterway if OSM data available |

The `transportMode` field (see Data Model below) stores the user-facing label,
while `routingMode` determines which engine and profile to call.

### Waypoints

Each waypoint supports the following properties:

| Property | Type | Notes |
|---|---|---|
| `id` | UUID | Auto-generated |
| `coordinates` | `[lon, lat]` | WGS84 |
| `name` | string (optional) | Display name |
| `description` | string (optional) | Free text |
| `date` | ISO 8601 datetime (optional) | When the waypoint was visited |
| `importance` | `"normal"` \| `"hidden"` | Hidden waypoints guide routing but are not rendered on the map (or rendered with different style scheme) |
| `icon` | string (optional) | Icon identifier or URL |
| `picture` | URL (optional) | Link to Google Photos or other image hosting |

### Segments

Each segment connects two or more waypoints and supports:

| Property | Type | Notes |
|---|---|---|
| `id` | UUID | Auto-generated |
| `transportMode` | string | User-facing label: `walk`, `hike`, `run`, `bike`, `car`, `flight`, `rail`, `ferry`, `waterway`, etc. Extensible. |
| `routingMode` | string | Internal: which engine+profile was used |
| `source` | `"router"` \| `"gpx"` \| `"manual"` | Whether geometry came from a routing engine, an imported GPX track, or was drawn manually |
| `routerService` | string (optional) | e.g. `"graphhopper_api"`, `"graphhopper_self_hosted"`, `"openrailrouting"` |
| `geometry` | GeoJSON LineString | The resolved route (stored after routing) |
| `waypoints` | array of Waypoint refs | Ordered list |
| `name` | string (optional) | |

### Trips

A trip is a named, ordered collection of segments. The last waypoint of a segment must be the same as the first waypoint of the next segment.

| Property | Type |
|---|---|
| `id` | string |
| `name` | string |
| `description` | string (optional) |
| `startDate` | date |
| `endDate` | date |
| `segments` | ordered array of Segment |
| `createdAt` | ISO 8601 |
| `updatedAt` | ISO 8601 |

The data model may be extended later with further properties.

---

## Data Format

- Primary storage: **GeoJSON FeatureCollection** per trip.
  - Waypoints → `Feature<Point>` with properties as above.
  - Segments → `Feature<LineString>` with properties as above.
- GPX import/export supported as a secondary format (see below).
- All data stored as files. The architecture of the application should allow easy integration of a lightweight database (SQLite or PostgreSQL+PostGIS) later on, if needed.
- Each trip is stored in a separate json file (e.g., `<trip id>.json`), stored in arbitrary directories in the file system. The root directories can be specified in the application configurations: the backend storage service should scan these root directories recursively for any appropriate JSON files.

### GPX Support

- **Import:** A GPX track can be imported as a new segment. The track geometry is used
  directly (source = `"gpx"`); no routing engine is called.
- **Export:** Any trip or segment can be exported as a `.gpx` file.
  Track segments map to `<trkseg>` elements; waypoints map to `<wpt>` elements.
  Elevation data (`<ele>`) is preserved if present in the GeoJSON geometry (3D coordinates).

---

## Architecture & Stack

### Frontend (Web)

| Concern | Choice | Notes |
|---|---|---|
| Map rendering | **MapLibre GL JS** | WebGL-accelerated, support both vector and raster tiles, GPU-smooth zoom/pan/rotate, good mobile performance |
| Base map tiles | **OpenFreeMap** (vector) | Free, no API key, OpenStreetMap data |
| Topo overlay | **OpenTopoMap** raster tiles | Layered on top of vector base for hike detail |
| Other map tiles | E.g., **Mapy.com** | Other map tile provider APIs should be easy to integrate later on |
| UI framework | **React** | MapLibre has React bindings |
| Map editing tools | **Terra Draw** | Waypoint placement, route preview editing |
| Geometry utilities | **Turf.js** | Great-circle arcs for flights, bounding boxes, etc. |
| GPX conversion | **@we-gold/gpxjs** | GPX import and export |

**Style customisation:** MapLibre GL JS uses a declarative JSON style spec. Transport mode
styles (line colour, width, dash pattern, icon) are defined in a single `style.json` (or
equivalent JS object) and can be freely customised per mode. A dedicated
`themes/` directory should contain one style config per visual theme.

### Routing Backend

The routing layer is abstracted behind a single `RoutingService` interface so that the
underlying provider can be swapped without touching the rest of the app.

```
interface RoutingService {
  route(waypoints: LatLon[], profile: RoutingProfile): Promise<GeoJSON.LineString>
}
```

Concrete implementations:

| Implementation | Used for | Notes |
|---|---|---|
| `GraphHopperApiRouter` | Car, foot, ferry | Calls `https://graphhopper.com/api/1/route` with API key |
| `GraphHopperSelfHostedRouter` | Car, foot, ferry | Same interface, points to `http://localhost:8989` |
| `OpenRailRoutingRouter` | Train, tram, light rail | Self-hosted; same GraphHopper HTTP API format |
| `TurfGreatCircleRouter` | Flights | Pure client-side, no network call |

Switching from hosted to self-hosted GraphHopper requires only changing the base URL and
removing the API key — both use the identical HTTP REST API.

#### Self-Hosted Routing Notes

- **GraphHopper:** Java service; input is an OSM `.pbf` extract from Geofabrik.
  Docker image from Docker Hub.
  RAM for import scales with region size (~4 GB for a small country, ~16 GB for Germany).
  After one-time import, server RAM is much lower. Use MMAP mode to reduce runtime RAM.
  *Future plan, first version should use the GraphHopper API not self-hosted.*
- **OpenRailRouting:** GraphHopper fork; same setup procedure, uses same OSM data but routes only on railway infrastructure. As no public API available, must be self-hosted from the start.
- **Recommended approach:** Download per-country `.pbf` extracts from Geofabrik and merge with `osmium merge` for only the countries traveled in.
- **Docker Compose:** A `docker-compose.yml` in `/infra/` should define both services with shared volume mounts for OSM data and pre-built graph directories.

### Backend / API

A lightweight backend is needed to:
1. Serve and persist trip data (read/write GeoJSON files).
2. Proxy routing API calls (to keep the GraphHopper API key server-side).
3. (Optional) Serve the PWA static files.

Suggested: **Node.js + Fastify** or **Python + FastAPI**. Stateless, single binary, easily (but not necessarily) Dockerised.

### Mobile

- PWA — the web app served with a web manifest. Works in mobile browsers. MapLibre GL JS performs well on mobile. Editing is possible but less ergonomic.
- For mobile, viewing existing trips in an ergonomic way is important.
- Editing on PC is the primary UX target; mobile editing is a nice-to-have.

---

## Non-Functional Requirements

- **Open source preferred** throughout the stack.
- **Extensible data model:** `transportMode` and properties on waypoints/segments are open strings/objects to allow adding new modes and metadata fields without schema changes.
- **Style customisability:** All visual styling of routes, waypoints, and icons is driven by a config file, not hardcoded.

---

## Suggested Repository Structure

```
/
├── src/
│   ├── api/           # Backend API client
│   ├── routing/       # RoutingService interface + implementations
│   ├── data/          # GeoJSON & GPX import/export, data model types
│   ├── map/           # MapLibre GL JS setup, layer management
│   ├── editor/        # Waypoint/segment editing UI
│   └── themes/        # MapLibre style configs per visual theme
├── server/            # Thin backend (Fastify or FastAPI)
├── infra/
│   └── docker-compose.yml   # self-hosted future routing services
├── public/            # PWA manifest, icons
└── README.md          # General README
└── REQUIREMENTS.md    # This file
└── UI.md              # UI specification
```

---

## Key External Dependencies

| Package | Purpose |
|---|---|
| `maplibre-gl` | Map rendering |
| `turf` | Geometric utilities, great-circle arcs |
| `@we-gold/gpxjs` | GPX import/export |
| `terra-draw` | Map editing / waypoint placement |
| GraphHopper API | Car, foot, ferry routing (hosted, free tier available) |
| OpenRailRouting | Train routing (self-hosted) |
| OpenFreeMap | Vector base tiles (free, no key) |
| OpenTopoMap | Raster topo tiles (free, tile usage policy applies) |
