import { useEffect, useRef, useState, useMemo, memo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Tooltip, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';

// ── Fix Leaflet default icon (Vite) ──────────────────────────────────────────
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ── Bus icon (Custom SVG matching user image) ───────────────────────────────
const makeBusIcon = (isSelected, bearing = 0, isMoving = false) => {
  const movingClass = isMoving ? 'moving' : '';
  const busColor = isSelected ? 'linear-gradient(135deg, #ef4444, #dc2626)' : 'linear-gradient(135deg, #dc2626, #b91c1c)';
  
  return L.divIcon({
    html: `
      <div class="bus-container ${movingClass}" style="transform: rotate(${bearing}deg); width: 48px; height: 48px;">
        ${isSelected ? `<div style="position:absolute; inset:-8px; border-radius:50%; background:rgba(220,38,38,0.2); animation:ripple 1.5s infinite var(--ease);"></div>` : ''}
        <div style="
          position: absolute;
          inset: 0;
          background: ${busColor};
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          border: 3px solid white;
          box-shadow: 0 4px 12px rgba(220,38,38,0.5);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        ">
          🚌
        </div>
      </div>
    `,
    className: 'custom-bus-marker',
    iconSize: [48, 48],
    iconAnchor: [24, 24],
    popupAnchor: [0, -24],
  });
};

// ── Haversine formula for map display ────────────────────────────────────────
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

// ── Live Countdown Helper ──────────────────────────────────────────────────
const LiveCountdown = ({ waitTicks }) => {
  const [displaySeconds, setDisplaySeconds] = useState(Math.round(waitTicks * 2));

  useEffect(() => {
    setDisplaySeconds(Math.round(waitTicks * 2));
  }, [waitTicks]);

  useEffect(() => {
    if (displaySeconds <= 0) return;
    const interval = setInterval(() => {
      setDisplaySeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [displaySeconds > 0]);

  return <>{displaySeconds}s</>;
};

// ── Smooth Marker Component ───────────────────────────────────────────────────

const SmoothMarker = memo(({ position, icon, eventHandlers, children }) => {
  const markerRef = useRef(null);
  const animationRef = useRef(null);
  const [lastPos, setLastPos] = useState(position);

  useEffect(() => {
    if (markerRef.current) {
      const currentLatLng = markerRef.current.getLatLng();
      const start = [currentLatLng.lat, currentLatLng.lng];
      const end = position;

      if (start[0] === end[0] && start[1] === end[1]) return;

      const startTime = performance.now();
      const duration = 2000;

      const animate = (time) => {
        const elapsed = time - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        const lat = start[0] + (end[0] - start[0]) * progress;
        const lng = start[1] + (end[1] - start[1]) * progress;
        
        if (markerRef.current) {
          markerRef.current.setLatLng([lat, lng]);
        }

        if (progress < 1) {
          animationRef.current = requestAnimationFrame(animate);
        } else {
          setLastPos(end); // Update state at the end to keep sync
        }
      };

      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      animationRef.current = requestAnimationFrame(animate);
    }
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [position]);

  return (
    <Marker
      ref={markerRef}
      position={lastPos}
      icon={icon}
      eventHandlers={eventHandlers}
    >
      {children}
    </Marker>
  );
});

// ── Start marker (green flag) ─────────────────────────────────────────────────
const startIcon = L.divIcon({
  html: `<div style="display:flex;flex-direction:column;align-items:center;">
    <div style="width:28px;height:28px;background:#10b981;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid white;box-shadow:0 3px 10px rgba(16,185,129,0.5);"></div>
    <div style="width:2px;height:12px;background:#10b981;margin-top:-2px;"></div>
  </div>`,
  className: '',
  iconSize: [28, 38],
  iconAnchor: [14, 38],
  popupAnchor: [0, -40],
});

// ── End marker (red flag) ──────────────────────────────────────────────────────
const endIcon = L.divIcon({
  html: `<div style="display:flex;flex-direction:column;align-items:center;">
    <div style="width:28px;height:28px;background:#ef4444;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid white;box-shadow:0 3px 10px rgba(239,68,68,0.5);"></div>
    <div style="width:2px;height:12px;background:#ef4444;margin-top:-2px;"></div>
  </div>`,
  className: '',
  iconSize: [28, 38],
  iconAnchor: [14, 38],
  popupAnchor: [0, -40],
});

// ── User location dot ─────────────────────────────────────────────────────────
const userIcon = L.divIcon({
  html: `<div style="position:relative;width:22px;height:22px;">
    <div style="position:absolute;inset:0;background:#3b82f6;border-radius:50%;border:3px solid white;box-shadow:0 0 0 5px rgba(59,130,246,0.25);"></div>
  </div>`,
  className: '',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

// ── Stoppage marker (bright orange dot) ──────────────────────────────────────
const stopIcon = L.divIcon({
  html: `<div style="display:flex;flex-direction:column;align-items:center;">
    <div style="width:18px;height:18px;background:#ff7300;border-radius:50%;border:2.5px solid white;box-shadow:0 3px 8px rgba(255,115,0,0.5);"></div>
  </div>`,
  className: '',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  popupAnchor: [0, -10],
});

// ── Fly-to helper ─────────────────────────────────────────────────────────────
function FlyTo({ position, zoom = 14 }) {
  const map = useMap();
  const prevRef = useRef(null);
  useEffect(() => {
    if (!position) return;
    const key = `${position[0].toFixed(4)},${position[1].toFixed(4)},${zoom}`;
    if (key === prevRef.current) return;
    prevRef.current = key;
    map.flyTo(position, zoom, { duration: 1.0 });
  }, [position, zoom, map]);
  return null;
}

// ── FlyToBounds: fits user + selected bus in view ─────────────────────────────
function FlyToBounds({ userLocation, bus }) {
  const map = useMap();
  const prevRef = useRef(null);
  useEffect(() => {
    if (!userLocation || !bus?.lat) return;
    const key = `${userLocation.lat.toFixed(4)},${userLocation.lng.toFixed(4)},${bus.lat.toFixed(4)},${bus.lng.toFixed(4)}`;
    if (key === prevRef.current) return;
    prevRef.current = key;
    const bounds = L.latLngBounds(
      [userLocation.lat, userLocation.lng],
      [bus.lat, bus.lng]
    );
    map.flyToBounds(bounds, { padding: [80, 80], duration: 1.2, maxZoom: 16 });
  }, [userLocation, bus, map]);
  return null;
}

// ── Main MapView ──────────────────────────────────────────────────────────────
export default function MapView({ buses, userLocation, selectedBusId, onBusClick, mapStyle = 'street' }) {
  const center = userLocation
    ? [userLocation.lat, userLocation.lng]
    : [20.2961, 85.8245];

  const selectedBus = buses.find((b) => b.busId === selectedBusId);

  // Map Tile Layers Configuration
  const tileLayers = {
    street: {
      url: "https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
      attribution: "&copy; Google Maps"
    },
    dark: {
      url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    },
    satellite: {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EBP, and the GIS User Community'
    }
  };

  const currentTile = tileLayers[mapStyle] || tileLayers.street;

  return (
    <MapContainer
      center={center}
      zoom={13}
      style={{ height: '100%', width: '100%' }}
      zoomControl={true}
    >
      <TileLayer
        attribution={currentTile.attribution}
        url={currentTile.url}
        maxZoom={mapStyle === 'satellite' ? 18 : 20}
      />

      {/* User location */}
      {userLocation && (
        <Marker position={[userLocation.lat, userLocation.lng]} icon={userIcon}>
          <Popup><strong>📍 Your Location</strong></Popup>
        </Marker>
      )}

      {/* Per-bus: route line + start/end markers + moving bus */}
      {buses.map((bus) => {
        const hasRoute = bus.startLat != null && bus.endLat != null;
        const isSelected = bus.busId === selectedBusId;

        // Create path including stoppages if available
        const polylinePositions = [];
        if (hasRoute) {
          polylinePositions.push([bus.startLat, bus.startLng]);
          if (bus.stoppages && bus.stoppages.length > 0) {
            bus.stoppages.forEach(s => polylinePositions.push([s.lat, s.lng]));
          }
          polylinePositions.push([bus.endLat, bus.endLng]);
        }

        return (
          <span key={bus.busId}>
            {/* Route solid blue line from start → (stoppages) → end */}
            {hasRoute && (
              <Polyline
                positions={polylinePositions}
                color={isSelected ? '#2563eb' : '#3b82f6'}
                weight={isSelected ? 5 : 3.5}
                opacity={isSelected ? 0.9 : 0.6}
              />
            )}

            {/* Start marker */}
            {hasRoute && (
              <Marker position={[bus.startLat, bus.startLng]} icon={startIcon}>
                <Popup>
                  <strong style={{ color: '#10b981' }}>🟢 Start</strong><br />
                  <small>{bus.busId}</small><br />
                  <small>{bus.routeName?.split('→')[0]?.trim() || 'Start Point'}</small>
                </Popup>
              </Marker>
            )}

            {/* Stoppage markers */}
            {bus.stoppages?.map((stop, idx) => (
              <Marker key={`${bus.busId}-stop-${idx}`} position={[stop.lat, stop.lng]} icon={stopIcon}>
                <Popup>
                  <strong style={{ color: '#f59e0b' }}>🚏 {stop.name || 'Stoppage'}</strong><br />
                  <small>Bus: {bus.busId}</small><br />
                  {stop.time && <small>Wait: {stop.time} min</small>}
                </Popup>
                {/* Always-visible label for the stop name */}
                <Tooltip permanent direction="top" offset={[0, -5]} opacity={0.9}>
                  <span style={{ fontWeight: 600, color: '#ff7300', fontSize: '0.7rem' }}>
                    {stop.name || 'Stop'}
                  </span>
                </Tooltip>
              </Marker>
            ))}

            {/* End marker */}
            {hasRoute && (
              <Marker position={[bus.endLat, bus.endLng]} icon={endIcon}>
                <Popup>
                  <strong style={{ color: '#ef4444' }}>🔴 Destination</strong><br />
                  <small>{bus.busId}</small><br />
                  <small>{bus.routeName?.split('→')[1]?.trim() || 'End Point'}</small>
                </Popup>
              </Marker>
            )}

            {/* Moving bus marker (Animated) */}
            {bus.lat != null && (
              <SmoothMarker
                position={[bus.lat, bus.lng]}
                icon={makeBusIcon(isSelected, bus.bearing || 0, bus.speed > 0)}
                eventHandlers={{ click: () => onBusClick(bus) }}
              >
                {/* Countdown Tooltip when waiting at a stop */}
                {bus.waitTicks > 0 && (
                  <Tooltip 
                    permanent 
                    direction="top" 
                    offset={[0, -32]} 
                    opacity={1} 
                    className="wait-tooltip"
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '60px' }}>
                      <span style={{ fontSize: '0.6rem', fontWeight: 800, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        ⏸ Waiting
                      </span>
                      <span style={{ fontSize: '1.2rem', fontWeight: 900, color: '#0f172a', lineHeight: 1.1 }}>
                        <LiveCountdown waitTicks={bus.waitTicks} />
                      </span>
                    </div>
                  </Tooltip>
                )}

                <Popup>
                  <div style={{ minWidth: 150 }}>
                    <strong style={{ color: '#6366f1' }}>🚌 {bus.busId}</strong><br />
                    {bus.routeName && <><small style={{ color: '#64748b' }}>{bus.routeName}</small><br /></>}
                    <small>Speed: {bus.speed} km/h</small><br />
                    <small style={{ color: bus.status?.toLowerCase().includes('arrived') ? '#10b981' : bus.status?.toLowerCase().includes('moving') ? '#f59e0b' : '#94a3b8' }}>
                      {bus.status || 'Offline'}
                    </small>
                  </div>
                </Popup>
              </SmoothMarker>
            )}
          </span>
        );
      })}

      {/* ── Blue path: User → Selected Bus ── */}
      {userLocation && selectedBus?.lat && (() => {
        const dist = getDistance(userLocation.lat, userLocation.lng, selectedBus.lat, selectedBus.lng);
        return (
          <>
            {/* Outer glow line */}
            <Polyline
              positions={[
                [userLocation.lat, userLocation.lng],
                [selectedBus.lat, selectedBus.lng]
              ]}
              color="#93c5fd"
              weight={10}
              opacity={0.25}
            />
            {/* Main animated dashed line */}
            <Polyline
              positions={[
                [userLocation.lat, userLocation.lng],
                [selectedBus.lat, selectedBus.lng]
              ]}
              color="#2563eb"
              dashArray="14, 10"
              weight={4}
              opacity={0.95}
              className="user-to-bus-path"
            >
              <Tooltip
                permanent
                direction="center"
                offset={[0, 0]}
                opacity={1}
                className="distance-line-tooltip"
              >
                <div style={{
                  background: '#1d4ed8',
                  padding: '4px 12px',
                  borderRadius: '20px',
                  border: '2px solid white',
                  fontWeight: 700,
                  color: 'white',
                  fontSize: '0.75rem',
                  whiteSpace: 'nowrap',
                  boxShadow: '0 3px 10px rgba(37,99,235,0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  <span>📏</span>
                  <span>{dist < 1 ? `${(dist * 1000).toFixed(0)} m` : `${dist.toFixed(2)} km`} away</span>
                </div>
              </Tooltip>
            </Polyline>

            {/* Pulsing ring at user's end of the path */}
            <Marker
              position={[userLocation.lat, userLocation.lng]}
              icon={L.divIcon({
                html: `<div style="
                  width:32px; height:32px;
                  border-radius:50%;
                  border: 3px solid #2563eb;
                  box-shadow: 0 0 0 6px rgba(37,99,235,0.2), 0 0 14px rgba(37,99,235,0.5);
                  background: rgba(37,99,235,0.15);
                  animation: userPulse 1.6s ease-in-out infinite;
                "></div>`,
                className: '',
                iconSize: [32, 32],
                iconAnchor: [16, 16]
              })}
              interactive={false}
            />
          </>
        );
      })()}

      {/* Fly to fit both user + selected bus in view */}
      {selectedBus?.lat && userLocation && (
        <FlyToBounds userLocation={userLocation} bus={selectedBus} />
      )}

      {/* Fly to selected bus only (no user location) */}
      {selectedBus?.lat && !userLocation && (
        <FlyTo position={[selectedBus.lat, selectedBus.lng]} />
      )}

      {/* Fly to user location only when no bus is selected */}
      {userLocation && !selectedBus && (
        <FlyTo position={[userLocation.lat, userLocation.lng]} zoom={15} />
      )}
    </MapContainer>
  );
}
