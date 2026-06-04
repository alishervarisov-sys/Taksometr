import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Card, CardContent, Chip, List, ListItem,
  ListItemText, ListItemButton, IconButton, Tooltip, CircularProgress,
  Snackbar, Alert
} from '@mui/material';
import { MyLocation } from '@mui/icons-material';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { GoogleMap, useJsApiLoader, MarkerF, InfoWindowF } from '@react-google-maps/api';
import { db, functions, GOOGLE_MAPS_API_KEY } from '../firebase';

interface CourierLocation {
  id: string;
  name: string;
  phone: string;
  isOnline: boolean;
  lastLocation?: {
    latitude: number;
    longitude: number;
    timestamp: number;
  };
  hasActiveDelivery?: boolean;
}

interface MapViewProps {
  adminId: string;
}

// Default center: Dushanbe
const DEFAULT_CENTER = { lat: 38.5598, lng: 68.7740 };

const mapContainerStyle = {
  width: '100%',
  height: '100%',
  minHeight: '500px',
  borderRadius: '16px',
};

const MapView: React.FC<MapViewProps> = ({ adminId }) => {
  const [couriers, setCouriers] = useState<CourierLocation[]>([]);
  const [selectedCourier, setSelectedCourier] = useState<string | null>(null);
  const [requestingLocation, setRequestingLocation] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' | 'warning' }>({
    open: false, message: '', severity: 'info'
  });

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
      
      setSnackbar({
        open: true,
        message: data.message || 'Запрос отправлен',
        severity: data.hasToken === false ? 'warning' : 'success'
      });
      
      // If we got lastLocation in response, we could update the UI immediately
      // but since we're using real-time listeners, it will update automatically
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
        {couriers
          .filter(c => c.lastLocation)
          .map(courier => (
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
                    <circle cx="20" cy="20" r="12" fill="${courier.hasActiveDelivery ? '#D32F2F' : courier.isOnline ? '#1B5E20' : '#757575'}" stroke="white" stroke-width="3"/>
                    <circle cx="20" cy="20" r="4" fill="white"/>
                  </svg>`
                ),
                scaledSize: new google.maps.Size(40, 40),
                anchor: new google.maps.Point(20, 20),
              }}
            >
              {selectedCourier === courier.id && (
                <InfoWindowF onCloseClick={() => setSelectedCourier(null)}>
                  <Box sx={{ p: 0.5 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      {courier.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatTimestamp(courier.lastLocation?.timestamp)}
                    </Typography>
                  </Box>
                </InfoWindowF>
              )}
            </MarkerF>
          ))}
      </GoogleMap>
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
            <Typography variant="h6" sx={{ mb: 2 }}>
              Курьеры ({couriers.length})
            </Typography>
            <List>
              {couriers.map((courier) => (
                <ListItem
                  key={courier.id}
                  divider
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
                    selected={selectedCourier === courier.id}
                    onClick={() => setSelectedCourier(courier.id)}
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
                      label={courier.hasActiveDelivery ? 'Занят' : courier.isOnline ? 'Онлайн' : 'Оффлайн'}
                      color={courier.hasActiveDelivery ? 'error' : courier.isOnline ? 'success' : 'default'}
                      size="small"
                      sx={{ mr: 1 }}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
              {couriers.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
                  Нет курьеров
                </Typography>
              )}
            </List>
          </CardContent>
        </Card>
      </Box>

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
