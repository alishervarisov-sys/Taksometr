import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Card, CardContent, Chip, List, ListItem,
  ListItemButton, ListItemText, TextField, CircularProgress,
  Divider, Alert,
} from '@mui/material';
import { collection, query, where, onSnapshot, getDocs, orderBy } from 'firebase/firestore';
import { GoogleMap, useJsApiLoader, MarkerF, PolylineF } from '@react-google-maps/api';
import { db, GOOGLE_MAPS_API_KEY } from '../firebase';

interface Courier {
  id: string;
  name: string;
  phone?: string;
  isOnShift?: boolean;
  lastLocation?: { latitude: number; longitude: number; timestamp: number };
  locationStatus?: { enabled: boolean; since: number };
}

interface TrackPoint {
  latitude: number;
  longitude: number;
  timestamp: number;
  onMeter: boolean;
  speedKmh?: number;
  accuracy?: number;
}

// A continuous run of points with the same on/off-meter state, drawn as one
// colored polyline. Broken whenever the meter flag flips or there's a long time
// gap (likely location was turned off).
interface Segment {
  onMeter: boolean;
  path: Array<{ lat: number; lng: number }>;
}

interface TrackingProps {
  adminId: string;
}

const DEFAULT_CENTER = { lat: 38.5598, lng: 68.7740 }; // Dushanbe

// If two consecutive points are more than this far apart in time, we treat it as
// a gap (courier likely disabled location / app was killed) and break the line.
const GAP_THRESHOLD_MS = 3 * 60 * 1000;

const mapContainerStyle = {
  width: '100%',
  height: '100%',
  minHeight: '560px',
  borderRadius: '16px',
};

const ON_METER_COLOR = '#3786F6';   // green — driving with the counter on
const OFF_METER_COLOR = '#D32F2F';  // red — driving without the counter (the problem)

// Haversine distance in meters.
function distanceMeters(a: TrackPoint, b: TrackPoint): number {
  const R = 6371000;
  const dLat = (b.latitude - a.latitude) * Math.PI / 180;
  const dLng = (b.longitude - a.longitude) * Math.PI / 180;
  const lat1 = a.latitude * Math.PI / 180;
  const lat2 = b.latitude * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function fmtKm(meters: number): string {
  return (meters / 1000).toFixed(2) + ' км';
}

function fmtDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

// Local YYYY-MM-DD for the <input type="date"> default.
function todayStr(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

const Tracking: React.FC<TrackingProps> = () => {
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [selectedCourier, setSelectedCourier] = useState<string | null>(null);
  const [date, setDate] = useState<string>(todayStr());
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
  });

  // Live list of couriers.
  useEffect(() => {
    const q = query(collection(db, 'users'), where('role', '==', 'COURIER'));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Courier[];
      data.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setCouriers(data);
    });
    return () => unsub();
  }, []);

  // Load the selected courier's breadcrumbs for the chosen day.
  useEffect(() => {
    if (!selectedCourier) { setPoints([]); return; }

    const start = new Date(date + 'T00:00:00').getTime();
    const end = start + 24 * 60 * 60 * 1000;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const pointsRef = collection(db, 'courier_tracks', selectedCourier, 'points');
        const q = query(
          pointsRef,
          where('timestamp', '>=', start),
          where('timestamp', '<', end),
          orderBy('timestamp', 'asc'),
        );
        const snap = await getDocs(q);
        if (cancelled) return;
        const pts = snap.docs.map(d => {
          const x = d.data() as any;
          return {
            latitude: x.latitude,
            longitude: x.longitude,
            timestamp: x.timestamp,
            onMeter: !!x.onMeter,
            speedKmh: x.speedKmh,
            accuracy: x.accuracy,
          } as TrackPoint;
        }).filter(p => typeof p.latitude === 'number' && typeof p.longitude === 'number');
        setPoints(pts);
      } catch (e: any) {
        // Log the raw technical error so it can be found in the server logs
        // (Firebase console -> Hosting/Cloud Logging). We never surface the raw
        // SDK message ("Missing or insufficient parameters", index errors, etc.)
        // to the dispatcher — instead we show a friendly placeholder.
        console.error('[Tracking] Ошибка загрузки маршрута', { courierId: selectedCourier, date, error: e });
        if (!cancelled) setError('Не удалось загрузить маршрут. Проверьте логи сервера.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedCourier, date]);

  // Build colored segments + stats + gaps from the raw points.
  const { segments, stats, gaps } = useMemo(() => {
    const segments: Segment[] = [];
    const gaps: Array<{ from: number; to: number }> = [];
    let totalDist = 0;
    let offMeterDist = 0;
    let onMeterDist = 0;

    let current: Segment | null = null;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const prev = points[i - 1];

      const isGap = prev ? (p.timestamp - prev.timestamp) > GAP_THRESHOLD_MS : false;
      if (prev && !isGap) {
        const d = distanceMeters(prev, p);
        totalDist += d;
        if (p.onMeter) onMeterDist += d; else offMeterDist += d;
      }
      if (prev && isGap) {
        gaps.push({ from: prev.timestamp, to: p.timestamp });
      }

      // Start a new segment on the first point, a meter flip, or after a gap.
      if (!current || current.onMeter !== p.onMeter || isGap) {
        current = { onMeter: p.onMeter, path: [] };
        // Bridge across a meter flip (no gap) so the line stays continuous.
        if (prev && !isGap) current.path.push({ lat: prev.latitude, lng: prev.longitude });
        segments.push(current);
      }
      current.path.push({ lat: p.latitude, lng: p.longitude });
    }

    const firstTs = points.length ? points[0].timestamp : 0;
    const lastTs = points.length ? points[points.length - 1].timestamp : 0;

    return {
      segments,
      gaps,
      stats: {
        totalDist,
        offMeterDist,
        onMeterDist,
        firstTs,
        lastTs,
        count: points.length,
      },
    };
  }, [points]);

  const courier = couriers.find(c => c.id === selectedCourier) || null;

  const mapCenter = useMemo(() => {
    if (points.length) {
      return { lat: points[points.length - 1].latitude, lng: points[points.length - 1].longitude };
    }
    if (courier?.lastLocation) {
      return { lat: courier.lastLocation.latitude, lng: courier.lastLocation.longitude };
    }
    return DEFAULT_CENTER;
  }, [points, courier]);

  const renderMap = () => {
    if (loadError) {
      return (
        <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 560 }}>
          <Typography color="error">Ошибка загрузки карты</Typography>
        </Box>
      );
    }
    if (!isLoaded) {
      return (
        <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 560 }}>
          <Typography color="text.secondary">Загрузка карты...</Typography>
        </Box>
      );
    }
    return (
      <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
        <GoogleMap
          mapContainerStyle={mapContainerStyle}
          center={mapCenter}
          zoom={13}
          options={{ streetViewControl: false, mapTypeControl: false, fullscreenControl: true }}
        >
          {segments.map((seg, idx) => (
            <PolylineF
              key={idx}
              path={seg.path}
              options={{
                strokeColor: seg.onMeter ? ON_METER_COLOR : OFF_METER_COLOR,
                strokeOpacity: 0.9,
                strokeWeight: 5,
              }}
            />
          ))}

          {points.length > 0 && (
            <MarkerF
              position={{ lat: points[0].latitude, lng: points[0].longitude }}
              label={{ text: 'A', color: 'white', fontWeight: 'bold' }}
            />
          )}
          {points.length > 1 && (
            <MarkerF
              position={{ lat: points[points.length - 1].latitude, lng: points[points.length - 1].longitude }}
              label={{ text: 'B', color: 'white', fontWeight: 'bold' }}
            />
          )}
        </GoogleMap>
        {selectedCourier && !loading && !error && stats.count === 0 && (
          <Alert severity="info" sx={{ position: 'absolute', top: 16, left: 16, right: 16, zIndex: 1 }}>
            Нет данных о GPS-координатах курьера за выбранный день
          </Alert>
        )}
      </Box>
    );
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
        Трекинг курьеров
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Полный маршрут курьера за день. <b style={{ color: ON_METER_COLOR }}>Зелёный</b> — со счётчиком,
        {' '}<b style={{ color: OFF_METER_COLOR }}>красный</b> — без счётчика.
      </Typography>

      <Box sx={{ display: 'flex', gap: 3, flexDirection: { xs: 'column', md: 'row' } }}>
        {/* Left column: courier picker + date + stats */}
        <Card sx={{ flex: 1, maxHeight: 640, overflow: 'auto' }}>
          <CardContent>
            <TextField
              label="Дата"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              fullWidth
              size="small"
              InputLabelProps={{ shrink: true }}
              sx={{ mb: 2 }}
            />

            {courier && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{courier.name}</Typography>
                {courier.locationStatus && courier.locationStatus.enabled === false && (
                  <Alert severity="warning" sx={{ mt: 1, py: 0 }}>
                    Геолокация выключена с {fmtTime(courier.locationStatus.since)}
                  </Alert>
                )}
                {loading ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={22} /></Box>
                ) : error ? (
                  <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>
                ) : stats.count === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Нет данных о GPS-координатах курьера за выбранный день
                  </Typography>
                ) : (
                  <Box sx={{ mt: 1.5 }}>
                    <StatRow label="Всего проехал" value={fmtKm(stats.totalDist)} />
                    <StatRow label="Со счётчиком" value={fmtKm(stats.onMeterDist)} color={ON_METER_COLOR} />
                    <StatRow label="Без счётчика" value={fmtKm(stats.offMeterDist)} color={OFF_METER_COLOR} bold />
                    <Divider sx={{ my: 1 }} />
                    <StatRow label="Первая точка" value={fmtTime(stats.firstTs)} />
                    <StatRow label="Последняя точка" value={fmtTime(stats.lastTs)} />
                    <StatRow label="Точек" value={String(stats.count)} />
                    {gaps.length > 0 && (
                      <>
                        <Divider sx={{ my: 1 }} />
                        <Typography variant="caption" sx={{ fontWeight: 700, color: OFF_METER_COLOR }}>
                          Пропуски (возможно локация отключена):
                        </Typography>
                        {gaps.map((g, i) => (
                          <Typography key={i} variant="caption" display="block" color="text.secondary">
                            {fmtTime(g.from)} → {fmtTime(g.to)} ({fmtDuration(g.to - g.from)})
                          </Typography>
                        ))}
                      </>
                    )}
                  </Box>
                )}
              </Box>
            )}

            <Divider sx={{ mb: 1 }} />
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Курьеры ({couriers.length})</Typography>
            <List dense>
              {couriers.map(c => (
                <ListItem key={c.id} disablePadding>
                  <ListItemButton
                    selected={selectedCourier === c.id}
                    onClick={() => setSelectedCourier(c.id)}
                  >
                    <ListItemText
                      primary={c.name}
                      secondary={c.isOnShift === false ? 'Не на смене' : 'На смене'}
                    />
                    {c.locationStatus && c.locationStatus.enabled === false && (
                      <Chip label="локация off" color="warning" size="small" />
                    )}
                  </ListItemButton>
                </ListItem>
              ))}
              {couriers.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
                  Нет курьеров
                </Typography>
              )}
            </List>
          </CardContent>
        </Card>

        {/* Right: map */}
        <Card sx={{ flex: 2.4, minHeight: 560, overflow: 'hidden' }}>
          {renderMap()}
        </Card>
      </Box>
    </Box>
  );
};

const StatRow: React.FC<{ label: string; value: string; color?: string; bold?: boolean }> = ({ label, value, color, bold }) => (
  <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.25 }}>
    <Typography variant="body2" color="text.secondary">{label}</Typography>
    <Typography variant="body2" sx={{ fontWeight: bold ? 700 : 500, color: color || 'inherit' }}>{value}</Typography>
  </Box>
);

export default Tracking;
