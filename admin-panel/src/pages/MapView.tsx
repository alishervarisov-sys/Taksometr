import React, { useEffect, useRef, useState } from 'react';
import {
  Box, Typography, Card, CardContent, Chip, List, ListItem,
  ListItemText, ListItemButton, IconButton, Tooltip, CircularProgress,
  Snackbar, Alert, ToggleButton, ToggleButtonGroup, Divider, LinearProgress
} from '@mui/material';
import { MyLocation, TrendingUp, Flag } from '@mui/icons-material';
import { collection, query, where, onSnapshot, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { GoogleMap, useJsApiLoader, MarkerF, InfoWindowF, CircleF } from '@react-google-maps/api';
import { db, functions, GOOGLE_MAPS_API_KEY } from '../firebase';

interface CourierLocation {
  id: string;
  name: string;
  phone: string;
  isOnline: boolean;
  isOnShift?: boolean;
  lastLocation?: {
    latitude: number;
    longitude: number;
    timestamp: number;
  };
  hasActiveDelivery?: boolean;
}

// Minimal shape of a courier's current (IN_PROGRESS) order, shown when the
// dispatcher clicks the courier.
interface ActiveOrder {
  id: string;
  clientPhone?: string;
  pickupAddress?: string;
  destinationAddress?: string;
  adminOrderStage?: string;
  orderKind?: string;
  cost?: number;
}

// Dispatcher status of a courier.
type CourierStatus = 'busy' | 'free' | 'offline';
type StatusFilter = 'all' | CourierStatus;

const STATUS_META: Record<CourierStatus, { label: string; color: string; chip: 'error' | 'success' | 'default' }> = {
  busy: { label: 'Занят', color: '#D32F2F', chip: 'error' },
  free: { label: 'Свободен', color: '#1B5E20', chip: 'success' },
  offline: { label: 'Не на смене', color: '#757575', chip: 'default' },
};

// A courier is busy when they have an active delivery; free when on shift with
// no active order; offline when they explicitly turned their shift off.
function getCourierStatus(c: CourierLocation): CourierStatus {
  if (c.hasActiveDelivery) return 'busy';
  if (c.isOnShift === false) return 'offline';
  return 'free';
}

interface MapViewProps {
  adminId: string;
}

// Одна "зона" на карте — район с количеством заказов
interface Zone {
  name: string;
  lat: number;
  lng: number;
  count: number;
}

type ZoneMode = 'start' | 'end';
type ZonePeriod = 'today' | 'week' | 'month' | 'all';

// Default center: Dushanbe
const DEFAULT_CENTER = { lat: 38.5598, lng: 68.7740 };

// Точность сетки для группировки координат (~0.008° ≈ 900 м)
const GRID_PRECISION = 0.008;

const mapContainerStyle = {
  width: '100%',
  height: '100%',
  minHeight: '500px',
  borderRadius: '16px',
};

const MapView: React.FC<MapViewProps> = ({ adminId }) => {
  const [couriers, setCouriers] = useState<CourierLocation[]>([]);
  const [ordersByCourier, setOrdersByCourier] = useState<Record<string, ActiveOrder>>({});
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedCourier, setSelectedCourier] = useState<string | null>(null);
  const [requestingLocation, setRequestingLocation] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' | 'warning' }>({
    open: false, message: '', severity: 'info'
  });

  // --- Разделы «Тепловая карта заказов» ---
  const [zoneMode, setZoneMode] = useState<ZoneMode>('start');
  const [zonePeriod, setZonePeriod] = useState<ZonePeriod>('week');
  const [startZones, setStartZones] = useState<Zone[]>([]);
  const [endZones, setEndZones] = useState<Zone[]>([]);
  const [zonesLoading, setZonesLoading] = useState(false);
  const [selectedZone, setSelectedZone] = useState<number | null>(null);
  // Кэш обратного геокодирования: ключ ячейки сетки -> название района
  const geocodeCacheRef = useRef<Record<string, string>>({});

  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
  });

  useEffect(() => {
    // Load ALL couriers
    const q = query(
      collection(db, 'users'),
      where('role', '==', 'COURIER')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as CourierLocation[];
      setCouriers(data);
    });

    // Listen for active deliveries to mark couriers as "busy"
    const deliveryQ = query(
      collection(db, 'deliveries'),
      where('status', '==', 'IN_PROGRESS')
    );
    const unsubDeliveries = onSnapshot(deliveryQ, (snapshot) => {
      const busyCourierIds = new Set(snapshot.docs.map(d => d.data().courierId));
      const orders: Record<string, ActiveOrder> = {};
      snapshot.docs.forEach(docSnap => {
        const d = docSnap.data() as any;
        if (!d.courierId) return;
        orders[d.courierId] = {
          id: docSnap.id,
          clientPhone: d.clientPhone,
          pickupAddress: d.pickup?.address,
          destinationAddress: d.destination?.address,
          adminOrderStage: d.adminOrderStage,
          orderKind: d.orderKind,
          cost: d.cost,
        };
      });
      setOrdersByCourier(orders);
      setCouriers(prev => prev.map(c => ({
        ...c,
        hasActiveDelivery: busyCourierIds.has(c.id)
      })));
    });

    return () => { unsubscribe(); unsubDeliveries(); };
  }, []);

  const handleRequestLocation = async (courierId: string) => {
    setRequestingLocation(courierId);
    try {
      const requestFn = httpsCallable(functions, 'requestCourierLocation');
      const result = await requestFn({ adminId, courierId });
      const data = result.data as { message?: string; hasToken?: boolean; lastLocation?: any };
      // If the callable returns a lastLocation (e.g. when courier app is closed)
      // update the UI immediately so admin sees the position without waiting
      // for the device to come online.
      if (data.lastLocation && data.lastLocation.latitude !== undefined && data.lastLocation.longitude !== undefined) {
        setCouriers(prev => prev.map(c => c.id === courierId ? ({
          ...c,
          lastLocation: {
            latitude: data.lastLocation.latitude,
            longitude: data.lastLocation.longitude,
            timestamp: data.lastLocation.timestamp || Date.now(),
          }
        } as CourierLocation) : c));

        // Select and center the map on this courier
        setSelectedCourier(courierId);
      }

      setSnackbar({
        open: true,
        message: data.message || 'Запрос отправлен',
        severity: data.hasToken === false ? 'warning' : 'success'
      });
    } catch (err: any) {
      setSnackbar({
        open: true,
        message: err.message || 'Ошибка запроса местоположения',
        severity: 'error'
      });
    } finally {
      setRequestingLocation(null);
    }
  };

  // Загружаем кэш геокодирования из localStorage один раз
  useEffect(() => {
    try {
      const saved = localStorage.getItem('zaki_zone_geocode_cache');
      if (saved) geocodeCacheRef.current = JSON.parse(saved);
    } catch { /* ignore */ }
  }, []);

  // Пересчитываем зоны при изменении периода (после загрузки карты)
  useEffect(() => {
    if (isLoaded) loadZones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zonePeriod, isLoaded]);

  const getZoneDateRange = (): { start: number; end: number } => {
    const now = new Date();
    const end = now.getTime();
    switch (zonePeriod) {
      case 'today':
        return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), end };
      case 'week':
        return { start: end - 7 * 86400000, end };
      case 'month':
        return { start: end - 30 * 86400000, end };
      case 'all':
      default:
        return { start: 0, end };
    }
  };

  // Обратное геокодирование центра ячейки -> название района (с кэшем)
  const reverseGeocode = (cellKey: string, lat: number, lng: number): Promise<string> => {
    if (geocodeCacheRef.current[cellKey]) {
      return Promise.resolve(geocodeCacheRef.current[cellKey]);
    }
    return new Promise((resolve) => {
      try {
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ location: { lat, lng } }, (results, status) => {
          let name = 'Неизвестный район';
          if (status === 'OK' && results && results.length > 0) {
            // Ищем компонент подходящего уровня: район/квартал -> город
            const preferredTypes = [
              'sublocality_level_1', 'sublocality', 'neighborhood',
              'administrative_area_level_3', 'administrative_area_level_2', 'locality',
            ];
            let found: string | null = null;
            for (const t of preferredTypes) {
              for (const r of results) {
                const comp = r.address_components?.find(c => c.types.includes(t));
                if (comp) { found = comp.long_name; break; }
              }
              if (found) break;
            }
            name = found || results[0].formatted_address || name;
          }
          geocodeCacheRef.current[cellKey] = name;
          try {
            localStorage.setItem('zaki_zone_geocode_cache', JSON.stringify(geocodeCacheRef.current));
          } catch { /* ignore */ }
          resolve(name);
        });
      } catch {
        resolve('Неизвестный район');
      }
    });
  };

  // Группируем точки в ячейки сетки -> геокодируем -> объединяем по названию района
  const buildZones = async (
    points: Array<{ lat: number; lng: number }>
  ): Promise<Zone[]> => {
    if (points.length === 0) return [];

    // 1. Группируем в ячейки сетки
    const cells: Record<string, { count: number; sumLat: number; sumLng: number }> = {};
    for (const p of points) {
      const gLat = Math.round(p.lat / GRID_PRECISION) * GRID_PRECISION;
      const gLng = Math.round(p.lng / GRID_PRECISION) * GRID_PRECISION;
      const key = `${gLat.toFixed(3)}_${gLng.toFixed(3)}`;
      if (!cells[key]) cells[key] = { count: 0, sumLat: 0, sumLng: 0 };
      cells[key].count++;
      cells[key].sumLat += p.lat;
      cells[key].sumLng += p.lng;
    }

    // 2. Берём топ ячеек чтобы ограничить кол-во запросов геокодирования
    const topCells = Object.entries(cells)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 25);

    // 3. Геокодируем и объединяем по названию района
    const byDistrict: Record<string, Zone> = {};
    for (const [key, cell] of topCells) {
      const centLat = cell.sumLat / cell.count;
      const centLng = cell.sumLng / cell.count;
      const name = await reverseGeocode(key, centLat, centLng);
      if (!byDistrict[name]) {
        byDistrict[name] = { name, lat: centLat, lng: centLng, count: 0 };
      }
      // взвешенный центр района
      const z = byDistrict[name];
      const total = z.count + cell.count;
      z.lat = (z.lat * z.count + centLat * cell.count) / total;
      z.lng = (z.lng * z.count + centLng * cell.count) / total;
      z.count = total;
    }

    return Object.values(byDistrict).sort((a, b) => b.count - a.count);
  };

  const loadZones = async () => {
    setZonesLoading(true);
    setSelectedZone(null);
    try {
      const { start, end } = getZoneDateRange();
      let q;
      if (zonePeriod === 'all') {
        q = query(collection(db, 'deliveries'));
      } else {
        q = query(
          collection(db, 'deliveries'),
          where('createdAt', '>=', start),
          where('createdAt', '<=', end)
        );
      }
      const snapshot = await getDocs(q);

      const startPoints: Array<{ lat: number; lng: number }> = [];
      const endPoints: Array<{ lat: number; lng: number }> = [];

      snapshot.forEach((docSnap) => {
        const d = docSnap.data() as any;
        if (d.status === 'CANCELLED') return;

        // Точка начала заказа: pickup либо первая точка маршрута
        const startPt = d.pickup && d.pickup.latitude != null
          ? { lat: d.pickup.latitude, lng: d.pickup.longitude }
          : (Array.isArray(d.route) && d.route.length > 0
              ? { lat: d.route[0].latitude, lng: d.route[0].longitude }
              : null);
        if (startPt && startPt.lat != null && startPt.lng != null) startPoints.push(startPt);

        // Точка завершения — только для выполненных заказов
        if (d.status === 'COMPLETED') {
          const endPt = d.destination && d.destination.latitude != null
            ? { lat: d.destination.latitude, lng: d.destination.longitude }
            : (Array.isArray(d.route) && d.route.length > 0
                ? { lat: d.route[d.route.length - 1].latitude, lng: d.route[d.route.length - 1].longitude }
                : null);
          if (endPt && endPt.lat != null && endPt.lng != null) endPoints.push(endPt);
        }
      });

      const [sZones, eZones] = await Promise.all([
        buildZones(startPoints),
        buildZones(endPoints),
      ]);
      setStartZones(sZones);
      setEndZones(eZones);
    } catch (err: any) {
      setSnackbar({
        open: true,
        message: 'Ошибка загрузки зон: ' + (err.message || 'неизвестно'),
        severity: 'error',
      });
    } finally {
      setZonesLoading(false);
    }
  };

  // Couriers matching the active status filter (used for both map + list).
  const visibleCouriers = statusFilter === 'all'
    ? couriers
    : couriers.filter(c => getCourierStatus(c) === statusFilter);

  const statusCounts = {
    all: couriers.length,
    busy: couriers.filter(c => getCourierStatus(c) === 'busy').length,
    free: couriers.filter(c => getCourierStatus(c) === 'free').length,
    offline: couriers.filter(c => getCourierStatus(c) === 'offline').length,
  };

  // Center map on first courier with location, else default
  const mapCenter = (() => {
    const selected = couriers.find(c => c.id === selectedCourier && c.lastLocation);
    if (selected?.lastLocation) {
      return {
        lat: selected.lastLocation.latitude,
        lng: selected.lastLocation.longitude,
      };
    }
    const withLocation = couriers.find(c => c.lastLocation);
    if (withLocation?.lastLocation) {
      return {
        lat: withLocation.lastLocation.latitude,
        lng: withLocation.lastLocation.longitude,
      };
    }
    return DEFAULT_CENTER;
  })();

  const formatTimestamp = (timestamp?: number) => {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return 'только что';
    if (diffMin < 60) return `${diffMin} мин назад`;
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)} ч назад`;
    return date.toLocaleString('ru-RU');
  };

  const renderMap = () => {
    if (loadError) {
      return (
        <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 500 }}>
          <Box textAlign="center">
            <Typography variant="h6" color="error">Ошибка загрузки карты</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Убедитесь, что для ключа включён "Maps JavaScript API"
            </Typography>
          </Box>
        </Box>
      );
    }

    if (!isLoaded) {
      return (
        <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 500 }}>
          <Typography color="text.secondary">Загрузка карты...</Typography>
        </Box>
      );
    }

    return (
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={mapCenter}
        zoom={12}
        options={{
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: true,
        }}
      >
        {visibleCouriers
          .filter(c => c.lastLocation)
          .map(courier => {
            const status = getCourierStatus(courier);
            const order = ordersByCourier[courier.id];
            return (
            <MarkerF
              key={courier.id}
              position={{
                lat: courier.lastLocation!.latitude,
                lng: courier.lastLocation!.longitude,
              }}
              onClick={() => setSelectedCourier(courier.id)}
              icon={{
                url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
                  `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
                    <circle cx="20" cy="20" r="12" fill="${STATUS_META[status].color}" stroke="white" stroke-width="3"/>
                    <circle cx="20" cy="20" r="4" fill="white"/>
                  </svg>`
                ),
                scaledSize: new google.maps.Size(40, 40),
                anchor: new google.maps.Point(20, 20),
              }}
            >
              {selectedCourier === courier.id && (
                <InfoWindowF onCloseClick={() => setSelectedCourier(null)}>
                  <Box sx={{ p: 0.5, minWidth: 180 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      {courier.name}
                    </Typography>
                    <Chip
                      label={STATUS_META[status].label}
                      color={STATUS_META[status].chip}
                      size="small"
                      sx={{ my: 0.5 }}
                    />
                    <Typography variant="caption" color="text.secondary" display="block">
                      {formatTimestamp(courier.lastLocation?.timestamp)}
                    </Typography>
                    {status === 'busy' && order && (
                      <Box sx={{ mt: 0.5, pt: 0.5, borderTop: '1px solid #eee' }}>
                        <Typography variant="caption" sx={{ fontWeight: 600 }} display="block">
                          Текущий заказ
                        </Typography>
                        {order.clientPhone && (
                          <Typography variant="caption" display="block">Клиент: {order.clientPhone}</Typography>
                        )}
                        {order.pickupAddress && (
                          <Typography variant="caption" display="block">Откуда: {order.pickupAddress}</Typography>
                        )}
                        {order.destinationAddress && (
                          <Typography variant="caption" display="block">Куда: {order.destinationAddress}</Typography>
                        )}
                      </Box>
                    )}
                  </Box>
                </InfoWindowF>
              )}
            </MarkerF>
          );
        })}
      </GoogleMap>
    );
  };

  const renderZonesSection = () => {
    const zones = zoneMode === 'start' ? startZones : endZones;
    const maxCount = zones.length > 0 ? zones[0].count : 0;
    const baseColor = zoneMode === 'start' ? '#1B5E20' : '#D32F2F';

    // Центр карты зон — самая активная зона либо Душанбе
    const zonesCenter = zones.length > 0
      ? { lat: zones[0].lat, lng: zones[0].lng }
      : DEFAULT_CENTER;

    const periodLabels: Record<ZonePeriod, string> = {
      today: 'Сегодня', week: 'Неделя', month: 'Месяц', all: 'Всё время',
    };

    return (
      <Box sx={{ mt: 5 }}>
        <Divider sx={{ mb: 3 }} />
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Заказы по районам
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <ToggleButtonGroup
              value={zoneMode}
              exclusive
              size="small"
              onChange={(_, val) => val && (setZoneMode(val), setSelectedZone(null))}
            >
              <ToggleButton value="start"><TrendingUp fontSize="small" sx={{ mr: 0.5 }} />Где начинаются</ToggleButton>
              <ToggleButton value="end"><Flag fontSize="small" sx={{ mr: 0.5 }} />Где завершаются</ToggleButton>
            </ToggleButtonGroup>
            <ToggleButtonGroup
              value={zonePeriod}
              exclusive
              size="small"
              onChange={(_, val) => val && setZonePeriod(val)}
            >
              {Object.entries(periodLabels).map(([key, label]) => (
                <ToggleButton key={key} value={key}>{label}</ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>
        </Box>

        {zonesLoading && <LinearProgress sx={{ mb: 2, borderRadius: 1 }} />}

        <Box sx={{ display: 'flex', gap: 3, flexDirection: { xs: 'column', md: 'row' } }}>
          {/* Карта зон */}
          <Card sx={{ flex: 2, minHeight: 450, overflow: 'hidden' }}>
            {isLoaded ? (
              <GoogleMap
                mapContainerStyle={{ ...mapContainerStyle, minHeight: '450px' }}
                center={zonesCenter}
                zoom={12}
                options={{ streetViewControl: false, mapTypeControl: false, fullscreenControl: true }}
              >
                {zones.map((zone, idx) => {
                  const ratio = maxCount > 0 ? zone.count / maxCount : 0;
                  // Радиус 250..1400 м в зависимости от доли заказов
                  const radius = 250 + ratio * 1150;
                  return (
                    <CircleF
                      key={`${zone.name}-${idx}`}
                      center={{ lat: zone.lat, lng: zone.lng }}
                      radius={radius}
                      onClick={() => setSelectedZone(idx)}
                      options={{
                        strokeColor: baseColor,
                        strokeOpacity: 0.8,
                        strokeWeight: selectedZone === idx ? 3 : 1,
                        fillColor: baseColor,
                        fillOpacity: 0.15 + ratio * 0.45,
                        clickable: true,
                      }}
                    />
                  );
                })}
                {selectedZone != null && zones[selectedZone] && (
                  <InfoWindowF
                    position={{ lat: zones[selectedZone].lat, lng: zones[selectedZone].lng }}
                    onCloseClick={() => setSelectedZone(null)}
                  >
                    <Box sx={{ p: 0.5 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        {zones[selectedZone].name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {zoneMode === 'start' ? 'Начато заказов: ' : 'Завершено заказов: '}
                        {zones[selectedZone].count}
                      </Typography>
                    </Box>
                  </InfoWindowF>
                )}
              </GoogleMap>
            ) : (
              <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 450 }}>
                <Typography color="text.secondary">Загрузка карты...</Typography>
              </Box>
            )}
          </Card>

          {/* Рейтинг районов */}
          <Card sx={{ flex: 1, maxHeight: 550, overflow: 'auto' }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 0.5 }}>
                {zoneMode === 'start' ? 'Топ районов по началу заказов' : 'Топ районов по завершению заказов'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {zoneMode === 'start'
                  ? 'Откуда чаще всего стартуют заказы'
                  : 'Куда чаще всего доставляют заказы'}
              </Typography>
              <List sx={{ mt: 1 }}>
                {zones.map((zone, idx) => {
                  const ratio = maxCount > 0 ? zone.count / maxCount : 0;
                  return (
                    <ListItem key={`${zone.name}-${idx}`} divider disablePadding>
                      <ListItemButton
                        selected={selectedZone === idx}
                        onClick={() => setSelectedZone(idx)}
                      >
                        <Box sx={{ width: '100%' }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {idx + 1}. {zone.name}
                            </Typography>
                            <Chip
                              label={zone.count}
                              size="small"
                              sx={{ bgcolor: baseColor, color: 'white', fontWeight: 600 }}
                            />
                          </Box>
                          <LinearProgress
                            variant="determinate"
                            value={ratio * 100}
                            sx={{
                              mt: 0.5, height: 6, borderRadius: 3,
                              bgcolor: '#eee',
                              '& .MuiLinearProgress-bar': { bgcolor: baseColor },
                            }}
                          />
                        </Box>
                      </ListItemButton>
                    </ListItem>
                  );
                })}
                {!zonesLoading && zones.length === 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
                    Нет данных за выбранный период
                  </Typography>
                )}
              </List>
            </CardContent>
          </Card>
        </Box>
      </Box>
    );
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 3 }}>
        Карта курьеров
      </Typography>

      <Box sx={{ display: 'flex', gap: 3, flexDirection: { xs: 'column', md: 'row' } }}>
        {/* Map */}
        <Card sx={{ flex: 2, minHeight: 500, overflow: 'hidden' }}>
          {renderMap()}
        </Card>

        {/* Couriers list */}
        <Card sx={{ flex: 1, maxHeight: 600, overflow: 'auto' }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1.5 }}>
              Курьеры ({visibleCouriers.length}/{couriers.length})
            </Typography>

            {/* Dispatcher status filter */}
            <ToggleButtonGroup
              value={statusFilter}
              exclusive
              size="small"
              fullWidth
              onChange={(_, val) => val && setStatusFilter(val)}
              sx={{ mb: 2, flexWrap: 'wrap' }}
            >
              <ToggleButton value="all">Все ({statusCounts.all})</ToggleButton>
              <ToggleButton value="free">Свободен ({statusCounts.free})</ToggleButton>
              <ToggleButton value="busy">Занят ({statusCounts.busy})</ToggleButton>
              <ToggleButton value="offline">Не на смене ({statusCounts.offline})</ToggleButton>
            </ToggleButtonGroup>

            <List>
              {visibleCouriers.map((courier) => {
                const status = getCourierStatus(courier);
                const order = ordersByCourier[courier.id];
                const isSelected = selectedCourier === courier.id;
                return (
                <React.Fragment key={courier.id}>
                <ListItem
                  divider={!isSelected}
                  disablePadding
                  secondaryAction={
                    <Tooltip title="Запросить местоположение">
                      <IconButton
                        edge="end"
                        color="primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRequestLocation(courier.id);
                        }}
                        disabled={requestingLocation === courier.id}
                      >
                        {requestingLocation === courier.id ? (
                          <CircularProgress size={20} />
                        ) : (
                          <MyLocation />
                        )}
                      </IconButton>
                    </Tooltip>
                  }
                >
                  <ListItemButton
                    selected={isSelected}
                    onClick={() => setSelectedCourier(isSelected ? null : courier.id)}
                  >
                    <ListItemText
                      primary={courier.name}
                      secondary={
                        courier.lastLocation
                          ? formatTimestamp(courier.lastLocation.timestamp)
                          : 'Нет данных о местоположении'
                      }
                    />
                    <Chip
                      label={STATUS_META[status].label}
                      color={STATUS_META[status].chip}
                      size="small"
                      sx={{ mr: 1 }}
                    />
                  </ListItemButton>
                </ListItem>
                {/* Current order details for a selected busy courier */}
                {isSelected && status === 'busy' && order && (
                  <Box sx={{ px: 2, py: 1.5, bgcolor: 'action.hover', borderBottom: '1px solid #eee' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                      Текущий заказ {order.orderKind === 'MARKETPLACE' ? '(админ)' : ''}
                    </Typography>
                    {order.clientPhone && (
                      <Typography variant="body2">Клиент: {order.clientPhone}</Typography>
                    )}
                    {order.pickupAddress && (
                      <Typography variant="body2">Откуда: {order.pickupAddress}</Typography>
                    )}
                    {order.destinationAddress && (
                      <Typography variant="body2">Куда: {order.destinationAddress}</Typography>
                    )}
                    {order.adminOrderStage && (
                      <Typography variant="caption" color="text.secondary">
                        Этап: {order.adminOrderStage}
                      </Typography>
                    )}
                  </Box>
                )}
                </React.Fragment>
              );
            })}
              {visibleCouriers.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
                  Нет курьеров
                </Typography>
              )}
            </List>
          </CardContent>
        </Card>
      </Box>

      {/* --- Тепловая карта заказов по районам --- */}
      {renderZonesSection()}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          variant="filled"
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default MapView;
