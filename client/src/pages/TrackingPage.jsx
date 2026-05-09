import { useState, useEffect, useCallback } from 'react';
import { useSocket } from '../context/SocketContext';
import MapView from '../components/MapView';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// ── Haversine formula ─────────────────────────────────────────────────────────
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

function calcETA(distKm, speedKmh) {
  if (!speedKmh || speedKmh === 0) return null;
  return ((distKm / speedKmh) * 60).toFixed(1);
}

function fmtDist(km) {
  if (km < 1) return `${(km * 1000).toFixed(0)} m`;
  return `${km.toFixed(2)} km`;
}

// ── Live Countdown Helper ──────────────────────────────────────────────────
function LiveCountdown({ waitTicks }) {
  const [displaySeconds, setDisplaySeconds] = useState(Math.round(waitTicks * 2));
  useEffect(() => { setDisplaySeconds(Math.round(waitTicks * 2)); }, [waitTicks]);
  useEffect(() => {
    if (displaySeconds <= 0) return;
    const interval = setInterval(() => { setDisplaySeconds((prev) => Math.max(0, prev - 1)); }, 1000);
    return () => clearInterval(interval);
  }, [displaySeconds > 0]);
  return displaySeconds > 0 ? `${displaySeconds}s` : '0s';
}

// ── Info Panel shown when a bus is clicked ────────────────────────────────────
function InfoPanel({ bus, userLocation, onClose }) {
  const hasUser = userLocation && bus;
  const distance = hasUser
    ? getDistance(userLocation.lat, userLocation.lng, bus.lat, bus.lng)
    : null;
  const eta = distance !== null ? calcETA(distance, bus.speed) : null;

  const urgency =
    distance === null ? null
      : distance < 0.5 ? 'arriving'
        : distance < 2 ? 'close'
          : 'far';

  const urgencyColor = { arriving: '#10b981', close: '#f59e0b', far: '#6366f1' };
  const urgencyLabel = { arriving: '🟢 Arriving Now!', close: '🟡 Getting Close', far: '🔵 On the Way' };

  return (
    <div className="info-panel animate-slideUp">
      {/* Header */}
      <div className="info-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div className="bus-icon-lg">🚌</div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{bus.busId}</h3>
            {bus.currentLocationName && (
              <div style={{ fontSize: '0.85rem', color: 'var(--accent)', fontWeight: 600 }}>
                📍 {bus.currentLocationName}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.2rem' }}>
              <span className="live-dot" />
              <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.75)' }}>
                Live · Updated {new Date(bus.updatedAt).toLocaleTimeString()}
              </span>
            </div>
          </div>
        </div>
        <button className="close-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>

      {/* Body */}
      <div className="info-body">
        <div
          className="urgency-badge"
          style={{
            background: bus.waitTicks > 0 ? '#f59e0b18' : '#6366f118',
            borderColor: bus.waitTicks > 0 ? '#f59e0b40' : '#6366f140',
            color: bus.waitTicks > 0 ? '#f59e0b' : '#6366f1'
          }}
        >
          {bus.waitTicks > 0 ? (
            <>⏸ Waiting at {bus.status?.replace('At ', '') || 'Stop'} ({<LiveCountdown waitTicks={bus.waitTicks} />})</>
          ) : (
            <>{bus.status?.includes('Moving') ? '🔵 ' : '⏸ '}{bus.status || 'On the Way'}</>
          )}
        </div>

        {eta !== null && bus.status?.includes('Moving') && (
          <div className="eta-big">
            <div className="eta-value-text">{eta}</div>
            <div className="eta-unit-text">min ETA</div>
          </div>
        )}

        <div className="stats-row">
          <div className="stat-box">
            <div className="stat-ico">🚩</div>
            <div className="stat-val" style={{ fontSize: '0.8rem' }}>
              {bus.startName || bus.routeName?.split('→')[0]?.trim() || 'Start Point'}
            </div>
            <div className="stat-lbl">From</div>
          </div>
          <div className="stat-box">
            <div className="stat-ico">🏁</div>
            <div className="stat-val" style={{ fontSize: '0.8rem' }}>
              {bus.endName || bus.routeName?.split('→')[1]?.trim() || 'End Point'}
            </div>
            <div className="stat-lbl">To</div>
          </div>
          <div className="stat-box">
            <div className="stat-ico">📍</div>
            <div className="stat-val">{distance !== null ? fmtDist(distance) : '—'}</div>
            <div className="stat-lbl">Distance</div>
          </div>
          <div className="stat-box">
            <div className="stat-ico">⚡</div>
            <div className="stat-val">
              {bus.speed > 0 ? `${bus.speed} km/h` : (bus.plannedSpeed ? `${bus.plannedSpeed} km/h` : 'Stopped')}
            </div>
            <div className="stat-lbl">Planned Speed</div>
          </div>
        </div>

        {/* Stoppages Timeline */}
        {bus.stoppages && bus.stoppages.length > 0 && (
          <div className="stoppages-timeline">
            <h4 style={{ margin: '1.2rem 0 0.8rem', fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid rgba(0,0,0,0.05)', paddingBottom: '0.4rem' }}>
              Route Stoppages & Wait Times
            </h4>
            <div className="timeline-container" style={{ maxHeight: '200px', overflowY: 'auto', paddingRight: '0.5rem' }}>
              {bus.stoppages.map((stop, idx) => {
                const isCurrentStop = bus.status?.includes(stop.name);
                return (
                  <div key={idx} className={`timeline-item ${isCurrentStop ? 'active-stop' : ''}`} style={{ marginBottom: '0.8rem', display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div className="timeline-marker" style={{
                        background: isCurrentStop ? '#ff7300' : '#cbd5e1',
                        width: '12px', height: '12px', borderRadius: '50%',
                        border: isCurrentStop ? '3px solid #ff730030' : 'none',
                        boxShadow: isCurrentStop ? '0 0 10px #ff730050' : 'none',
                        transition: 'all 0.3s'
                      }} />
                      {idx !== bus.stoppages.length - 1 && <div style={{ width: '2px', height: '30px', background: '#f1f5f9' }} />}
                    </div>
                    <div className="timeline-content">
                      <div className="stop-name" style={{ fontWeight: 600, fontSize: '0.9rem', color: isCurrentStop ? '#0f172a' : '#475569' }}>
                        {stop.name || `Stop ${idx + 1}`}
                        {isCurrentStop && <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', background: '#ff730015', color: '#ff7300', padding: '1px 6px', borderRadius: '4px' }}>BUS AT STOP</span>}
                      </div>
                      <div className="stop-time" style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                        🕒 {stop.time} min scheduled wait
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sidebar bus list card ─────────────────────────────────────────────────────
function BusCard({ bus, isSelected, onClick, userLocation }) {
  const distance = userLocation && bus.lat != null
    ? getDistance(userLocation.lat, userLocation.lng, bus.lat, bus.lng)
    : null;

  const secondsAgo = Math.round((Date.now() - new Date(bus.updatedAt)) / 1000);
  const isStale = secondsAgo > 30;

  const statusColor = bus.status?.includes('At') ? '#f59e0b'
    : bus.status?.includes('Moving') ? 'var(--accent)'
      : bus.status === 'arrived' ? 'var(--success)'
        : 'var(--text-muted)';

  const statusLabel = bus.status || (bus.speed > 0 ? `⚡ ${bus.speed} km/h` : '⏸ Idle');

  return (
    <div
      className={`bus-list-card ${isSelected ? 'selected' : ''} ${bus.status === 'arrived' ? 'arrived' : ''}`}
      onClick={() => onClick(bus)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick(bus)}
    >
      <div className="bus-list-icon">{bus.status?.includes('At') ? '🚏' : bus.status === 'arrived' ? '🏁' : '🚌'}</div>
      <div className="bus-list-info">
        <div className="bus-list-id">{bus.busId}</div>
        {bus.routeName && <div className="bus-route-name">{bus.routeName}</div>}
        <div className="bus-list-meta">
          <span style={{ color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
          {' · '}
          <span style={{ color: isStale ? 'var(--danger)' : 'var(--success)' }}>
            {secondsAgo < 60 ? `${secondsAgo}s ago` : `${Math.round(secondsAgo / 60)}m ago`}
          </span>
        </div>
      </div>
      <div className="bus-list-dist">
        {distance !== null ? (
          <>
            <div style={{ fontWeight: 700, color: 'var(--accent)', fontSize: '0.85rem' }}>{fmtDist(distance)}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>away</div>
          </>
        ) : (
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>tap to track</span>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function TrackingPage() {
  const { socket, connected } = useSocket();
  const [buses, setBuses] = useState([]);
  const [selectedBus, setSelectedBus] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [locationError, setLocationError] = useState(false);
  const [updateCount, setUpdateCount] = useState(0);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [mapStyle, setMapStyle] = useState('street'); // 'street', 'dark', 'satellite'
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [placeName, setPlaceName] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [suggestions, setSuggestions] = useState([]);

  // Auto-collapse sidebar on small screens
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    if (mq.matches) setSidebarOpen(false);
    const handler = (e) => { if (e.matches) setSidebarOpen(false); };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // ── Place Auto-suggest Logic ──────────────────────────────────────────────
  useEffect(() => {
    const fetchSuggestions = async () => {
      if (placeName.length < 3) { setSuggestions([]); return; }
      try {
        const res = await axios.get(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(placeName)}&limit=5`);
        setSuggestions(res.data);
      } catch (err) { console.error(err); }
    };
    const timer = setTimeout(fetchSuggestions, 500);
    return () => clearTimeout(timer);
  }, [placeName]);

  // ── Get user's GPS ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) { setLocationError(true); return; }
    const id = navigator.geolocation.watchPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setLocationError(true),
      { enableHighAccuracy: true }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // ── Load initial buses from REST API ───────────────────────────────────────
  useEffect(() => {
    axios.get(`${API}/api/buses`)
      .then((res) => setBuses(res.data))
      .catch(() => { });
  }, []);

  // ── Socket.IO: listen for real-time updates ────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    socket.on('bus:locationUpdate', (data) => {
      setBuses((prev) => {
        const idx = prev.findIndex((b) => b.busId === data.busId);
        if (idx === -1) return [...prev, data];

        const existing = prev[idx];
        const posChanged = existing.lat !== data.lat || existing.lng !== data.lng;
        const statusChanged = existing.status !== data.status;
        const infoChanged = existing.currentLocationName !== data.currentLocationName;

        if (!posChanged && !statusChanged && !infoChanged) return prev;

        const updated = [...prev];
        updated[idx] = { ...updated[idx], ...data };
        return updated;
      });

      setSelectedBus((sel) => {
        if (sel?.busId !== data.busId) return sel;
        // Only update if significant change
        if (sel.lat === data.lat && sel.lng === data.lng && sel.status === data.status) return sel;
        return { ...sel, ...data };
      });

      setUpdateCount((c) => c + 1);
      setLastUpdate(new Date());
    });

    socket.on('bus:removed', ({ busId }) => {
      setBuses((prev) => prev.filter((b) => b.busId !== busId));
      setSelectedBus((s) => (s?.busId === busId ? null : s));
    });

    socket.on('bus:arrived', ({ busId }) => {
      setBuses((prev) => prev.map((b) => b.busId === busId ? { ...b, status: 'arrived', speed: 0 } : b));
      setSelectedBus((s) => s?.busId === busId ? { ...s, status: 'arrived', speed: 0 } : s);
    });

    return () => {
      socket.off('bus:locationUpdate');
      socket.off('bus:removed');
      socket.off('bus:arrived');
    };
  }, [socket]);

  const handlePlaceSearch = async (e) => {
    e.preventDefault();
    if (!placeName.trim()) return;
    setIsSearching(true);
    try {
      const res = await axios.get(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(placeName)}&limit=1`);
      if (res.data && res.data.length > 0) {
        const { lat, lon } = res.data[0];
        setUserLocation({ lat: parseFloat(lat), lng: parseFloat(lon) });
        setShowLocationModal(false);
        setPlaceName('');
        setUpdateCount(c => c + 1);
      } else {
        alert("Place not found. Try a more specific name.");
      }
    } catch (err) {
      alert("Search failed. Check your internet connection.");
    } finally {
      setIsSearching(false);
    }
  };

  const useLiveGPS = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setShowLocationModal(false);
        setLocationError(false);
      },
      () => setLocationError(true)
    );
  };

  const handleBusClick = useCallback((bus) => {
    setSelectedBus((prev) => (prev?.busId === bus.busId ? null : bus));
    // On mobile, close sidebar after selecting
    if (window.innerWidth <= 640) setSidebarOpen(false);
  }, []);

  const filteredBuses = buses.filter(bus => {
    const query = searchQuery.toLowerCase();
    return (
      bus.busId?.toLowerCase().includes(query) ||
      bus.routeName?.toLowerCase().includes(query) ||
      bus.currentLocationName?.toLowerCase().includes(query) ||
      bus.stoppages?.some(s => s.name?.toLowerCase().includes(query))
    );
  });

  return (
    <div className="app-shell">
      {/* ── Top Navbar ── */}
      <header className="top-bar">
        {/* Sidebar toggle button */}
        <button
          id="sidebar-toggle"
          className={`sidebar-toggle-btn ${sidebarOpen ? 'open' : ''}`}
          onClick={() => setSidebarOpen((v) => !v)}
          aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <span className="toggle-bar" />
          <span className="toggle-bar" />
          <span className="toggle-bar" />
        </button>

        <div className="top-bar-brand">
          <span className="brand-icon">🚌</span>
          <span className="brand-name">BusTrack <span>Live</span></span>
        </div>

        {/* Search Bar */}
        <div className="top-bar-search">
          <div className="search-input-wrapper">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              placeholder="Search bus, route, or place..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
            {searchQuery && (
              <button className="search-clear" onClick={() => setSearchQuery('')}>✕</button>
            )}
          </div>
        </div>



        <div className="top-bar-info" style={{ marginLeft: 'auto' }}>
          {locationError
            ? <span className="loc-badge warn" onClick={() => setShowLocationModal(true)} style={{ cursor: 'pointer' }}>⚠️ No location</span>
            : userLocation
              ? <span className="loc-badge ok" onClick={() => setShowLocationModal(true)} style={{ cursor: 'pointer' }}>📍 Located</span>
              : <span className="loc-badge muted" onClick={() => setShowLocationModal(true)} style={{ cursor: 'pointer' }}>📍 Locating…</span>
          }
         
        </div>
      </header>

      {/* ── Main Layout ── */}
      <div className="content-area">
        {/* ─ Sidebar ─ */}
        <aside className={`side-panel ${sidebarOpen ? 'open' : 'closed'}`}>
          <div className="side-inner">
            <div className="side-section">
              <div className="side-heading">
                🚌 Active Buses
                <span className="count-badge">{buses.length}</span>
              </div>

              {buses.length === 0 ? (
                <div className="empty-state">
                  <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📮</div>
                  <p>No buses online yet</p>
                  <p style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
                    Send GPS data via Postman
                  </p>
                  <code className="postman-hint">POST /api/buses</code>
                </div>
              ) : (
                <div className="bus-list">
                  {filteredBuses.map((bus) => (
                    <BusCard
                      key={bus.busId}
                      bus={bus}
                      isSelected={selectedBus?.busId === bus.busId}
                      onClick={handleBusClick}
                      userLocation={userLocation}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Postman guide */}
            <div className="postman-guide">
              <div className="guide-note">
                ✨ Map updates instantly via WebSocket!
              </div>
            </div>
          </div>
        </aside>

        {/* ─ Map ─ */}
        <div className="map-area">
          <MapView
            buses={filteredBuses}
            userLocation={userLocation}
            selectedBusId={selectedBus?.busId}
            onBusClick={handleBusClick}
            mapStyle={mapStyle}
          />

          {/* Map Style Switcher */}
          <div className="map-style-switcher">
            <button
              className={mapStyle === 'street' ? 'active' : ''}
              onClick={() => setMapStyle('street')}
              title="Street View"
            >🗺️</button>
            <button
              className={mapStyle === 'dark' ? 'active' : ''}
              onClick={() => setMapStyle('dark')}
              title="Dark Mode"
            >🌙</button>
            <button
              className={mapStyle === 'satellite' ? 'active' : ''}
              onClick={() => setMapStyle('satellite')}
              title="Satellite View"
            >🛰️</button>
          </div>

          {/* Info panel overlay */}
          {selectedBus && (
            <div className="info-panel-wrapper">
              <InfoPanel
                bus={selectedBus}
                userLocation={userLocation}
                onClose={() => setSelectedBus(null)}
              />
            </div>
          )}

          {/* No buses overlay */}
          {buses.length === 0 && (
            <div className="map-empty-overlay">
              <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>📡</div>
              <h3>Waiting for GPS data…</h3>
              <p>Use Postman to send bus coordinates</p>
              <code>POST http://localhost:5000/api/buses</code>
            </div>
          )}

          {/* Manual Location Modal (Search by Place) */}
          {showLocationModal && (
            <div className="modal-backdrop" onClick={() => setShowLocationModal(false)}>
              <div className="location-modal" onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <h3 style={{ margin: 0 }}>📍 Update Location</h3>
                  <button className="close-btn-mini" onClick={() => setShowLocationModal(false)}>✕</button>
                </div>
                <p>Search for a place or use your live GPS coordinates.</p>

                <form onSubmit={handlePlaceSearch} style={{ position: 'relative' }}>
                  <div className="input-group">
                    <label>Search Place Name</label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        type="text"
                        value={placeName}
                        onChange={e => setPlaceName(e.target.value)}
                        placeholder="e.g. Vani Vihar, Bhubaneswar"
                        required
                        style={{ flex: 1 }}
                        autoComplete="off"
                      />
                      <button type="submit" className="save-btn" style={{ width: 'auto', padding: '0 1rem' }} disabled={isSearching}>
                        {isSearching ? '...' : '🔍'}
                      </button>
                    </div>

                    {/* Auto-suggestions list */}
                    {suggestions.length > 0 && (
                      <div className="suggestions-dropdown">
                        {suggestions.map((s, i) => (
                          <div
                            key={i}
                            className="suggestion-item"
                            onClick={() => {
                              setUserLocation({ lat: parseFloat(s.lat), lng: parseFloat(s.lon) });
                              setShowLocationModal(false);
                              setPlaceName('');
                              setSuggestions([]);
                              setUpdateCount(c => c + 1);
                            }}
                          >
                            <span style={{ fontSize: '0.8rem' }}>📍</span>
                            <div className="suggestion-text">
                              <div className="suggestion-main">{s.display_name.split(',')[0]}</div>
                              <div className="suggestion-sub">{s.display_name.split(',').slice(1).join(',')}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </form>

                <div className="modal-actions" style={{ marginTop: '1.5rem', gridTemplateColumns: '1fr' }}>
                  <button type="button" className="cancel-btn" onClick={() => setShowLocationModal(false)}>Close</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
