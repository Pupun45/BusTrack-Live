const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function getAreaName(lat, lng) {
  try {
    if (lat == null || lng == null) return 'Unknown';
    // Nominatim reverse geocoding
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14`;
    const res = await axios.get(url, {
      headers: { 'User-Agent': 'BusTrackApp/1.0 (contact@example.com)' }
    });
    const addr = res.data.address;
    // Prioritize neighborhood, suburb, or city
    return addr.neighbourhood || addr.suburb || addr.city_district || addr.city || addr.town || addr.village || 'Unknown Area';
  } catch (err) {
    console.error('Geocoding error:', err.message);
    return 'Unknown Area';
  }
}

const app = express();
const httpServer = http.createServer(app);

// ─── Socket.IO ────────────────────────────────────────────────────────────────
const io = new Server(httpServer, { cors: { origin: '*', methods: ['GET','POST','PUT','DELETE'] } });

app.use(cors());
app.use(express.json());

// ─── Bus Schema ───────────────────────────────────────────────────────────────
const busSchema = new mongoose.Schema({
  busId:      { type: String, required: true, unique: true },
  lat:        { type: Number, required: true },
  lng:        { type: Number, required: true },
  speed:      { type: Number, default: 0 },
  plannedSpeed: { type: Number, default: 0 },
  // Route start/end
  startLat:   { type: Number, default: null },
  startLng:   { type: Number, default: null },
  endLat:     { type: Number, default: null },
  endLng:     { type: Number, default: null },
  routeName:  { type: String, default: '' },
  startName:  { type: String, default: '' },
  endName:    { type: String, default: '' },
  currentLocationName: { type: String, default: '' },
  status:     { type: String, default: 'idle' },
  stoppages:  [{
    lat: Number,
    lng: Number,
    time: Number, // Duration in minutes
    name: String
  }],
  isLooping:  { type: Boolean, default: true },
  direction:  { type: Number, default: 1 }, // 1: forward, -1: reverse
  currentIdx: { type: Number, default: 0 },
  waitTicks:  { type: Number, default: 0 },
  updatedAt:  { type: Date, default: Date.now },
});
const Bus = mongoose.model('Bus', busSchema);

// ─── In-memory simulation timers ─────────────────────────────────────────────
// busId → intervalId
const simTimers = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getDistance(lat1, lon1, lat2, lon2) {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getBearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin((lon2 - lon1) * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.cos((lon2 - lon1) * Math.PI / 180);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function calculateETA(distKm, speedKmh) {
  if (!speedKmh || speedKmh < 1) return 0;
  return (distKm / speedKmh) * 60;
}

/**
 * Start automatic simulation of bus moving through waypoints.
 */
async function startSimulation(busId, waypoints, speedKmh, startIdx = 0, initialDir = 1, initialWait = 0) {
  if (simTimers.has(busId)) {
    clearTimeout(simTimers.get(busId));
    simTimers.delete(busId);
  }

  if (!waypoints || waypoints.length < 2) return;

  const INTERVAL_MS = 2000;
  const INTERVAL_H = INTERVAL_MS / 3600000;
  const stepKm = speedKmh * INTERVAL_H;

  const busRecord = await Bus.findOne({ busId });
  let currentIdx = startIdx;
  let direction = initialDir;
  let lat = busRecord?.lat ?? waypoints[currentIdx].lat;
  let lng = busRecord?.lng ?? waypoints[currentIdx].lng;
  let waitTicks = initialWait;
  let lastEmitTime = 0;

  async function runTick() {
    try {
      // Handle waiting at a stop
      if (waitTicks > 0) {
        waitTicks--;
        await Bus.updateOne({ busId }, { waitTicks, updatedAt: new Date() });

        if (waitTicks % 5 === 0) {
          const bus = await Bus.findOne({ busId });
          if (bus) io.emit('bus:locationUpdate', bus);
        }
        simTimers.set(busId, setTimeout(runTick, INTERVAL_MS));
        return;
      }

      const targetIdx = currentIdx + direction;
      const target = waypoints[targetIdx];

      if (!target) {
        // Destination reached - Reverse direction
        direction *= -1;
        
        // Calculate the new bearing for the return journey
        const finalPoint = waypoints[currentIdx];
        const nextTarget = waypoints[currentIdx + direction];
        const newBearing = nextTarget ? getBearing(finalPoint.lat, finalPoint.lng, nextTarget.lat, nextTarget.lng) : 0;
        
        // Wait 1 minute at the terminus before heading back
        waitTicks = Math.ceil((1 * 60 * 1000) / INTERVAL_MS);
        
        const bus = await Bus.findOneAndUpdate(
          { busId },
          { 
            direction, 
            bearing: newBearing, 
            status: `At Terminus - Preparing to Return`,
            waitTicks,
            updatedAt: new Date() 
          },
          { new: true }
        );
        
        if (bus) io.emit('bus:locationUpdate', bus);
        console.log(`🔄 ${busId} reached end of line. Rotating and waiting 1 min.`);
        
        simTimers.set(busId, setTimeout(runTick, INTERVAL_MS));
        return;
      }

      const dist = getDistance(lat, lng, target.lat, target.lng);
      
      // STRAIGHT RUN LOGIC: Use segment-based bearing for perfect track alignment
      const segmentStart = waypoints[currentIdx];
      const bearing = getBearing(segmentStart.lat, segmentStart.lng, target.lat, target.lng);

      // REACHED WAYPOINT CHECK
      // If we are within one step of the target, jump to it
      if (dist <= stepKm || dist < 0.02) { // 20m threshold
        lat = target.lat;
        lng = target.lng;
        currentIdx = targetIdx;

        const waitMinutes = parseFloat(target.time) || 0;
        if (waitMinutes > 0) {
          waitTicks = Math.ceil((waitMinutes * 60 * 1000) / INTERVAL_MS);
          const stopName = target.name || `Stop ${currentIdx}`;
          const bus = await Bus.findOneAndUpdate(
            { busId },
            { lat, lng, currentIdx, speed: 0, status: `At ${stopName}`, waitTicks, updatedAt: new Date() },
            { new: true }
          );
          io.emit('bus:locationUpdate', bus);
          console.log(`🚏 ${busId} waiting at ${stopName} for ${waitMinutes} min`);
        } else {
          // Just pass through
          await Bus.updateOne({ busId }, { lat, lng, currentIdx, updatedAt: new Date() });
        }
        simTimers.set(busId, setTimeout(runTick, INTERVAL_MS));
        return;
      }

      // INTERPOLATE MOVEMENT
      const fraction = Math.min(stepKm / dist, 1);
      const nextLat = lat + (target.lat - lat) * fraction;
      const nextLng = lng + (target.lng - lng) * fraction;
      
      lat = nextLat;
      lng = nextLng;

      const nextTarget = waypoints[currentIdx + direction];
      const nextStopName = nextTarget ? (nextTarget.name || `Stop ${currentIdx + direction}`) : 'Destination';

      // Periodic Area Name Fetch (every 30s)
      let currentLocationName = busRecord?.currentLocationName || '';
      const now = Date.now();
      if (now - lastEmitTime > 30000) {
        currentLocationName = await getAreaName(lat, lng);
        lastEmitTime = now;
      }

      const updatePayload = {
        lat, lng,
        speed: speedKmh,
        plannedSpeed: speedKmh,
        bearing,
        status: `Moving to ${nextStopName}`,
        waitTicks: 0,
        currentLocationName,
        updatedAt: new Date()
      };

      const bus = await Bus.findOneAndUpdate(
        { busId },
        updatePayload,
        { new: true }
      );
      
      if (bus) io.emit('bus:locationUpdate', bus);
      simTimers.set(busId, setTimeout(runTick, INTERVAL_MS));
    } catch (err) {
      console.error(`Simulation error for ${busId}:`, err);
      simTimers.set(busId, setTimeout(runTick, INTERVAL_MS));
    }
  }

  simTimers.set(busId, setTimeout(runTick, INTERVAL_MS));
  console.log(`🚌 Simulation Started: ${busId} (${speedKmh} km/h)`);
}

/**
 * Resume all active simulations on server startup
 */
async function resumeSimulations() {
  try {
    const buses = await Bus.find({ status: { $in: ['moving', 'idle'] } });
    console.log(`📡 Resuming ${buses.length} bus simulations...`);
    
    for (const bus of buses) {
      if (bus.startLat != null && bus.endLat != null) {
        const waypoints = [{ lat: bus.startLat, lng: bus.startLng, name: 'Start' }];
        if (bus.stoppages) bus.stoppages.forEach(s => waypoints.push({ ...s }));
        waypoints.push({ lat: bus.endLat, lng: bus.endLng, name: 'End' });
        
        startSimulation(bus.busId, waypoints, bus.speed || 40, bus.currentIdx || 0, bus.direction || 1, bus.waitTicks || 0);
      }
    }
  } catch (err) {}
}

// ═══════════════════════════════════════════════════════════════════════════════
//  REST API  —  All routes unified under /api/buses
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/buses
 * Create or update a bus and optionally start simulation.
 * Body: { busId, lat, lng, speed, startLat, startLng, startName,
 *         endLat, endLng, endName, stoppages, routeName }
 * If startLat & endLat are provided, autonomous simulation is triggered.
 */
app.post('/api/buses', async (req, res) => {
  try {
    const { busId, lat, lng, lon, speed = 0, startLat, startLng, startLon, endLat, endLng, endLon, stoppages, routeName = '' } = req.body;
    const finalLat = lat ?? startLat;
    const finalLng = lng ?? lon ?? startLng ?? startLon;

    if (!busId || finalLat == null || finalLng == null)
      return res.status(400).json({ error: 'busId, lat, and lng are required' });

    const sLat = startLat != null ? parseFloat(startLat) : null;
    const sLng = startLng != null || startLon != null ? parseFloat(startLng ?? startLon) : null;
    const eLat = endLat   != null ? parseFloat(endLat)   : null;
    const eLng = endLng   != null || endLon != null ? parseFloat(endLng ?? endLon) : null;
    const spd  = parseFloat(speed);

    const updateData = {
      busId,
      lat: parseFloat(finalLat),
      lng: parseFloat(finalLng),
      speed: spd,
      plannedSpeed: spd,
      updatedAt: new Date()
    };

    if (sLat != null) updateData.startLat = sLat;
    if (sLng != null) updateData.startLng = sLng;
    if (eLat != null) updateData.endLat   = eLat;
    if (eLng != null) updateData.endLng   = eLng;
    if (stoppages)    updateData.stoppages = stoppages;

    // Use provided names or auto-fetch
    updateData.startName = req.body.startName || (sLat != null ? await getAreaName(sLat, sLng) : '');
    updateData.endName   = req.body.endName   || (eLat != null ? await getAreaName(eLat, eLng) : '');
    updateData.currentLocationName = req.body.currentLocationName || await getAreaName(parseFloat(finalLat), parseFloat(finalLng));

    // Auto-fetch stoppage names
    if (stoppages && Array.isArray(stoppages)) {
      const namedStoppages = [];
      for (const s of stoppages) {
        if (!s.name && s.lat != null) s.name = await getAreaName(s.lat, s.lng ?? s.lon);
        namedStoppages.push(s);
      }
      updateData.stoppages = namedStoppages;
    }

    if (updateData.startName && updateData.endName) {
      updateData.routeName = routeName || `${updateData.startName} → ${updateData.endName}`;
    }

    if (sLat != null && eLat != null) updateData.status = 'moving';

    const bus = await Bus.findOneAndUpdate(
      { busId },
      updateData,
      { upsert: true, new: true }
    );

    // Start simulation if route is provided
    if (sLat != null && eLat != null) {
      const waypoints = [{ lat: sLat, lng: sLng, name: updateData.startName || 'Start' }];
      if (stoppages && Array.isArray(stoppages)) {
        stoppages.forEach(s => waypoints.push({ ...s, lat: parseFloat(s.lat), lng: parseFloat(s.lng ?? s.lon) }));
      }
      waypoints.push({ lat: eLat, lng: eLng, name: updateData.endName || 'End' });
      startSimulation(busId, waypoints, spd || 40);

      const totalDist = getDistance(sLat, sLng, eLat, eLng);
      const etaMin    = calculateETA(totalDist, spd || 40);
      io.emit('bus:locationUpdate', bus);
      console.log(`🚌 POST /api/buses → ${busId} simulation started`);
      return res.json({
        success: true,
        message: `Bus ${busId} created and simulation started`,
        bus,
        totalDistanceKm: parseFloat(totalDist.toFixed(2)),
        estimatedMinutes: parseFloat(etaMin.toFixed(1)),
      });
    }

    io.emit('bus:locationUpdate', bus);
    console.log(`📍 POST /api/buses → ${busId} created/updated`);
    res.json({ success: true, bus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/buses
 * Update an existing bus. Restarts simulation if route data is included.
 * Body: { busId, ...fields }
 * Also supports: PUT /api/buses?action=stop&busId=BUS101  → stop simulation
 */
app.put('/api/buses', async (req, res) => {
  try {
    // Support action=stop via query string
    if (req.query.action === 'stop') {
      const busId = req.query.busId || req.body.busId;
      if (!busId) return res.status(400).json({ error: 'busId is required' });
      if (simTimers.has(busId)) { clearInterval(simTimers.get(busId)); simTimers.delete(busId); }
      await Bus.findOneAndUpdate({ busId }, { speed: 0, status: 'idle' });
      io.emit('bus:locationUpdate', { busId, speed: 0, status: 'idle', updatedAt: new Date() });
      return res.json({ success: true, message: `Bus ${busId} stopped` });
    }

    const { busId, ...updateData } = req.body;
    if (!busId) return res.status(400).json({ error: 'busId is required' });

    // Handle aliases
    if (updateData.lng == null && updateData.lon != null) updateData.lng = updateData.lon;
    if (updateData.startLng == null && updateData.startLon != null) updateData.startLng = updateData.startLon;
    if (updateData.endLng  == null && updateData.endLon  != null) updateData.endLng  = updateData.endLon;

    // Auto-fetch names if missing
    if (updateData.startLat != null && !updateData.startName) {
      updateData.startName = await getAreaName(updateData.startLat, updateData.startLng);
    }
    if (updateData.endLat != null && !updateData.endName) {
      updateData.endName = await getAreaName(updateData.endLat, updateData.endLng);
    }
    if (updateData.startName && updateData.endName) {
      updateData.routeName = updateData.routeName || `${updateData.startName} → ${updateData.endName}`;
    }

    const bus = await Bus.findOneAndUpdate(
      { busId },
      { ...updateData, updatedAt: new Date() },
      { new: true }
    );
    if (!bus) return res.status(404).json({ error: 'Bus not found' });

    // Restart simulation if route data provided
    if (updateData.startLat != null && updateData.endLat != null) {
      const waypoints = [{ lat: parseFloat(updateData.startLat), lng: parseFloat(updateData.startLng), name: 'Start' }];
      if (updateData.stoppages && Array.isArray(updateData.stoppages)) {
        updateData.stoppages.forEach(s => waypoints.push({ ...s, lat: parseFloat(s.lat), lng: parseFloat(s.lng ?? s.lon) }));
      }
      waypoints.push({ lat: parseFloat(updateData.endLat), lng: parseFloat(updateData.endLng), name: 'End' });
      startSimulation(busId, waypoints, parseFloat(updateData.speed) || 40);
    }

    io.emit('bus:locationUpdate', bus);
    console.log(`📝 PUT /api/buses → ${busId} updated`);
    res.json({ success: true, bus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/buses          → returns all buses
 * GET /api/buses?busId=X  → returns single bus by busId
 */
app.get('/api/buses', async (req, res) => {
  try {
    if (req.query.busId) {
      const bus = await Bus.findOne({ busId: req.query.busId });
      if (!bus) return res.status(404).json({ error: 'Bus not found' });
      return res.json(bus);
    }
    res.json(await Bus.find().sort({ updatedAt: -1 }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * DELETE /api/buses?busId=BUS101
 * OR body: { busId: "BUS101" }
 * Removes bus and stops its simulation.
 */
app.delete('/api/buses', async (req, res) => {
  try {
    const busId = req.query.busId || req.body.busId;
    if (!busId) return res.status(400).json({ error: 'busId is required (query param or body)' });
    if (simTimers.has(busId)) { clearInterval(simTimers.get(busId)); simTimers.delete(busId); }
    await Bus.findOneAndDelete({ busId });
    io.emit('bus:removed', { busId });
    console.log(`🗑️  DELETE /api/buses → ${busId} removed`);
    res.json({ success: true, message: `Bus ${busId} removed` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/distance  (utility — unchanged)
 */
app.post('/api/distance', (req, res) => {
  const { lat1, lng1, lat2, lng2, speed = 40 } = req.body;
  const dist = getDistance(lat1, lng1, lat2, lng2);
  const eta = calculateETA(dist, speed);
  res.json({ distanceKm: parseFloat(dist.toFixed(2)), etaMinutes: parseFloat(eta.toFixed(1)) });
});

/**
 * GET /api/health
 */
app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', timestamp: new Date(), connectedClients: io.engine.clientsCount, activeSims: simTimers.size })
);

// ─── Socket.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`🔌 ${socket.id} connected`);
  socket.on('disconnect', () => console.log(`❌ ${socket.id} disconnected`));
});

// ─── Start ────────────────────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGO_URI || 'mongodb://localhost:27017/bus_tracking')
  .then(() => {
    console.log('✅ MongoDB connected');
    resumeSimulations(); // Resume active sims
    const PORT = process.env.PORT || 5000;
    httpServer.listen(PORT, () => {
      console.log(`🚀 Server on http://localhost:${PORT}`);
      console.log(`📋 GET    /api/buses              → List all buses`);
      console.log(`📋 GET    /api/buses?busId=X      → Get single bus`);
      console.log(`🚌 POST   /api/buses              → Create bus / start simulation`);
      console.log(`📝 PUT    /api/buses              → Update bus / restart simulation`);
      console.log(`🗑️  DELETE /api/buses?busId=X     → Remove bus`);
      console.log(`⛔ PUT    /api/buses?action=stop&busId=X → Stop simulation`);
    });
  })
  .catch((err) => { console.error('❌ MongoDB error:', err.message); process.exit(1); });
