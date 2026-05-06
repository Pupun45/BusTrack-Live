# 🚌 Bus Tracking System — API Documentation

This API allows you to simulate and track bus movements in real-time. It supports automatic route simulation, multi-stop navigation, persistent waiting logic, and autonomous reverse-looping.

## 📡 Base URL
`http://localhost:5000`

---

## 📍 [POST] Update Location & Start Simulation
**Endpoint:** `POST /api/bus/location`  
**Description:** Updates a bus's current position. If route coordinates are provided, the server starts an autonomous movement simulation.

### Request Body (JSON)
```json
{
  "busId": "BUS101",
  "lat": 20.3150,
  "lng": 85.8250,
  "speed": 40,
  "startLat": 20.3150,
  "startLng": 85.8250,
  "startName": "Infocity",
  "endLat": 20.3050,
  "endLng": 85.8200,
  "endName": "Damana Square",
  "stoppages": [
    { "lat": 20.3100, "lng": 85.8280, "name": "Stop A", "time": 2 }
  ]
}
```

### 🛠️ Parameter Details

| Field | Type | Required | Description |
|---|---|---|---|
| `busId` | string | **Yes** | Unique identifier for the bus (e.g., "BUS101"). |
| `lat` | number | **Yes** | Current latitude of the bus. |
| `lng` | number | **Yes** | Current longitude. Alias: `lon`. |
| `speed` | number | No | Current speed in km/h. Defaults to 0 if not provided. |
| `startLat` | number | No | Latitude of the starting point. Required for simulation. |
| `startLng` | number | No | Longitude of the starting point. Alias: `startLon`. |
| `startName` | string | No | Label for the starting area. Auto-fetched if omitted. |
| `endLat` | number | No | Latitude of the destination. Required for simulation. |
| `endLng` | number | No | Longitude of the destination. Alias: `endLon`. |
| `endName` | string | No | Label for the destination area. Auto-fetched if omitted. |
| `stoppages` | array | No | List of intermediate stops (lat, lng/lon, name, time). |

---

## 🛣️ [POST] Set Route & Start Movement
**Endpoint:** `POST /api/bus/route`  
**Description:** A dedicated endpoint to initialize a bus at its starting position and immediately begin simulation to the end destination.

### Request Body (JSON)
```json
{
  "busId": "BUS101",
  "startLat": 20.3150,
  "startLng": 85.8250,
  "endLat": 20.3050,
  "endLng": 85.8200,
  "speed": 45,
  "routeName": "Express Route 5"
}
```

---

## 📝 [PUT] Modify Bus Details
**Endpoint:** `PUT /api/bus/location`  
**Description:** Updates an existing bus's information. If route data is updated, the simulation automatically restarts with the new waypoints.

### Request Body (JSON)
Similar to `POST /api/bus/location`. Use this to change speed or route mid-journey.

---

## 📋 [GET] List All Active Buses
**Endpoint:** `GET /api/buses`  
**Description:** Returns an array of all active buses with their live status.

---

## 🔍 [GET] Get Single Bus Detail
**Endpoint:** `GET /api/bus/:busId`  
**Description:** Returns detailed information for one specific bus.

---

## 🗑️ [DELETE] Remove a Bus
**Endpoint:** `DELETE /api/bus/:busId`  
**Description:** Completely removes a bus from the system and stops its simulation.

---

## 🛑 [POST] Pause Simulation
**Endpoint:** `POST /api/bus/stop/:busId`  
**Description:** Stops the movement simulation for a bus, setting its status to "idle".

---

## 🔄 Simulation Logic
1. **Auto-Geocoding**: If `startName` or `endName` are missing, the server fetches area names from OpenStreetMap based on coordinates.
2. **Looping**: Reaches the end → reverses direction → heads back to start.
3. **Persistence**: Server restarts do not stop the buses. They pick up from their last saved `lat/lng` and `waitTicks`.
4. **Heartbeat**: Buses waiting at stops send "live" updates every 10 seconds to keep the UI active.

### 🚏 Stoppage Definition
| Field | Type | Description |
|---|---|---|
| `lat` | number | Latitude |
| `lng` | number | Longitude |
| `name` | string | Label (e.g. "Airport Gate 1") |
| `time` | number | Wait time in **minutes** |
