# Triplo interface and interactions

This document describes the current interface. See [README.md](README.md) for
setup and [REQUIREMENTS.md](REQUIREMENTS.md) for functionality, data formats, and
architecture. Implementation starts in [App.tsx](frontend/src/App.tsx) and the
[components](frontend/src/components/) directory.

## Layout and navigation

On desktop, a collapsible left sidebar sits beside the map. It shows the trip
manager, trip editor, detail panels, search, analytics, preferences, or system
status. Panel navigation is reflected in browser history, and panels expose
back or close controls. Analytics Back goes through segment details, mode,
country, the unselected list, and the trip manager as applicable. Clearing a
selection returns to its parent; it does not add a step that Back reactivates.
The globe toggle changes the view at the current list level.

At widths up to 768 px, the sidebar becomes a bottom sheet over the map. Its
drag handle can be tapped to expand or dragged to expand/collapse; downward
swipes on the toolbar or at the top of scrollable content also collapse it.
Search expands to use the available screen, while POI details use a shorter
sheet. Mobile startup can be configured to keep the panel minimized. Layouts
account for device safe areas, and map focus actions account for panel overlap.

Toolbars use icon buttons with titles/tooltips. Icons are supplied through the
app's icon components, including Lucide, custom SVGs, and Material symbols.
Appearance can follow the system or use a light/dark theme.

## Initial setup

The setup dialog appears when no storage connection is available. It offers
first-time setup, fetching an existing setup, or **Explore Triplo** without a
cloud connection. Google Drive setup uses sign-in and a folder name; GitHub
setup requests a repository and access token. An API-key step configures Mapy
and GraphHopper and can test the supplied keys.

Exploration uses browser storage. Storage can be connected later through
**System Status**. Shared-trip links open the read-only trip view without
requiring the viewer to complete setup first.

## Map

The map displays the trip overview or the selected trip, subject to hidden
segment settings, date/mode filters, and the active render style. The default
style hides waypoint markers in the overview and hides unmarked waypoints in
read-only mode. It also hides flights in the overview unless hidden segments
are being shown. Custom styles can change these choices.

Map controls provide zoom and compass navigation, render-style selection,
hidden-segment visibility, base-map selection, and **Search POI or Coordinates**.
Provider attribution is shown on the map. Selecting a key-based map without a
configured key opens the API-key configuration flow.

Clicking a displayed route can select its trip or segment. POI selection opens
location details. When an editing action is waiting for a waypoint position,
clicking the map supplies its coordinates. In edit mode, draggable waypoint
markers update affected routed geometry. A right-click or single-finger long
press on a selected editable trip opens actions to add a point to the trip or
before its final point. A second finger cancels the waypoint long press.

### Mobile distance measurement

Hold two fingers still on the map for about 250 ms to draw a line between them
with the straight-line distance at its center. Distances greater than 1 km use
three significant digits in kilometers; shorter distances, including exactly
1 km, use whole meters. Examples include `1230 km`, `274 km`, `94.2 km`, and
`942 m`.

The measurement stays visible while the fingers remain still and for five
seconds after both lift. A new map touch, click, drag, zoom, or keyboard
interaction dismisses it. Starting another two-finger hold clears the previous
measurement before measuring again. Moving either finger hides it immediately;
pinch zoom continues to work before and after the line appears. A completed
measurement does not trigger tap-to-zoom-out on release; a subsequent short
two-finger tap retains MapLibre's normal zoom-out behavior.

## Trip manager

The manager lists local and connected-storage trips. Its toolbar provides
**New Trip**, **Analytics**, read-only mode, **Save All Unsaved Trips**,
**Preferences**, and **Status**. The connection area shows storage services,
reload, and sync-issue controls.

The display menu switches between compact and detailed cards and sorts trips
by date or name in either direction. Cards show trip information, storage/share
indicators, unsaved changes, and conflicts. Selecting a card opens the editor;
trips can also be selected from their routes on the map. Upload actions send
trips to available storage providers. Deletion requires confirmation and is
disabled in read-only mode.

When providers disagree or trips are missing from a connected service, the sync
dialog offers version selection and uploads to missing services. It also
handles differing preference versions and an option to accept the latest
versions together.

## Trip editor

The editor displays trip name, description, travel dates, and a vertical
waypoint timeline grouped into segments. Transport mode icons and colors
identify segments; waypoint names, icons, route distances, and
available elevation summaries provide context.

The toolbar includes back navigation, **Undo**, **Redo**, **Share Trip**,
**Zoom to Trip**, read-only mode, and **Save**, with availability determined by
the current trip and mode. Leaving a new temporary trip prompts before
discarding it. Unsaved edits to saved trips remain indicated in the collection;
the app also warns before unloading with unsaved trips or preferences.

Editing actions include inserting waypoints between existing points, changing
their order, removing points, and splitting segments. Segment controls select
transport modes, focus or hide the segment, open its details, adjust segment
boundaries, and delete eligible segments. Buttons are disabled where an
operation would not be valid. Shared boundary waypoints are represented across
adjacent segments and updated together.

Read-only mode hides or disables editing actions while retaining viewing and
map navigation. Shared trips are read-only. **Save trip to my trips** retains a
reference to the original share; **Make a copy** creates an independent trip.
An unavailable or revoked share is shown as unavailable rather than displaying
an old cached route.

### Sharing and download

**Share Trip** opens a dialog for enabling/disabling a share, copying the link,
and downloading the trip as GPX with optional application metadata. If more
than one storage service is connected, the app offers a sharing-service picker.
Sharing errors and progress appear in the dialog. The share link allows other
people to view the trip without editing the owner's data.

## Detail and search panels

| Panel | Current interactions |
| --- | --- |
| **Segment Info** | Edit the name, transport mode, routing profile, color, and icon; toggle map visibility; focus the segment; inspect distance/elevation; import a track or export GPX |
| **Waypoint Info** | Edit the name, description, and icon; view date/coordinates and attached POI details; copy coordinates; focus the point or add it again as the final waypoint |
| **Search** | Search Nominatim place results or enter coordinates, then open/focus the selected location |
| **POI Info** | View reverse-geocoded details, addresses and alternative names; in edit mode, add the POI to a trip, attach it to a selected waypoint, or start a trip at that location |

**Import Track** in Segment Info accepts GPX, GeoJSON, or JSON track files and
replaces that segment's geometry. A follow-up dialog offers to adjust endpoint
waypoints to the track. Imported geometry is retained until the segment is
changed back to routed geometry. Available profiles depend on transport mode,
with an option to show other profiles. Rail-related external routing links can
be opened, but Triplo's integrated Rail Router remains unavailable.

Waypoint coordinates are changed through map placement/dragging workflows.
The date and coordinate inputs currently displayed in Waypoint Info do not
have persistence handlers; they are not a separate working metadata-edit flow.

## Analytics

Analytics shows total distances by transport mode and a **Distance per Year**
chart. Selecting a mode filters the map and opens that mode's segment list;
segments can be focused on the map or opened in Segment Info, and titles can be
edited when permitted.

The globe toggle switches to countries using Overture English names. Its table
matches the transport table and keeps Unassigned last. Available country rows
stay visible during background calculation, with the current trip shown above
the table. Selecting a country reveals its modes and crops the map to it.

The time-filter button opens a floating date-range slider with daily or yearly
granularity. Date filtering affects the displayed trips/segments and map; the
slider remains accessible as the mobile sheet is collapsed. The chart supports
year selection and distance tooltips.

## Preferences and style editor

Preferences contains startup read-only/mobile-panel behavior, appearance,
map home position, ordered name-language preferences, built-in transport mode
overrides, custom modes, and style configurations. Startup behavior remains local
to the browser; synchronized settings display their cloud-sync status.

Custom modes have a name, icon, color, routing profile, and list visibility.
Built-in mode overrides expose name, color, and default routing choices. The
icon picker supports suggested and searchable icons.

Style configurations can be created, renamed, reordered, edited, and removed,
subject to read-only/default restrictions. **Style Configuration** edits the
JavaScript script and provides an information dialog documenting its context
and return functions. The map's style selector applies a configuration and
provides preview context controls while the editor is open.

## System status and connection dialogs

System Status groups **Persisting Services**, **Routing Services**, **Map Tile
Providers**, and **Browser data**. Storage cards show connected/unavailable
state and open connection settings. Routing cards show provider availability
and attribution, with key configuration for supported providers. Tile-provider
cards show their checks and key configuration where needed. These are external
service/configuration indicators, not a Triplo backend health check.

**Other providers** shows the Overture Maps logo and attribution for country boundaries.
OpenStreetMap attribution remains with map tile providers.

Storage configuration dialogs expose provider-specific settings such as a Drive
folder or GitHub repository/access/share tokens. API-key dialogs provide key
entry, setup instructions, and validation feedback. Connection dialogs also
provide disconnect actions.

**Clean Browser Data** requires confirmation and clears browser state before
reloading the app; it does not delete trip files in connected cloud storage.
Attribution appears on the map and relevant service cards; there is no separate
licenses panel in the current interface.
