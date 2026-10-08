# Transport Climate Impact (CO2e) Data Model

This document outlines the complete data architecture for calculating the total Climate Impact (CO2e) of passenger travel segments. It serves as the formal API/database schema for routing-based trip tracking, using the **Climatiq API** as the underlying calculation engine.

By tracking Total Climate Impact in **CO2e (Carbon Dioxide Equivalent)** rather than just direct tailpipe emissions, the model captures the full environmental cost of a journey, including radiative forcing (high-altitude non-CO2 impacts) and location-based electricity grid emissions.

---

## 1. Car Pipeline
Because the model uses a router API rather than continuous GPS tracking, this pipeline relies on exact distance and specific vehicle characteristics. 

**Climatiq Strategy:** 
* **Standard Method:** Use the **`/travel`** endpoint. Passing exact vehicle details automatically queries the most precise efficiency baseline based on UK DEFRA / US EPA engine size classifications.
* **High-Precision Method:** If the exact fuel consumption (e.g., L/100km) is known, calculate total fuel volume mathematically (`distance_km * (exact_fuel_l_100km / 100)`) and query the **`/estimate`** endpoint for raw fuel combustion (e.g., "combustion of X liters of petrol"), bypassing the `/travel` endpoint entirely.

### Engine Size Classifications (DEFRA Standard)
When using the categorical engine size options, Climatiq maps them to the following engine displacement thresholds:
* **Small (`small`):** Petrol engines under 1.4L (<1400cc) or Diesel under 1.7L. Typical fuel economy: ~5.5–6.5 L/100km. 
  * *Examples:* Fiat 500, Ford Fiesta, VW Polo, Toyota Yaris.
* **Medium (`medium`):** Petrol engines 1.4L to 2.0L or Diesel 1.7L to 2.0L. Typical fuel economy: ~6.5–8.0 L/100km. 
  * *Examples:* VW Golf, Honda Civic, BMW 3-Series, mid-size crossovers (e.g., Ford Kuga).
* **Large (`large`):** All engines above 2.0L (>2000cc). Typical fuel economy: 9.0+ L/100km. 
  * *Examples:* Range Rover, BMW X5, Mercedes S-Class, heavy pickup trucks.

### Formal Schema

| Field | Type | Required | Default | Available Options / Enum | Climatiq Mapping |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `distance_km` | Float | Yes | None | Any positive float | Passed directly as the `distance` parameter. |
| `fuel_type` | Enum | No | `petrol` | `petrol`, `diesel`, `hybrid`, `phev`, `bev`, `cng`, `lpg`, `average` | Passed inside the `car_details` object as `propulsion_type`. |
| `engine_size` | Enum | No | `average` | `small`, `medium`, `large`, `average` | Passed inside the `car_details` object as `car_size`. |
| `exact_fuel_l_100km` | Float | No | None | Any positive float | **Override:** If provided, calculate total fuel volume and query `/estimate` for fuel combustion instead of `/travel`. |
| `vehicle_occupancy` | Integer | No | `1` | Integer >= 1 | **Backend Math:** Divide the Climatiq returned vehicle CO2e by this integer. |

---

## 2. Flight Pipeline
Aviation calculates based on 3-letter IATA airport codes to allow the calculation engine to apply standard great-circle routing buffers (~95 km/holding patterns). It factors in shared space (cabin class) and automatically applies a Radiative Forcing Index (RFI) multiplier to yield total CO2e.

**Climatiq Strategy:** Use the **`/travel`** endpoint with origin/destination IATA codes. Climatiq automatically applies the Great Circle Distance (Haversine formula), calculates standard aviation routing buffers, and determines short/medium/long haul parameters.

### Formal Schema

| Field | Type | Required | Default | Available Options / Enum | Climatiq Mapping |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `origin_iata` | String | Yes | None | Valid 3-letter IATA code | Passed as `from` in the `/travel` request. |
| `destination_iata`| String | Yes | None | Valid 3-letter IATA code | Passed as `to` in the `/travel` request. |
| `cabin_class` | Enum | No | `average` | `economy`, `premium_economy`, `business`, `first`, `average` | Passed inside the `air_details` object as `class`. |

---

## 3. Bus Pipeline
Bus routing relies on standard emission archetypes based on transit type, allowing the calculation engine to apply robust default passenger load factors (e.g., 40% for local buses, 70% for coaches).

**Climatiq Strategy:** Use the **`/estimate`** endpoint. Querying a specific `activity_id` using `/estimate` allows precise selection of Euro standards and bus archetypes.

### Formal Schema

| Field | Type | Required | Default | Available Options / Enum | Climatiq Mapping |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `distance_km` | Float | Yes | None | Any positive float | Passed as the `distance` metric in `/estimate`. |
| `bus_type` | Enum | Yes | `local_bus`| `local_bus`, `coach`, `touring_coach` | Filters the Climatiq Activity ID. |
| `fuel_type` | Enum | No | `diesel` | `diesel`, `cng`, `bev`, `average` | Filters the Climatiq Activity ID. |
| `euro_standard` | Enum | No | `average` | `euro_iv`, `euro_v`, `euro_vi`, `average`| Filters the Climatiq Activity ID (applicable to EU region searches). |

---

## 4. Train Pipeline
Electrified rail emissions are heavily dependent on speed and geography. This pipeline breaks down multi-country routes to apply the exact energy grid carbon intensity for each respective nation.

**Climatiq Strategy:** Use the **`/estimate`** endpoint. Break the track geometry into national segments (`country_shares`) and make one API request per country segment. This forces Climatiq to use the regional electricity grid mix (e.g., `region: "FR"` vs. `region: "CH"`).

### Formal Schema

| Field | Type | Required | Default | Available Options / Enum | Climatiq Mapping |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `distance_km` | Float | Yes | None | Any positive float | Total trip distance across all segments. |
| `country_shares` | Map | Yes | None | E.g., `{"FR": 80.0, "CH": 20.0}` | Iterated as the `region` parameter to pull exact national grid mixes via `/estimate`. |
| `transit_type` | Enum | Yes | `national_rail`| `national_rail`, `international_rail`, `light_rail`, `subway` | Filters the Climatiq Activity ID. |
| `traction_type` | Enum | No | `electric`| `electric`, `diesel` | Filters the Activity ID to distinguish direct fuel burn vs grid emissions. |
| `high_speed` | Boolean| No | `False` | `True`, `False` | When `True`, targets specific high-speed train Activity IDs to account for aerodynamic drag. |

---

## 5. Boat Pipeline
Maritime modeling focuses on allocating the heavy fuel consumption of a vessel between freight, vehicles, and foot passengers. Hotel load (onboard living energy) is excluded as it serves as a baseline replacement for being at home or in a hotel.

**Climatiq Strategy:** Use the **`/estimate`** endpoint. Look up specific maritime `activity_id` factors for either foot passengers or car passengers on Ro-Ro ferries to handle deck space/weight allocations.

### Formal Schema

| Field | Type | Required | Default | Available Options / Enum | Climatiq Mapping |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `distance_km` | Float | Yes | None | Any positive float | Passed as the `distance` metric in `/estimate`. |
| `vessel_type` | Enum | Yes | `foot_ferry` | `foot_passenger_ferry`, `roro_ferry`, `high_speed_ferry` | Filters the exact maritime Activity ID. |
| `vehicle_included`| Boolean| No | `False` | `True`, `False` | If `True`, queries the Activity ID for "car passenger" on a Ro-Ro ferry. |
| `vehicle_occupancy`| Integer| No | `1` | Integer >= 1 | **Backend Math:** If `vehicle_included` is `True`, divide the returned vehicle/passenger total by this integer. |