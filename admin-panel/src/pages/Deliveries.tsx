import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Card, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, TextField, InputAdornment, Dialog,
  DialogTitle, DialogContent, DialogActions, Button, Grid, Divider
} from '@mui/material';
import { Search, Close } from '@mui/icons-material';
import { collection, getDocs, query, orderBy, limit, doc, getDoc } from 'firebase/firestore';
import { GoogleMap, useJsApiLoader, PolylineF, MarkerF } from '@react-google-maps/api';
import { db, GOOGLE_MAPS_API_KEY } from '../firebase';

interface Delivery {
  id: string;
  courierId: string;
  courierName: string;
  clientPhone: string;
  status: string;
  distanceMeters: number;
  cost: number;
  commission: number;
  waitingMinutes: number;
  waitingCost: number;
  startTime: number;
  endTime: number | null;
  createdAt: number;
  route: Array<{ latitude: number; longitude: number }>;
}

const Deliveries: React.FC = () => {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
  });

  useEffect(() => {
    loadDeliveries();
  }, []);

  const loadDeliveries = async () => {
    const q = query(
      collection(db, 'deliveries'),
      orderBy('createdAt', 'desc'),
      limit(100)
    );
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map(d => ({
      id: d.id,
      ...d.data()
    })) as Delivery[];
    setDeliveries(data);
  };

  const handleRowClick = async (delivery: Delivery) => {
    // If route is not loaded yet, fetch full document
    if (!delivery.route || delivery.route.length === 0) {
      try {
        const docRef = doc(db, 'deliveries', delivery.id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const fullData = { id: docSnap.id, ...docSnap.data() } as Delivery;
          setSelectedDelivery(fullData);
        } else {
          setSelectedDelivery(delivery);
        }
      } catch {
        setSelectedDelivery(delivery);
      }
    } else {
      setSelectedDelivery(delivery);
    }
    setDetailOpen(true);
  };

  const filteredDeliveries = deliveries.filter(d =>
    d.clientPhone?.includes(searchQuery) ||
    d.courierName?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getStatusChip = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return <Chip label="Завершена" color="success" size="small" />;
      case 'IN_PROGRESS':
        return <Chip label="В процессе" color="info" size="small" />;
      case 'CANCELLED':
        return <Chip label="Отменена" color="error" size="small" />;
      default:
        return <Chip label={status} size="small" />;
    }
  };

  const formatDate = (timestamp: number) => {
    if (!timestamp) return '—';
    return new Date(timestamp).toLocaleString('ru-RU');
  };

  const formatDistance = (meters: number) => {
    if (!meters) return '0 м';
    if (meters < 1000) return `${Math.round(meters)} м`;
    return `${(meters / 1000).toFixed(1)} км`;
  };

  const formatCost = (cost: number) => {
    const somoni = Math.floor(cost);
    const diram = Math.round((cost - somoni) * 100);
    if (diram > 0) return `${somoni.toLocaleString()}.${String(diram).padStart(2, '0')} сомони`;
    return `${somoni.toLocaleString()} сомони`;
  };

  const formatDuration = (startTime: number, endTime: number | null) => {
    if (!startTime) return '—';
    const end = endTime || Date.now();
    const diffMs = end - startTime;
    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours} ч ${minutes % 60} мин`;
    return `${minutes} мин`;
  };

  // Map center from route
  const getMapCenter = (route: Array<{ latitude: number; longitude: number }>) => {
    if (!route || route.length === 0) return { lat: 38.5598, lng: 68.7740 };
    const mid = route[Math.floor(route.length / 2)];
    return { lat: mid.latitude, lng: mid.longitude };
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 3 }}>Доставки</Typography>

      <TextField
        fullWidth
        placeholder="Поиск по номеру телефона или имени курьера"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        sx={{ mb: 3 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <Search />
            </InputAdornment>
          ),
        }}
      />

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Дата</TableCell>
                <TableCell>Курьер</TableCell>
                <TableCell>Клиент</TableCell>
                <TableCell>Расстояние</TableCell>
                <TableCell>Стоимость</TableCell>
                <TableCell>Статус</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredDeliveries.map((delivery) => (
                <TableRow
                  key={delivery.id}
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => handleRowClick(delivery)}
                >
                  <TableCell>{formatDate(delivery.createdAt)}</TableCell>
                  <TableCell>{delivery.courierName}</TableCell>
                  <TableCell>{delivery.clientPhone}</TableCell>
                  <TableCell>{formatDistance(delivery.distanceMeters)}</TableCell>
                  <TableCell>{formatCost(delivery.cost || 0)}</TableCell>
                  <TableCell>{getStatusChip(delivery.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Delivery detail dialog with map */}
      <Dialog open={detailOpen} onClose={() => setDetailOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Детали доставки
          {selectedDelivery && getStatusChip(selectedDelivery.status)}
        </DialogTitle>
        <DialogContent>
          {selectedDelivery && (
            <Box>
              {/* Route map */}
              {isLoaded && selectedDelivery.route && selectedDelivery.route.length > 0 ? (
                <Box sx={{ height: 300, borderRadius: 2, overflow: 'hidden', mb: 2 }}>
                  <GoogleMap
                    mapContainerStyle={{ width: '100%', height: '100%' }}
                    center={getMapCenter(selectedDelivery.route)}
                    zoom={14}
                    options={{ streetViewControl: false, mapTypeControl: false }}
                  >
                    <PolylineF
                      path={selectedDelivery.route.map(p => ({ lat: p.latitude, lng: p.longitude }))}
                      options={{ strokeColor: '#1B5E20', strokeWeight: 4 }}
                    />
                    {/* Start marker */}
                    <MarkerF
                      position={{
                        lat: selectedDelivery.route[0].latitude,
                        lng: selectedDelivery.route[0].longitude
                      }}
                      label="A"
                    />
                    {/* End marker */}
                    <MarkerF
                      position={{
                        lat: selectedDelivery.route[selectedDelivery.route.length - 1].latitude,
                        lng: selectedDelivery.route[selectedDelivery.route.length - 1].longitude
                      }}
                      label="B"
                    />
                  </GoogleMap>
                </Box>
              ) : (
                <Box sx={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#f5f5f5', borderRadius: 2, mb: 2 }}>
                  <Typography color="text.secondary">Маршрут не доступен</Typography>
                </Box>
              )}

              {/* Details */}
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">Курьер</Typography>
                  <Typography variant="body1" fontWeight={600}>{selectedDelivery.courierName}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">Клиент</Typography>
                  <Typography variant="body1" fontWeight={600}>{selectedDelivery.clientPhone}</Typography>
                </Grid>
                <Grid item xs={12}><Divider /></Grid>
                <Grid item xs={4}>
                  <Typography variant="body2" color="text.secondary">Начало</Typography>
                  <Typography variant="body1">{formatDate(selectedDelivery.startTime)}</Typography>
                </Grid>
                <Grid item xs={4}>
                  <Typography variant="body2" color="text.secondary">Конец</Typography>
                  <Typography variant="body1">{selectedDelivery.endTime ? formatDate(selectedDelivery.endTime) : 'В процессе'}</Typography>
                </Grid>
                <Grid item xs={4}>
                  <Typography variant="body2" color="text.secondary">Длительность</Typography>
                  <Typography variant="body1">{formatDuration(selectedDelivery.startTime, selectedDelivery.endTime)}</Typography>
                </Grid>
                <Grid item xs={12}><Divider /></Grid>
                <Grid item xs={3}>
                  <Typography variant="body2" color="text.secondary">Расстояние</Typography>
                  <Typography variant="body1" fontWeight={600}>{formatDistance(selectedDelivery.distanceMeters)}</Typography>
                </Grid>
                <Grid item xs={3}>
                  <Typography variant="body2" color="text.secondary">Стоимость</Typography>
                  <Typography variant="body1" fontWeight={600} color="green">
                    {formatCost(selectedDelivery.cost || 0)}
                  </Typography>
                </Grid>
                <Grid item xs={3}>
                  <Typography variant="body2" color="text.secondary">Комиссия</Typography>
                  <Typography variant="body1" fontWeight={600} color="orange">
                    {formatCost(selectedDelivery.commission || 0)}
                  </Typography>
                </Grid>
                <Grid item xs={3}>
                  <Typography variant="body2" color="text.secondary">Ожидание</Typography>
                  <Typography variant="body1" fontWeight={600}>
                    {selectedDelivery.waitingMinutes
                      ? `${Math.ceil(selectedDelivery.waitingMinutes)} мин (${(selectedDelivery.waitingCost || 0).toLocaleString()} с.)`
                      : '—'}
                  </Typography>
                </Grid>
              </Grid>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailOpen(false)}>Закрыть</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Deliveries;
