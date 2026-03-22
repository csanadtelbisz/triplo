import re
import os

with open('src/App.tsx', 'r', encoding='utf-8') as f:
    app_text = f.read()

# 1. MapStyles already decoupled, but we need to remove it from App.tsx
app_text = re.sub(r"const mapyApiKey = import\.meta\.env\.VITE_MAPY_API_KEY.+?};\n", "", app_text, flags=re.DOTALL)

# 2. Add MAP_STYLES and TriploMap imports
app_text = app_text.replace("import { WaypointInfo } from './components/WaypointInfo';", 
    "import { WaypointInfo } from './components/WaypointInfo';\nimport { TriploMap, TriploMapRef } from './components/TriploMap';")

# 3. Extract the Hooks and Effects for the map
map_logic_match = re.search(r'(  const \[mapLoaded, setMapLoaded\] = useState\(false\);.*?)(?=\n  const handleDeleteTrip)', app_text, re.DOTALL)
if map_logic_match:
    map_logic = map_logic_match.group(1)
    # Remove it from App
    app_text = app_text.replace(map_logic, "")

    # We also need to extract mapRefs and handleJumpToWaypoint, zoomToTrip
    zoom_logic_match = re.search(r'(  const zoomToTrip.+?)(?=\n  const handleSelectTrip)', app_text, re.DOTALL)
    if zoom_logic_match:
        zoom_logic = zoom_logic_match.group(1)
        app_text = app_text.replace(zoom_logic, "  const mapComponentRef = useRef<TriploMapRef>(null);\n")

    # Change zoomToTrip and handleJumpToWaypoint calls in App.tsx
    app_text = app_text.replace("zoomToTrip(trip)", "mapComponentRef.current?.zoomToTrip(trip)")
    app_text = app_text.replace("onZoomToTrip={() => zoomToTrip(selectedTrip)}", "onZoomToTrip={() => mapComponentRef.current?.zoomToTrip(selectedTrip)}")
    app_text = app_text.replace("onJumpToWaypoint={handleJumpToWaypoint}", "onJumpToWaypoint={(id) => mapComponentRef.current?.handleJumpToWaypoint(id)}")

    # Extract JSX
    jsx_match = re.search(r'(      <div ref=\{mapContainer\}.+?)(?=\n      \{/\* Map Layer Control)', app_text, re.DOTALL)
    if jsx_match:
        jsx1 = jsx_match.group(1)
        app_text = app_text.replace(jsx1, "")
    
    jsx2_match = re.search(r'(      \{/\* Map Layer Control.+?</div>\n      \)}', app_text, re.DOTALL)
    if jsx2_match:
        jsx2 = jsx2_match.group(1)
        app_text = app_text.replace(jsx2, "<TriploMap \n        ref={mapComponentRef}\n        trips={trips}\n        selectedTrip={selectedTrip}\n        waitingWaypointId={waitingWaypointId}\n        setWaitingWaypointId={setWaitingWaypointId}\n        updateTripState={updateTripState}\n      />")

# We removed waitingWaypointIdRef but let's check if it was removed in map logic
app_text = re.sub(r'  const waitingWaypointIdRef = useRef<string \| null>\(null\);\n', '', app_text)

with open('src/App_updated.tsx', 'w', encoding='utf-8') as f:
    f.write(app_text)

print("Extraction script done!")
