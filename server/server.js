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
//  REST API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/bus/route
 * Set a bus's start & end location and begin automatic movement simulation.
 * Body: { busId, startLat, startLng, endLat, endLng, speed, routeName }
 */
app.post('/api/bus/route', async (req, res) => {
  try {
    const { busId, startLat, startLng, startLon, endLat, endLng, endLon, speed = 40, routeName = '' } = req.body;
    
    const sLat = parseFloat(startLat);
    const sLng = parseFloat(startLng ?? startLon);
    const eLat = parseFloat(endLat);
    const eLng = parseFloat(endLng ?? endLon);
    const spd  = parseFloat(speed);

    // Auto-fetch names if missing
    let sName = req.body.startName || await getAreaName(sLat, sLng);
    let eName = req.body.endName || await getAreaName(eLat, eLng);
    let rName = routeName || `${sName} → ${eName}`;

    // Upsert bus starting at startLat/startLng
    const bus = await Bus.findOneAndUpdate(
      { busId },
      { busId, lat: sLat, lng: sLng, speed: spd, startLat: sLat, startLng: sLng,
        endLat: eLat, endLng: eLng, routeName: rName, startName: sName, endName: eName, 
        status: 'moving', updatedAt: new Date() },
      { upsert: true, new: true }
    );

    // Broadcast initial position
    io.emit('bus:locationUpdate', {
      busId, lat: sLat, lng: sLng, speed: spd, status: 'moving',
      startLat: sLat, startLng: sLng, endLat: eLat, endLng: eLng, routeName,
      updatedAt: new Date(),
    });

    // Start simulation with 2 waypoints (start and end)
    const waypoints = [
      { lat: sLat, lng: sLng, name: 'Start' },
      { lat: eLat, lng: eLng, name: 'End' }
    ];
    startSimulation(busId, waypoints, spd);

    const totalDist = getDistance(sLat, sLng, eLat, eLng);
    const etaMin = calculateETA(totalDist, spd);
    res.json({
      success: true,
      message: `Bus ${busId} simulation started`,
      bus: { busId, startLat: sLat, startLng: sLng, endLat: eLat, endLng: eLng, speed: spd, routeName },
      totalDistanceKm: parseFloat(totalDist.toFixed(2)),
      estimatedMinutes: parseFloat(etaMin.toFixed(1)),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/bus/stop/:busId
 * Stop simulation for a bus.
 */
app.post('/api/bus/stop/:busId', async (req, res) => {
  const { busId } = req.params;
  if (simTimers.has(busId)) {
    clearInterval(simTimers.get(busId));
    simTimers.delete(busId);
  }
  await Bus.findOneAndUpdate({ busId }, { speed: 0, status: 'idle' });
  io.emit('bus:locationUpdate', { busId, speed: 0, status: 'idle', updatedAt: new Date() });
  res.json({ success: true, message: `Bus ${busId} stopped` });
});

/**
 * POST /api/bus/location
 * Manual GPS update from Postman (no simulation).
 */
app.post('/api/bus/location', async (req, res) => {
  try {
    const { busId, lat, lng, lon, speed = 0, startLat, startLng, startLon, endLat, endLng, endLon, stoppages } = req.body;
    const finalLat = lat;
    const finalLng = lng ?? lon;

    if (!busId || finalLat == null || finalLng == null)
      return res.status(400).json({ error: 'busId, lat, and lng are required' });

    const updateData = {
      busId,
      lat: parseFloat(finalLat),
      lng: parseFloat(finalLng),
      speed: parseFloat(speed),
      plannedSpeed: parseFloat(speed),
      updatedAt: new Date()
    };

    if (startLat != null) updateData.startLat = parseFloat(startLat);
    if (startLng != null || startLon != null) updateData.startLng = parseFloat(startLng ?? startLon);
    if (endLat != null)   updateData.endLat   = parseFloat(endLat);
    if (endLng != null || endLon != null)   updateData.endLng   = parseFloat(endLng ?? endLon);
    if (stoppages)        updateData.stoppages = stoppages;

    // Use provided names or auto-fetch if missing
    updateData.startName = req.body.startName || (startLat != null ? await getAreaName(startLat, startLng) : '');
    updateData.endName   = req.body.endName   || (endLat   != null ? await getAreaName(endLat,   endLng)  : '');
    
    // Fetch current location name if not provided
    updateData.currentLocationName = req.body.currentLocationName || await getAreaName(lat, lng);

    // Auto-fetch stoppage names
    if (stoppages && Array.isArray(stoppages)) {
      const namedStoppages = [];
      for (const s of stoppages) {
        if (!s.name && s.lat != null) {
          s.name = await getAreaName(s.lat, s.lng);
        }
        namedStoppages.push(s);
      }
      updateData.stoppages = namedStoppages;
    }
    
    // Update routeName automatically if we have both names
    if (updateData.startName && updateData.endName) {
      updateData.routeName = `${updateData.startName} → ${updateData.endName}`;
    }

    const bus = await Bus.findOneAndUpdate(
      { busId },
      updateData,
      { upsert: true, new: true }
    );

    // If startLat and endLat are provided, trigger simulation
    if (startLat != null && endLat != null) {
      const waypoints = [];
      const sLat = parseFloat(startLat);
      const sLng = parseFloat(startLng ?? startLon);
      const eLat = parseFloat(endLat);
      const eLng = parseFloat(endLng ?? endLon);

      waypoints.push({ lat: sLat, lng: sLng, name: 'Start' });
      
      if (stoppages && Array.isArray(stoppages)) {
        stoppages.forEach(s => waypoints.push({ ...s, lat: parseFloat(s.lat), lng: parseFloat(s.lng ?? s.lon) }));
      }
      
      waypoints.push({ lat: eLat, lng: eLng, name: 'End' });
      
      startSimulation(busId, waypoints, parseFloat(speed) || 40);
    }

    io.emit('bus:locationUpdate', bus);
    console.log(`📍 ${busId} updated via POST → [${lat}, ${lng}] ${startLat ? '(Simulation Triggered)' : ''}`);
    res.json({ success: true, bus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/bus/location
 * Update bus details including start/end and stoppages.
 */
app.put('/api/bus/location', async (req, res) => {
  try {
    const { busId, ...updateData } = req.body;
    if (!busId) return res.status(400).json({ error: 'busId is required' });

    // Handle aliases
    if (updateData.lng == null && updateData.lon != null) updateData.lng = updateData.lon;
    if (updateData.startLng == null && updateData.startLon != null) updateData.startLng = updateData.startLon;
    if (updateData.endLng == null && updateData.endLon != null) updateData.endLng = updateData.endLon;

    // Auto-fetch names if missing and coordinates are being updated
    if (updateData.startLat != null && !updateData.startName) {
      updateData.startName = await getAreaName(updateData.startLat, updateData.startLng);
    }
    if (updateData.endLat != null && !updateData.endName) {
      updateData.endName = await getAreaName(updateData.endLat, updateData.endLng);
    }
    
    // Update routeName automatically if we have both names
    if (updateData.startName && updateData.endName) {
      updateData.routeName = `${updateData.startName} → ${updateData.endName}`;
    }

    const bus = await Bus.findOneAndUpdate(
      { busId },
      { ...updateData, updatedAt: new Date() },
      { new: true }
    );

    if (!bus) return res.status(404).json({ error: 'Bus not found' });

    // If route data is provided in the update, restart simulation
    if (updateData.startLat != null && updateData.endLat != null) {
      const waypoints = [
        { lat: parseFloat(updateData.startLat), lng: parseFloat(updateData.startLng), name: 'Start' }
      ];
      if (updateData.stoppages && Array.isArray(updateData.stoppages)) {
        updateData.stoppages.forEach(s => waypoints.push({ ...s, lat: parseFloat(s.lat), lng: parseFloat(s.lng ?? s.lon) }));
      }
      waypoints.push({ lat: parseFloat(updateData.endLat), lng: parseFloat(updateData.endLng), name: 'End' });
      
      startSimulation(busId, waypoints, parseFloat(updateData.speed) || 40);
    }

    io.emit('bus:locationUpdate', bus);
    console.log(`📝 ${busId} updated via PUT`);
    res.json({ success: true, bus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/buses
 */
app.get('/api/buses', async (req, res) => {
  try { res.json(await Bus.find().sort({ updatedAt: -1 })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/bus/:busId
 */
app.get('/api/bus/:busId', async (req, res) => {
  try {
    const bus = await Bus.findOne({ busId: req.params.busId });
    if (!bus) return res.status(404).json({ error: 'Bus not found' });
    res.json(bus);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/distance
 */
app.post('/api/distance', (req, res) => {
  const { lat1, lng1, lat2, lng2, speed = 40 } = req.body;
  const dist = getDistance(lat1, lng1, lat2, lng2);
  const eta = calculateETA(dist, speed);
  res.json({ distanceKm: parseFloat(dist.toFixed(2)), etaMinutes: parseFloat(eta.toFixed(1)) });
});

/**
 * DELETE /api/bus/:busId
 */
app.delete('/api/bus/:busId', async (req, res) => {
  try {
    const { busId } = req.params;
    if (simTimers.has(busId)) { clearInterval(simTimers.get(busId)); simTimers.delete(busId); }
    await Bus.findOneAndDelete({ busId });
    io.emit('bus:removed', { busId });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
      console.log(`🛣️  Route: POST /api/bus/route  { busId, startLat, startLng, endLat, endLng, speed }`);
      console.log(`📍 Manual: POST /api/bus/location { busId, lat, lng, speed }`);
    });
  })
  .catch((err) => { console.error('❌ MongoDB error:', err.message); process.exit(1); });
