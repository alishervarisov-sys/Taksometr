import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Card, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, TextField, InputAdornment, Dialog,
  DialogTitle, DialogContent, DialogActions, Button, Grid, Divider,
  MenuItem, ToggleButtonGroup, ToggleButton, Stack, Alert
} from '@mui/material';
import { Search } from '@mui/icons-material';
import { collection, getDocs, query, orderBy, limit, doc, getDoc, updateDoc, where } from 'firebase/firestore';
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

interface CourierOption {
  id: string;
  name: string;
}

type Period = 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'year';
type ReportType = 'commission' | 'earnings';

const Deliveries: React.FC = () => {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Filters
  const [couriers, setCouriers] = useState<CourierOption[]>([]);
  const [selectedCourier, setSelectedCourier] = useState('all');
  const [period, setPeriod] = useState<Period>('all');
  const [reportType, setReportType] = useState<ReportType>('earnings');
  const [reportResult, setReportResult] = useState<{ total: number; count: number } | null>(null);

  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
  });

  useEffect(() => {
    loadDeliveries();
    loadCouriers();
  }, []);

  const loadCouriers = async () => {
    const q = query(collection(db, 'users'), where('role', '==', 'COURIER'));
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map(d => ({ id: d.id, name: d.data().name || '' }));
    setCouriers(data);
  };

  const loadDeliveries = async () => {
    const q = query(
      collection(db, 'deliveries'),
      orderBy('createdAt', 'desc'),
      limit(200)
    );
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map(d => ({
      id: d.id,
      ...d.data()
    })) as Delivery[];
    setDeliveries(data);
  };

  const getDateRange = (p: Period): { start: number; end: number } => {
    const now = new Date();
    const end = now.getTime();
    let start = 0;
    switch (p) {
      case 'today': {
        const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        start = t.getTime(); break;
      }
      case 'yesterday': {
        const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        start = y.getTime(); break;
      }
      case 'week': start = end - 7 * 86400000; break;
      case 'month': start = end - 30 * 86400000; break;
      case 'year': start = end - 365 * 86400000; break;
      default: start = 0;
    }
    return { start, end };
  };

  const handleCalculate = () => {
    const { start, end } = getDateRange(period);
    const filtered = deliveries.filter(d => {
      if (d.status !== 'COMPLETED') return false;
      if (selectedCourier !== 'all' && d.courierId !== selectedCourier) return false;
      if (period !== 'all' && (d.createdAt < start || d.createdAt > end)) return false;
      return true;
    });

    const total = filtered.reduce((sum, d) => {
      return sum + (reportType === 'commission' ? (d.commission || 0) : (d.cost || 0));
    }, 0);

    setReportResult({ total, count: filtered.length });
  };

  const handleCancelDelivery = async (deliveryId: string) => {
    if (!window.confirm('Отменить эту доставку?')) return;
    try {
      await updateDoc(doc(db, 'deliveries', deliveryId), {
        status: 'CANCELLED',
        endTime: Date.now(),
      });
      loadDeliveries();
    } catch {
      alert('Ошибка отмены');
    }
  };

  const handleRowClick = async (delivery: Delivery) => {
    if (!delivery.route || delivery.route.length === 0) {
      try {
        const docRef = doc(db, 'deliveries', delivery.id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setSelectedDelivery({ id: docSnap.id, ...docSnap.data() } as Delivery);
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
      case 'COMPLETED': return <Chip label="Завершена" color="success" size="small" />;
      case 'IN_PROGRESS': return <Chip label="В процессе" color="info" size="small" />;
      case 'CANCELLED': return <Chip label="Отменена" color="error" size="small" />;
      default: return <Chip label={status} size="small" />;
    }
  };

  const formatDate = (ts: number) => ts ? new Date(ts).toLocaleString('ru-RU') : '—';
  const formatDistance = (m: number) => {
    if (!m) return '0 м';
    return m < 1000 ? `${Math.round(m)} м` : `${(m / 1000).toFixed(1)} км`;
  };
  const formatCost = (cost: number) => {
    const s = Math.floor(cost); const d = Math.round((cost - s) * 100);
    return d > 0 ? `${s.toLocaleString()}.${String(d).padStart(2, '0')} сомони` : `${s.toLocaleString()} сомони`;
  };
  const formatDuration = (start: number, end: number | null) => {
    if (!start) return '—';
    const mins = Math.floor(((end || Date.now()) - start) / 60000);
    return mins >= 60 ? `${Math.floor(mins / 60)} ч ${mins % 60} мин` : `${mins} мин`;
  };
  const getMapCenter = (route: Array<{ latitude: number; longitude: number }>) => {
    if (!route || route.length === 0) return { lat: 38.5598, lng: 68.7740 };
    const mid = route[Math.floor(route.length / 2)];
    return { lat: mid.latitude, lng: mid.longitude };
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 3 }}>Доставки</Typography>

      {/* Report calculator */}
      <Card sx={{ mb: 3, p: 2 }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>Отчёт</Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
          <TextField select size="small" label="Курьер" value={selectedCourier}
            onChange={(e) => setSelectedCourier(e.target.value)} sx={{ minWidth: 180 }}>
            <MenuItem value="all">Все курьеры</MenuItem>
            {couriers.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </TextField>

          <ToggleButtonGroup value={period} exclusive size="small"
            onChange={(_, v) => v && setPeriod(v)}>
            <ToggleButton value="today">Сегодня</ToggleButton>
            <ToggleButton value="yesterday">Вчера</ToggleButton>
            <ToggleButton value="week">Неделя</ToggleButton>
            <ToggleButton value="month">Месяц</ToggleButton>
            <ToggleButton value="year">Год</ToggleButton>
            <ToggleButton value="all">Все</ToggleButton>
          </ToggleButtonGroup>

          <ToggleButtonGroup value={reportType} exclusive size="small"
            onChange={(_, v) => v && setReportType(v)}>
            <ToggleButton value="earnings">Заработок</ToggleButton>
            <ToggleButton value="commission">Комиссия</ToggleButton>
          </ToggleButtonGroup>

          <Button variant="contained" size="small" onClick={handleCalculate}>
            Рассчитать
          </Button>

          {reportResult && (
            <Alert severity="info" sx={{ py: 0 }}>
              {reportType === 'commission' ? 'Комиссия' : 'Заработок'}:
              <strong> {formatCost(reportResult.total)}</strong> ({reportResult.count} доставок)
            </Alert>
          )}
        </Stack>
      </Card>

      <TextField
        fullWidth placeholder="Поиск по номеру телефона или имени курьера"
        value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} sx={{ mb: 2 }}
        InputProps={{ startAdornment: <InputAdornment position="start"><Search /></InputAdornment> }}
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
                <TableRow key={delivery.id} hover sx={{ cursor: 'pointer' }}
                  onClick={() => handleRowClick(delivery)}>
                  <TableCell>{formatDate(delivery.createdAt)}</TableCell>
                  <TableCell>{delivery.courierName}</TableCell>
                  <TableCell>{delivery.clientPhone}</TableCell>
                  <TableCell>{formatDistance(delivery.distanceMeters)}</TableCell>
                  <TableCell>{formatCost(delivery.cost || 0)}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {getStatusChip(delivery.status)}
                      {delivery.status === 'IN_PROGRESS' && (
                        <Button size="small" color="error" variant="outlined"
                          onClick={(e) => { e.stopPropagation(); handleCancelDelivery(delivery.id); }}>
                          Отменить
                        </Button>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Detail dialog */}
      <Dialog open={detailOpen} onClose={() => setDetailOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Детали доставки
          {selectedDelivery && getStatusChip(selectedDelivery.status)}
        </DialogTitle>
        <DialogContent>
          {selectedDelivery && (
            <Box>
              {isLoaded && selectedDelivery.route && selectedDelivery.route.length > 0 ? (
                <Box sx={{ height: 300, borderRadius: 2, overflow: 'hidden', mb: 2 }}>
                  <GoogleMap mapContainerStyle={{ width: '100%', height: '100%' }}
                    center={getMapCenter(selectedDelivery.route)} zoom={14}
                    options={{ streetViewControl: false, mapTypeControl: false }}>
                    <PolylineF path={selectedDelivery.route.map(p => ({ lat: p.latitude, lng: p.longitude }))}
                      options={{ strokeColor: '#1B5E20', strokeWeight: 4 }} />
                    <MarkerF position={{ lat: selectedDelivery.route[0].latitude, lng: selectedDelivery.route[0].longitude }} label="A" />
                    <MarkerF position={{ lat: selectedDelivery.route[selectedDelivery.route.length - 1].latitude, lng: selectedDelivery.route[selectedDelivery.route.length - 1].longitude }} label="B" />
                  </GoogleMap>
                </Box>
              ) : (
                <Box sx={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#f5f5f5', borderRadius: 2, mb: 2 }}>
                  <Typography color="text.secondary">Маршрут не доступен</Typography>
                </Box>
              )}
              <Grid container spacing={2}>
                <Grid item xs={6}><Typography variant="body2" color="text.secondary">Курьер</Typography><Typography fontWeight={600}>{selectedDelivery.courierName}</Typography></Grid>
                <Grid item xs={6}><Typography variant="body2" color="text.secondary">Клиент</Typography><Typography fontWeight={600}>{selectedDelivery.clientPhone}</Typography></Grid>
                <Grid item xs={12}><Divider /></Grid>
                <Grid item xs={4}><Typography variant="body2" color="text.secondary">Начало</Typography><Typography>{formatDate(selectedDelivery.startTime)}</Typography></Grid>
                <Grid item xs={4}><Typography variant="body2" color="text.secondary">Конец</Typography><Typography>{selectedDelivery.endTime ? formatDate(selectedDelivery.endTime) : 'В процессе'}</Typography></Grid>
                <Grid item xs={4}><Typography variant="body2" color="text.secondary">Длительность</Typography><Typography>{formatDuration(selectedDelivery.startTime, selectedDelivery.endTime)}</Typography></Grid>
                <Grid item xs={12}><Divider /></Grid>
                <Grid item xs={3}><Typography variant="body2" color="text.secondary">Расстояние</Typography><Typography fontWeight={600}>{formatDistance(selectedDelivery.distanceMeters)}</Typography></Grid>
                <Grid item xs={3}><Typography variant="body2" color="text.secondary">Стоимость</Typography><Typography fontWeight={600} color="green">{formatCost(selectedDelivery.cost || 0)}</Typography></Grid>
                <Grid item xs={3}><Typography variant="body2" color="text.secondary">Комиссия</Typography><Typography fontWeight={600} color="orange">{formatCost(selectedDelivery.commission || 0)}</Typography></Grid>
                <Grid item xs={3}><Typography variant="body2" color="text.secondary">Ожидание</Typography><Typography fontWeight={600}>{selectedDelivery.waitingMinutes ? `${Math.ceil(selectedDelivery.waitingMinutes)} мин (${formatCost(selectedDelivery.waitingCost || 0)})` : '—'}</Typography></Grid>
              </Grid>
            </Box>
          )}
        </DialogContent>
        <DialogActions><Button onClick={() => setDetailOpen(false)}>Закрыть</Button></DialogActions>
      </Dialog>
    </Box>
  );
};

export default Deliveries;
