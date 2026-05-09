# 🚌 Bus Tracking System — API Documentation

This API allows you to simulate and track bus movements in real-time. It supports automatic route simulation, multi-stop navigation, persistent waiting logic, and autonomous reverse-looping.

## 📡 Base URL
`http://localhost:5000`

---

## 🔗 Unified Endpoint

> All operations use a **single endpoint**: `http://localhost:5000/api/buses`

| Method   | Endpoint                                   | Description                        |
|----------|--------------------------------------------|------------------------------------|
| `GET`    | `/api/buses`                               | List all active buses              |
| `GET`    | `/api/buses?busId=BUS101`                  | Get a single bus by ID             |
| `POST`   | `/api/buses`                               | Create a bus / start simulation    |
| `PUT`    | `/api/buses`                               | Update a bus / restart simulation  |
| `PUT`    | `/api/buses?action=stop&busId=BUS101`      | Stop a bus simulation              |
| `DELETE` | `/api/buses?busId=BUS101`                  | Remove a bus from the system       |

---

## 📋 [GET] List All Active Buses
**Endpoint:** `GET /api/buses`  
**Description:** Returns an array of all active buses with their live status, sorted by most recently updated.

### Response (JSON Array)
```json
[
  {
    "busId": "BUS101",
    "lat": 20.315,
    "lng": 85.825,
    "speed": 40,
    "status": "Moving to Stop A",
    "routeName": "Infocity → Damana Square",
    "startName": "Infocity",
    "endName": "Damana Square",
    "currentLocationName": "Chandrasekharpur",
    "updatedAt": "2026-05-09T10:00:00.000Z"
  }
]
```

---

## 🔍 [GET] Get Single Bus
**Endpoint:** `GET /api/buses?busId=BUS101`  
**Description:** Returns detailed information for one specific bus.

---

## 📍 [POST] Create Bus / Start Simulation
**Endpoint:** `POST /api/buses`  
**Description:** Creates or updates a bus. If `startLat` & `endLat` are provided, an autonomous movement simulation is triggered immediately.

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
| `busId` | string | **Yes** | Unique identifier for the bus (e.g., `"BUS101"`). |
| `lat` | number | **Yes** | Current latitude of the bus. |
| `lng` | number | **Yes** | Current longitude. Alias: `lon`. |
| `speed` | number | No | Speed in km/h. Defaults to `0`. |
| `startLat` | number | No | Latitude of start point. Required to trigger simulation. |
| `startLng` | number | No | Longitude of start point. Alias: `startLon`. |
| `startName` | string | No | Label for start area. Auto-fetched via reverse geocoding if omitted. |
| `endLat` | number | No | Latitude of destination. Required to trigger simulation. |
| `endLng` | number | No | Longitude of destination. Alias: `endLon`. |
| `endName` | string | No | Label for destination area. Auto-fetched if omitted. |
| `routeName` | string | No | Custom route name. Auto-generated as `"Start → End"` if omitted. |
| `stoppages` | array | No | List of intermediate stops (lat, lng/lon, name, time in minutes). |

### Response (with simulation)
```json
{
  "success": true,
  "message": "Bus BUS101 created and simulation started",
  "bus": { ... },
  "totalDistanceKm": 1.23,
  "estimatedMinutes": 1.8
}
```

---

## 📝 [PUT] Update Bus / Restart Simulation
**Endpoint:** `PUT /api/buses`  
**Description:** Updates an existing bus's information. If route data is included, the simulation automatically restarts with the new waypoints.

### Request Body (JSON)
```json
{
  "busId": "BUS101",
  "speed": 60,
  "startLat": 20.3150,
  "startLng": 85.8250,
  "endLat": 20.3050,
  "endLng": 85.8200
}
```
> Send only the fields you want to change along with the required `busId`.

---

## ⛔ [PUT] Stop Simulation
**Endpoint:** `PUT /api/buses?action=stop&busId=BUS101`  
**Description:** Stops the movement simulation for a bus, setting its status to `"idle"` and speed to `0`.

### Response
```json
{ "success": true, "message": "Bus BUS101 stopped" }
```

---

## 🗑️ [DELETE] Remove a Bus
**Endpoint:** `DELETE /api/buses?busId=BUS101`  
**Description:** Completely removes a bus from the system and stops its simulation.

### Alternative (body-based)
```json
{ "busId": "BUS101" }
```

### Response
```json
{ "success": true, "message": "Bus BUS101 removed" }
```

---

## 🔄 Simulation Logic
1. **Auto-Geocoding**: If `startName` or `endName` are missing, the server fetches area names from OpenStreetMap based on coordinates.
2. **Looping**: Reaches the end → reverses direction → heads back to start.
3. **Persistence**: Server restarts do not stop buses. They resume from their last saved `lat/lng` and `waitTicks`.
4. **Heartbeat**: Buses waiting at stops send `"live"` updates every 10 seconds to keep the UI active.

### 🚏 Stoppage Definition
| Field | Type | Description |
|---|---|---|
| `lat` | number | Latitude |
| `lng` | number | Longitude (alias: `lon`) |
| `name` | string | Label (e.g., `"Airport Gate 1"`) |
| `time` | number | Wait time in **minutes** |
