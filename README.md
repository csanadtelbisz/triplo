# Triplo

Triplo is a personal trip logger and route planner for journeys that combine
different transport modes. It runs entirely in the browser, with a React and
TypeScript interface, MapLibre maps, and Turf.js geometry utilities. Maps,
routing, and cloud storage are accessed directly through third-party APIs;
there is no application backend to run.

[Open Triplo](https://csanadtelbisz.github.io/triplo/)

## What you can do

- Build trips from ordered segments and waypoints, combining walking, hiking,
  running, cycling, road travel, rail, flights, ferries, and custom modes.
- Edit waypoints on the map, choose routing services per segment, and view
  distances and elevation profiles when elevation data is available.
- Import GPX or GeoJSON tracks into segments and export trips or segments as GPX.
- Search for places and points of interest, switch base maps, and customize
  transport icons, route styling, and light/dark appearance.
- View distance and climate-impact analytics by year, country and transport mode, and filter trips by date.
- Define reusable climate profiles, choose transport-mode and trip defaults, and customize segment estimates in kg CO₂e per traveller.
- Save trips and preferences to Google Drive or GitHub, resolve sync conflicts,
  and share read-only trip links.

## Country analytics

Country analytics adds a globe toggle above transport modes. Select a country
to crop routes and waypoint markers to it; select a mode to narrow the results.
Flights are entirely **Unassigned** and teleport segments contribute no distance.
Yearly distances retain proportional allocation across inclusive trip days.
Date filters use trip overlap; they do not infer the date of a border crossing.

The full yearly chart remains visible as context. Browser Back/Forward restores
country, mode, date, and segment-detail selections. Clearing a country or mode
returns to its parent level; Back from an unselected list returns to the trip
manager. View toggles and date changes replace the current entry. Calculations
run in a worker. Shared-trip references remain metadata-only. Country files
load on demand and failures show a retry action instead of being counted as
Unassigned. Disconnected route pieces retain their segment identity. Country
zoom uses a relevant land component when an entity spans distant islands.

Each completed segment stores an ordered `countryParts` array. Each part has a
country code, GeoJSON `geometry`, and `distanceStats` (kilometres and elevation).
Together the parts replace the segment's full `geometry`, aggregate
`distanceStats`, and old `countryDistances`; the full route is not duplicated.
Re-entry stays in route order, for example HU → SK → HU. Waypoints and their
`waypointDistances` remain unchanged. Imported GPX tracks retain their full
source geometry, including portions outside the current waypoints; only the
traversed portions contribute country statistics and map cropping.

A bounded A → B → A excursion is attributed entirely to A when its whole path
stays within 10 metres of A. The check includes the interiors of sparse edges,
not just recorded vertices, and conservatively retains uncertain excursions.
It changes country attribution without moving or discarding route coordinates.
Unassigned pieces, disconnected pieces, deeper excursions, and one-way border
crossings are not merged. Markers follow the nearest traversed country piece;
ties between countries remain Unassigned.

One `countryDataRevision` per trip identifies the boundary catalog, splitting
rules, geometry rules, and 10 m tolerance. It is updated only after every
segment has been processed with that revision. Saved current parts provide
country distances and cropped maps in a fresh browser without downloading
boundary polygons. There are no coordinate hashes or persistent browser
country-result caches; the previous preview's result database is discarded.
The normal browser trip storage and temporary map geometry remain.

Legacy trip files stay readable. After routing, the new full geometry is drawn
immediately using the legacy layout. Background conversion replaces it with
country parts; a newer route edit cancels or discards older work. Saving before
conversion finishes writes a valid unsplit route. On a boundary/rule update,
the worker rebuilds parts before stamping the new trip revision.

Calculations run after loading and normal geometry, mode, or waypoint changes,
including routing and track imports, independently of Analytics visibility.
Available results update every 500 ms with the current trip name. Completed
rows remain visible while other trips are processed. Representation changes
preserve map routes and markers outside country selection and add no undo step.
Countries use Overture's English names, share transport-table styling, and list
Unassigned last. The header counts countries with positive distance in the
current period, excluding Unassigned. Overture's logo and attribution appear
under **System Status → Other providers**.

Save or Save All writes country parts through connected storage providers,
including for owned shared trips. New parts remain marked unsaved across
refresh until saved; computation does not automatically save to the cloud.
Foreign shared views and references do not acquire writable country data.
Equivalent split/unsplit route representations do not create sync conflicts.
Trip files use two-space indentation with each geometry object on one compact
line, including shared copies. Startup shows **Loading country distances**
while reading saved parts and **Calculating country distances for…** during
conversion. First-use time depends on boundary downloads, route vertex counts,
and device speed; detailed tracks can take longer than sparse routes.

See [boundary preparation and updates](scripts/boundaries/README.md) for the
reproducible Overture pipeline, checksums, validation report, and attribution.

## Using Triplo and storing trips

On first launch, choose **Explore Triplo** to try the app without connecting an
account, set up a storage service, or fetch an existing setup. Trips are cached
in IndexedDB and local settings are kept in browser storage. Browser-only data
can be lost when site data is cleared, so connect storage or export trips you
want to keep.

- **Google Drive:** Sign in and select a folder name (default: `Triplo Trips`).
  Triplo saves each trip as `<id>.triplo.json` in that folder.
- **GitHub:** Enter a storage repository as `owner/repository` and a personal
  access token. A fine-grained token needs **Contents: read and write** access to
  that repository. Trip files are saved under `trips/<id>.triplo.json`. For
  sharing through Gists, configure a share token with Gist access in the GitHub
  storage settings.

Both providers can also store preferences and custom style scripts. The native
trip format is the `Trip` object defined in [shared/types.ts](shared/types.ts),
with GeoJSON segment geometry. Sharing uses a publicly readable Google Drive
file or an unlisted GitHub Gist; anyone with the share link can view it.

Mapy and GraphHopper use your own API keys, configured through the setup wizard
or the app's API key dialogs. These keys are stored in browser preferences and
synced as plain text to connected storage, so use trusted, private storage.

## Maps and routing

| Service | Current support | Configuration |
| --- | --- | --- |
| OpenFreeMap | Default vector base map | No API key |
| OpenStreetMap / OpenTopoMap | Alternative raster base maps | No API key |
| Mapy.com | Outdoor map tiles and routing, including walking and hiking | [Mapy API key](https://developer.mapy.com/account/projects) |
| GraphHopper | Road, bicycle, foot, and ferry routing profiles | [GraphHopper API key](https://graphhopper.com/dashboard/api-keys) |
| Flight / Straight Router | Great-circle flights, straight lines, and teleport segments | Runs locally without a key |
| Rail Router | Placeholder; currently unavailable, with straight-line fallback | No railway-network routing is implemented |

When a selected routing service is unavailable, the routing manager falls back
to straight lines. A displayed rail segment therefore does not imply that its
geometry follows railway tracks.

Triplo includes an installable web app manifest. Its current service worker does
not cache the application or map tiles for offline use; browser trip storage
alone does not provide a complete offline experience.

## Local development

Use **Node.js 24** (the version used in CI), npm, and a browser with WebGL support.
The package manifest and lockfile are in `frontend/`. **Run all npm and npx
commands from that directory.**

```sh
git clone https://github.com/csanadtelbisz/triplo.git
cd triplo/frontend
npm ci
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`. You can explore
without credentials; cloud storage and key-based services are optional.

### Optional environment configuration

For a local instance, put optional values in `frontend/.env.local` and restart
Vite after changing them. This file is ignored by Git.

| Variable | Purpose |
| --- | --- |
| `VITE_GOOGLE_CLIENT_ID` | Google Identity Services OAuth client ID for Drive sign-in |
| `VITE_GOOGLE_DRIVE_API_KEY` | Load publicly shared Drive trips without signing in |
| `VITE_MAPY_API_KEY` | Default Mapy key when no browser preference overrides it |
| `VITE_GRAPHHOPPER_API_KEY` | Default GraphHopper key when no browser preference overrides it |

For Google Drive, enable the Google Drive API in your Google Cloud project and
configure a web OAuth client with the app's origin (for example,
`http://localhost:5173`) as an authorized JavaScript origin. The app requests the
`drive.file` scope. `VITE_*` values are included in the browser bundle and are
public client configuration, not server-side secrets.

### Build and checks

With `frontend/` as the working directory:

```sh
npm run build
npx playwright install chromium
npm test
npm run lint
```

- `npm run build` runs TypeScript checks and creates the static site in
  `frontend/dist/`. `npm run preview` serves that build locally.
- `npm test` runs the Playwright browser tests and starts Vite automatically.
  The tests use a real MapLibre map with local fixtures, without external tile
  services. On Linux, use `npx playwright install --with-deps chromium` if browser
  system dependencies are missing. Alternatively, set
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed Chromium executable.
- `npm run lint` runs ESLint; the repository currently has existing lint findings.

## Project layout

| Path | Contents |
| --- | --- |
| [frontend/src/components/](frontend/src/components/) | Map, trip editor, setup, preferences, and analytics UI |
| [frontend/src/routing/](frontend/src/routing/) | Routing manager and provider implementations |
| [frontend/src/persisting/](frontend/src/persisting/) | Google Drive and GitHub storage integrations |
| [frontend/src/utils/](frontend/src/utils/) | Import/export, geometry, preferences, and sharing helpers |
| [frontend/src/config/](frontend/src/config/) | Base maps and map layer configuration |
| [frontend/src/styles/](frontend/src/styles/) | Application styles, including mobile layouts |
| [frontend/public/](frontend/public/) | Manifest, service worker, icons, and Pages route fallback |
| [frontend/tests/](frontend/tests/) | Playwright browser tests and fixtures |
| [shared/types.ts](shared/types.ts) | Trip, segment, and waypoint data types |
| [.github/workflows/](.github/workflows/) | Validation and GitHub Pages deployments |

See [REQUIREMENTS.md](REQUIREMENTS.md) for implemented functionality, data formats,
and architecture, and [UI.md](UI.md) for the interface and interaction flows.
Agent working instructions are in [AGENTS.md](AGENTS.md).

## Deployment and pull request previews

[deploy.yml](.github/workflows/deploy.yml) publishes to GitHub Pages on pushes to
`master` or `main`, or through a manual workflow run. The repository's Pages
source must be **GitHub Actions**. The workflow builds the default branch with
the `/triplo/` base path. For an equivalent local build, run
`npm run build -- --base=/triplo/` from `frontend/`.

[pr-preview.yml](.github/workflows/pr-preview.yml) builds and tests pull requests.
Branches in this repository also get a preview at
`https://csanadtelbisz.github.io/triplo/pr-preview/pr-<number>/`; fork PRs run
validation only. After a successful preview deployment, a PR comment links to
the deployed preview and identifies its commit. Subsequent deployments update
that comment. Links also appear on the deployment and in the job summary.

GitHub Pages hosts one site per repository, so each deployment includes the
default-branch production build and all open same-repository PR previews.
Closing a PR removes its preview on the next successful deployment.

For Drive support on production, configure the repository Actions secrets
`VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_DRIVE_API_KEY`. These values are omitted
from preview builds, so previews support exploration and GitHub storage but not
Google Drive sign-in or loading shared Drive trips.
