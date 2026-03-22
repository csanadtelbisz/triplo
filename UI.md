
# UI Specification for Triplo

The user interface should be a web app. On a high-level, it should look like many map applications: a large map and a side panel with different functionalities detailed below.

General UI requirements: the UI should be fluent and modern. Prefer to use icons from an icon library (e.g., Google material icons font). In most cases (especially in small toolboxes), texts are not even needed for buttons, only icons. Tooltips can provide a description in these cases.

## Map

Contains the map and the usual map controls and the license for the map tile provider. But I guess, this is arranged automatically by the map library.

All trips (if the trip manager is active) or the selected trip (if a trip is currently being edited) is displayed on the map. If there is a selected trip, waypoints are displayed also, and they can be dragged which triggers a new route planning for the relevant segment.

## Trip manager

This is the main panel that is displayed in the side panel on startup.

- Preferences, status and license icons at the top.
- The trip manager lists all trips retrieved by the backend from the file system (see details below). Name, ID, period and description are displayed for each trip.
- New trip can be created.
- Existing trip can be deleted (after confirmation).
- Trips can be sorted based on different properties (name, different dates, etc.; A-Z and Z-A in all cases).
- When the trip manager is active, all trips are displayed on the map with a less intrusive theme (specific theme for rendering the routes in the overall view, see style customization later).
- Hovering a trip in the trip manager highlights the trip on the map and vice versa (again, custom theme for highlighted trips).
- Trips can be selected from both the manager panel and by clicking on the routes on the map to open the trip editor.

## Trip editor

- Toolbox at the top:
  - Go back: asks for confirmation to save or discard, then go back to the trip manager.
  - Reload: reload trip from disk. Asks for confirmation if there are unsaved changes.
  - Save: persists the current state of the trip.
  - Export: generates a GPX file.
  - Nice-to-have: undo/redo (this requires more sophisticated action handling).
- Trip metadata properties (name, description, period, etc.) can be edited at the top of this panel.
- The trip editor lists all waypoints of all segments along a (vertical) line. Waypoints can be characterized by either an icon (simple flag or icon based on the point type if OSM data is available) or a picture (if an image link is provided for the waypoint).
- Trip segments are displayed in a way that visually groups the waypoints belonging to the segment.
- Left of the waypoint line, the segment name is displayed along with a toolbox below it. Icon buttons are included in the toolbox:
  - Some icons can quickly edit certain segment properties (e.g., for `detailedMode`, an icon for the mode is displayed and clicking on it iterates to the next mode);
  - Perform some actions (such as move segment before or after the previous or next segment, or combine segment with the previous or next segment);
  - Open the segment information panel.
- Right of the waypoint line, the waypoint names are displayed along with a toolbox. The toolbox contains the following icons:
  - A stateful icon for toggling the importance of the waypoint (`normal` are displayed with a usual pin on the map while `hidden` waypoints are only displayed with a small dot/circle on the route that can be dragged).
  - Jump to waypoint (for focusing the waypoint on the map)
  - Split segment at this waypoint for each intermediate waypoint of each segment.
  - Move earlier and later.
  - Remove waypoint. If the segment of the waypoint to remove only consists of two waypoints (one of which is going to be removed), the segment is also removed by this action. In this case, a confirmation pop-up is displayed before executing the action.
  - Icon to open the waypoint information panel.
- A plus icon appears on the waypoint line between any two waypoints which can add a new waypoint at the respective place in the relevant segment.
- The distance between the waypoints (along the route) is also shown between any two waypoints.
- Elevation profile below the waypoints if elevation data is available for all segments.

## Segment information panel

- All properties of a segment are listed.
- User-editable properties can be edited (e.g., `routingMode` should not be editable).
- Go back button at the top.
- Elevation profile if elevation data is available for this segment.

## Waypoint information panel

Similar to the segment information panel.

## Preferences panel

Shows any configuration options that are available on the UI. For the first development phase, this can be empty.

## Status panel

Shows the availability of the backend server and the different routing services.

## Licenses panel

Shows all licenses used by the project.