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
import { db, GOOGLE_MAPS_API_KEY, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';

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
  orderKind?: string;
  adminOrderStage?: string;
  comment?: string;
  courierPhone?: string;
  pickup?: { address?: string; latitude: number; longitude: number };
  destination?: { address?: string; latitude: number; longitude: number };
  currentSpeedKmh?: number;
  maxSpeedKmh?: number;
}

interface CourierOption {
  id: string;
  name: string;
}

type Period = 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'year';
type ReportType = 'commission' | 'earnings';

interface DeliveriesProps {
  adminId: string;
}

const Deliveries: React.FC<DeliveriesProps> = ({ adminId }) => {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [couriers, setCouriers] = useState<CourierOption[]>([]);
  const [selectedCourier, setSelectedCourier] = useState('all');
  const [period, setPeriod] = useState<Period>('all');
  const [reportType, setReportType] = useState<ReportType>('earnings');
  const [reportResult, setReportResult] = useState<{ total: number; count: number } | null>(null);
  const [problemDeliveries, setProblemDeliveries] = useState<Delivery[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [mapPickerMode, setMapPickerMode] = useState<'pickup' | 'destination' | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number }>(() => {
    try {
      const saved = localStorage.getItem('zaki_admin_map_center');
      if (saved) return JSON.parse(saved);
    } catch {}
    return { lat: 38.5598, lng: 68.7740 }; // Dushanbe fallback
  });
  const [createForm, setCreateForm] = useState({
    clientPhone: '',
    comment: '',
    pickupAddress: '',
    pickupLat: '',
    pickupLng: '',
    destinationAddress: '',
    destinationLat: '',
    destinationLng: '',
  });

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
    const q = query(collection(db, 'deliveries'), orderBy('createdAt', 'desc'), limit(200));
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Delivery[];
    setDeliveries(data);
  };

  const findProblemDeliveries = async () => {
    setIsSearching(true);
    try {
      const q = query(collection(db, 'deliveries'), where('status', '==', 'IN_PROGRESS'), limit(100));
      const snapshot = await getDocs(q);
      const inProgressDeliveries = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Delivery[];
      inProgressDeliveries.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      const now = Date.now();
      const problems = inProgressDeliveries.filter(d => {
        if (d.startTime && (now - d.startTime) > 3600000) return true;
        if (!d.route || d.route.length === 0) return true;
        if (!d.courierId || !d.courierName) return true;
        return false;
      });

      setProblemDeliveries(problems);
      alert(problems.length === 0 ? '✅ Проблемные доставки не найдены!' : `⚠️ Найдено проблемных доставок: ${problems.length}`);
    } catch (error) {
      console.error('Ошибка поиска проблемных доставок:', error);
      alert('Ошибка при поиске: ' + (error as Error).message);
    } finally {
      setIsSearching(false);
    }
  };

  const getDateRange = (p: Period): { start: number; end: number } => {
    const now = new Date();
    let start = 0;
    let end = now.getTime();

    switch (p) {
      case 'today': {
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        start = todayStart.getTime();
        break;
      }
      case 'yesterday': {
        const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        const yesterdayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        start = yesterdayStart.getTime();
        end = yesterdayEnd.getTime() - 1;
        break;
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

    const total = filtered.reduce((sum, d) => sum + (reportType === 'commission' ? (d.commission || 0) : (d.cost || 0)), 0);
    setReportResult({ total, count: filtered.length });
  };

  const handleCancelDelivery = async (delivery: Delivery) => {
    const confirmMessage = delivery.courierId
      ? `Отменить доставку?\n\nКурьер: ${delivery.courierName}\nКлиент: ${delivery.clientPhone}`
      : 'Отменить эту доставку?';
    if (!window.confirm(confirmMessage)) return;

    try {
      if (delivery.orderKind === 'MARKETPLACE') {
        const cancelMarketplaceFn = httpsCallable(functions, 'adminCancelMarketplaceDelivery');
        await cancelMarketplaceFn({ adminId, deliveryId: delivery.id });
      } else if (delivery.courierId) {
        const cancelDeliveryFn = httpsCallable(functions, 'adminCancelDelivery');
        await cancelDeliveryFn({ adminId, deliveryId: delivery.id });
      } else {
        await updateDoc(doc(db, 'deliveries', delivery.id), { status: 'CANCELLED', endTime: Date.now() });
      }
      loadDeliveries();
    } catch (error: any) {
      alert('Ошибка отмены: ' + (error.message || 'Неизвестная ошибка'));
    }
  };

  const handleCompleteDelivery = async (delivery: Delivery) => {
    if (!window.confirm(`Завершить доставку?\n\nКурьер: ${delivery.courierName}\nКлиент: ${delivery.clientPhone}`)) return;
    try {
      const completeDeliveryFn = httpsCallable(functions, 'adminCompleteDelivery');
      await completeDeliveryFn({ adminId, deliveryId: delivery.id });
      alert('✅ Доставка завершена! SMS отправлено клиенту.');
      loadDeliveries();
    } catch (error: any) {
      alert('Ошибка: ' + (error.message || 'Не удалось завершить доставку'));
    }
  };

  const handleFixProblemDelivery = async (delivery: Delivery) => {
    if (!window.confirm(`Завершить проблемную доставку?\n\nКурьер: ${delivery.courierName}\nКлиент: ${delivery.clientPhone}`)) return;
    try {
      if (delivery.courierId) {
        const cancelDeliveryFn = httpsCallable(functions, 'adminCancelDelivery');
        await cancelDeliveryFn({ adminId, deliveryId: delivery.id });
      } else {
        await updateDoc(doc(db, 'deliveries', delivery.id), {
          status: 'CANCELLED',
          endTime: Date.now(),
          note: 'Автоматически отменена через админ-панель (проблемная доставка)'
        });
      }
      loadDeliveries();
      setProblemDeliveries(prev => prev.filter(d => d.id !== delivery.id));
    } catch (error) {
      alert('Ошибка: ' + (error as Error).message);
    }
  };

  const handleRowClick = async (delivery: Delivery) => {
    if (!delivery.route || delivery.route.length === 0) {
      try {
        const docRef = doc(db, 'deliveries', delivery.id);
        const docSnap = await getDoc(docRef);
        setSelectedDelivery(docSnap.exists() ? ({ id: docSnap.id, ...docSnap.data() } as Delivery) : delivery);
      } catch {
        setSelectedDelivery(delivery);
      }
    } else {
      setSelectedDelivery(delivery);
    }
    setDetailOpen(true);
  };

  const filteredDeliveries = deliveries.filter(d => {
    const matchesSearch = d.clientPhone?.includes(searchQuery) || d.courierName?.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (selectedCourier !== 'all' && d.courierId !== selectedCourier) return false;
    if (reportResult && period !== 'all') {
      const { start, end } = getDateRange(period);
      if (d.createdAt < start || d.createdAt > end) return false;
    }
    return true;
  });

  const handleMapPick = (lat: number, lng: number) => {
    if (!mapPickerMode) return;
    const center = { lat, lng };
    setMapCenter(center);
    localStorage.setItem('zaki_admin_map_center', JSON.stringify(center));
    if (mapPickerMode === 'pickup') setCreateForm(prev => ({ ...prev, pickupLat: String(lat), pickupLng: String(lng) }));
    if (mapPickerMode === 'destination') setCreateForm(prev => ({ ...prev, destinationLat: String(lat), destinationLng: String(lng) }));
  };

  const handleCreateMarketplaceOrder = async () => {
    if (!createForm.clientPhone || !createForm.pickupLat || !createForm.pickupLng || !createForm.destinationLat || !createForm.destinationLng) {
      alert('Заполните телефон клиента и координаты точек');
      return;
    }

    try {
      setIsCreatingOrder(true);
      const createFn = httpsCallable(functions, 'adminCreateMarketplaceDelivery');
      const result: any = await createFn({
        adminId,
        clientPhone: createForm.clientPhone,
        comment: createForm.comment,
        pickup: {
          address: createForm.pickupAddress,
          latitude: Number(createForm.pickupLat),
          longitude: Number(createForm.pickupLng),
        },
        destination: {
          address: createForm.destinationAddress,
          latitude: Number(createForm.destinationLat),
          longitude: Number(createForm.destinationLng),
        },
      });
      alert(`✅ Заказ создан. Доступно курьеров: ${result?.data?.availableCouriers ?? 0}`);
      setCreateOpen(false);
      setCreateForm({ clientPhone: '', comment: '', pickupAddress: '', pickupLat: '', pickupLng: '', destinationAddress: '', destinationLat: '', destinationLng: '' });
      loadDeliveries();
    } catch (error: any) {
      alert('Ошибка создания заказа: ' + (error.message || 'Неизвестная ошибка'));
    } finally {
      setIsCreatingOrder(false);
    }
  };

  const getStatusChip = (status: string) => {
    switch (status) {
      case 'PENDING': return <Chip label="Ожидает курьера" color="warning" size="small" />;
      case 'COMPLETED': return <Chip label="Завершена" color="success" size="small" />;
      case 'IN_PROGRESS': return <Chip label="В процессе" color="info" size="small" />;
      case 'CANCELLED': return <Chip label="Отменена" color="error" size="small" />;
      default: return <Chip label={status} size="small" />;
    }
  };

  const formatDate = (ts: number) => ts ? new Date(ts).toLocaleString('ru-RU') : '—';
  const formatDistance = (m: number) => !m ? '0 м' : m < 1000 ? `${Math.round(m)} м` : `${(m / 1000).toFixed(1)} км`;
  const formatCost = (cost: number) => {
    const s = Math.floor(cost); const d = Math.round((cost - s) * 100);
    return d > 0 ? `${s.toLocaleString()}.${String(d).padStart(2, '0')} сомони` : `${s.toLocaleString()} сомони`;
  };
  const formatDuration = (start: number, end: number | null) => {
    if (!start) return '—';
    const mins = Math.floor(((end || Date.now()) - start) / 60000);
    return mins >= 60 ? `${Math.floor(mins / 60)} ч ${mins % 60} мин` : `${mins} мин`;
  };
  const formatSpeed = (distanceMeters: number, startTime: number, endTime: number | null) => {
    if (!distanceMeters || !startTime || !endTime) return '—';
    const durationMs = endTime - startTime;
    if (durationMs <= 0) return '—';
    const speedKmh = (distanceMeters / 1000) / (durationMs / 3600000);
    return `${speedKmh.toFixed(1)} км/ч`;
  };
  const getMapCenter = (route: Array<{ latitude: number; longitude: number }>) => {
    if (!route || route.length === 0) return { lat: 38.5598, lng: 68.7740 };
    const mid = route[Math.floor(route.length / 2)];
    return { lat: mid.latitude, lng: mid.longitude };
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Доставки</Typography>
        <Button variant="contained" onClick={() => setCreateOpen(true)}>Создать заказ</Button>
      </Box>

      {problemDeliveries.length > 0 && (
        <Card sx={{ mb: 3, p: 2, bgcolor: '#ffebee', borderLeft: 4, borderColor: 'error.main' }}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5, color: 'error.main' }}>
            ⚠️ Найдено проблемных доставок: {problemDeliveries.length}
          </Typography>
          <TableContainer sx={{ bgcolor: 'white', borderRadius: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Курьер</TableCell><TableCell>Клиент</TableCell><TableCell>Начало</TableCell><TableCell>Длится</TableCell><TableCell>Проблема</TableCell><TableCell>Действие</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {problemDeliveries.map((delivery) => {
                  const now = Date.now();
                  let problemText = '';
                  if (delivery.startTime && (now - delivery.startTime) > 3600000) problemText = 'Висит > 1 часа';
                  else if (!delivery.route || delivery.route.length === 0) problemText = 'Нет маршрута';
                  else if (!delivery.courierId) problemText = 'Нет курьера';
                  return (
                    <TableRow key={delivery.id} hover>
                      <TableCell>{delivery.courierName || '—'}</TableCell>
                      <TableCell>{delivery.clientPhone || '—'}</TableCell>
                      <TableCell>{formatDate(delivery.startTime)}</TableCell>
                      <TableCell><Chip label={formatDuration(delivery.startTime, null)} size="small" color="error" /></TableCell>
                      <TableCell><Chip label={problemText} size="small" color="warning" /></TableCell>
                      <TableCell><Button size="small" variant="contained" color="error" onClick={() => handleFixProblemDelivery(delivery)}>Исправить</Button></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}

      <Card sx={{ mb: 3, p: 2, bgcolor: '#fff3e0', borderLeft: 4, borderColor: 'warning.main' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center" justifyContent="space-between">
          <Box>
            <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5, color: 'warning.dark' }}>🔍 Поиск проблемных доставок</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>Нажмите кнопку для автоматического поиска доставок которые не завершаются</Typography>
          </Box>
          <Button variant="contained" color="warning" size="large" onClick={findProblemDeliveries} disabled={isSearching} sx={{ minWidth: 200 }}>
            {isSearching ? 'Поиск...' : 'Обнаружить проблемы'}
          </Button>
        </Stack>
      </Card>

      <Card sx={{ mb: 3, p: 2 }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>Отчёт</Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
          <TextField select size="small" label="Курьер" value={selectedCourier} onChange={(e) => setSelectedCourier(e.target.value)} sx={{ minWidth: 180 }}>
            <MenuItem value="all">Все курьеры</MenuItem>
            {couriers.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </TextField>
          <ToggleButtonGroup value={period} exclusive size="small" onChange={(_, v) => v && setPeriod(v)}>
            <ToggleButton value="today">Сегодня</ToggleButton><ToggleButton value="yesterday">Вчера</ToggleButton><ToggleButton value="week">Неделя</ToggleButton><ToggleButton value="month">Месяц</ToggleButton><ToggleButton value="year">Год</ToggleButton><ToggleButton value="all">Все</ToggleButton>
          </ToggleButtonGroup>
          <ToggleButtonGroup value={reportType} exclusive size="small" onChange={(_, v) => v && setReportType(v)}>
            <ToggleButton value="earnings">Заработок</ToggleButton><ToggleButton value="commission">Комиссия</ToggleButton>
          </ToggleButtonGroup>
          <Button variant="contained" size="small" onClick={handleCalculate}>Рассчитать</Button>
          {reportResult && <Alert severity="info" sx={{ py: 0 }}>{reportType === 'commission' ? 'Комиссия' : 'Заработок'}: <strong>{formatCost(reportResult.total)}</strong> ({reportResult.count} доставок)</Alert>}
        </Stack>
      </Card>

      <TextField fullWidth placeholder="Поиск по номеру телефона или имени курьера" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} sx={{ mb: 2 }} InputProps={{ startAdornment: <InputAdornment position="start"><Search /></InputAdornment> }} />

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Дата</TableCell><TableCell>Курьер</TableCell><TableCell>Клиент</TableCell><TableCell>Тип</TableCell><TableCell>Расстояние</TableCell><TableCell>Скорость</TableCell><TableCell>Стоимость</TableCell><TableCell>Статус</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredDeliveries.map((delivery) => (
                <TableRow key={delivery.id} hover sx={{ cursor: 'pointer' }} onClick={() => handleRowClick(delivery)}>
                  <TableCell>{formatDate(delivery.createdAt)}</TableCell>
                  <TableCell>{delivery.courierName}</TableCell>
                  <TableCell>{delivery.clientPhone}</TableCell>
                  <TableCell>{delivery.orderKind === 'MARKETPLACE' ? 'Админ заказ' : 'Обычный'}</TableCell>
                  <TableCell>{formatDistance(delivery.distanceMeters)}</TableCell>
                  <TableCell>{formatSpeed(delivery.distanceMeters, delivery.startTime, delivery.endTime)}</TableCell>
                  <TableCell>{formatCost(delivery.cost || 0)}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {getStatusChip(delivery.status)}
                      {(delivery.status === 'IN_PROGRESS' || (delivery.orderKind === 'MARKETPLACE' && delivery.status === 'PENDING')) && (
                        <>
                          <Button size="small" color="success" variant="contained" onClick={(e) => { e.stopPropagation(); handleCompleteDelivery(delivery); }}>Завершить</Button>
                          <Button size="small" color="error" variant="outlined" onClick={(e) => { e.stopPropagation(); handleCancelDelivery(delivery); }}>Отменить</Button>
                        </>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Создать заказ</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12} md={6}><TextField fullWidth label="Телефон клиента" value={createForm.clientPhone} onChange={(e) => setCreateForm(prev => ({ ...prev, clientPhone: e.target.value }))} /></Grid>
            <Grid item xs={12} md={6}><TextField fullWidth label="Комментарий" value={createForm.comment} onChange={(e) => setCreateForm(prev => ({ ...prev, comment: e.target.value }))} /></Grid>
            <Grid item xs={12}>
              {isLoaded && (
                <Box sx={{ height: 300, borderRadius: 2, overflow: 'hidden', border: '1px solid #ddd' }}>
                  <GoogleMap mapContainerStyle={{ width: '100%', height: '100%' }} center={mapCenter} zoom={13} options={{ streetViewControl: false, mapTypeControl: false }} onClick={(e) => { const lat = e.latLng?.lat(); const lng = e.latLng?.lng(); if (lat != null && lng != null) handleMapPick(lat, lng); }}>
                    {createForm.pickupLat && createForm.pickupLng && <MarkerF position={{ lat: Number(createForm.pickupLat), lng: Number(createForm.pickupLng) }} label="A" />}
                    {createForm.destinationLat && createForm.destinationLng && <MarkerF position={{ lat: Number(createForm.destinationLat), lng: Number(createForm.destinationLng) }} label="B" />}
                  </GoogleMap>
                </Box>
              )}
            </Grid>
            <Grid item xs={12}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                <Button variant={mapPickerMode === 'pickup' ? 'contained' : 'outlined'} onClick={() => setMapPickerMode('pickup')}>Выбрать точку "Откуда"</Button>
                <Button variant={mapPickerMode === 'destination' ? 'contained' : 'outlined'} onClick={() => setMapPickerMode('destination')}>Выбрать точку "Куда"</Button>
              </Stack>
            </Grid>
            <Grid item xs={12}><Divider>Откуда</Divider></Grid>
            <Grid item xs={12}><TextField fullWidth label="Адрес откуда" value={createForm.pickupAddress} onChange={(e) => setCreateForm(prev => ({ ...prev, pickupAddress: e.target.value }))} /></Grid>
            <Grid item xs={12} md={6}><TextField fullWidth label="Широта" value={createForm.pickupLat} onChange={(e) => setCreateForm(prev => ({ ...prev, pickupLat: e.target.value }))} /></Grid>
            <Grid item xs={12} md={6}><TextField fullWidth label="Долгота" value={createForm.pickupLng} onChange={(e) => setCreateForm(prev => ({ ...prev, pickupLng: e.target.value }))} /></Grid>
            <Grid item xs={12}><Divider>Куда</Divider></Grid>
            <Grid item xs={12}><TextField fullWidth label="Адрес куда" value={createForm.destinationAddress} onChange={(e) => setCreateForm(prev => ({ ...prev, destinationAddress: e.target.value }))} /></Grid>
            <Grid item xs={12} md={6}><TextField fullWidth label="Широта" value={createForm.destinationLat} onChange={(e) => setCreateForm(prev => ({ ...prev, destinationLat: e.target.value }))} /></Grid>
            <Grid item xs={12} md={6}><TextField fullWidth label="Долгота" value={createForm.destinationLng} onChange={(e) => setCreateForm(prev => ({ ...prev, destinationLng: e.target.value }))} /></Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Отмена</Button>
          <Button variant="contained" onClick={handleCreateMarketplaceOrder} disabled={isCreatingOrder}>{isCreatingOrder ? 'Создание...' : 'Создать заказ'}</Button>
        </DialogActions>
      </Dialog>

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
                  <GoogleMap mapContainerStyle={{ width: '100%', height: '100%' }} center={getMapCenter(selectedDelivery.route)} zoom={14} options={{ streetViewControl: false, mapTypeControl: false }}>
                    <PolylineF path={selectedDelivery.route.map(p => ({ lat: p.latitude, lng: p.longitude }))} options={{ strokeColor: '#1B5E20', strokeWeight: 4 }} />
                    <MarkerF position={{ lat: selectedDelivery.route[0].latitude, lng: selectedDelivery.route[0].longitude }} label="A" />
                    <MarkerF position={{ lat: selectedDelivery.route[selectedDelivery.route.length - 1].latitude, lng: selectedDelivery.route[selectedDelivery.route.length - 1].longitude }} label="B" />
                  </GoogleMap>
                </Box>
              ) : (
                <Box sx={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#f5f5f5', borderRadius: 2, mb: 2 }}><Typography color="text.secondary">Маршрут не доступен</Typography></Box>
              )}
              <Grid container spacing={2}>
                <Grid item xs={6}><Typography variant="body2" color="text.secondary">Курьер</Typography><Typography fontWeight={600}>{selectedDelivery.courierName}</Typography></Grid>
                <Grid item xs={6}><Typography variant="body2" color="text.secondary">Клиент</Typography><Typography fontWeight={600}>{selectedDelivery.clientPhone}</Typography></Grid>
                <Grid item xs={6}><Typography variant="body2" color="text.secondary">Тип заказа</Typography><Typography fontWeight={600}>{selectedDelivery.orderKind === 'MARKETPLACE' ? 'Админ заказ' : 'Обычный'}</Typography></Grid>
                {selectedDelivery.orderKind === 'MARKETPLACE' && <>
                  <Grid item xs={6}><Typography variant="body2" color="text.secondary">Откуда</Typography><Typography fontWeight={600}>{selectedDelivery.pickup?.address || '—'}</Typography></Grid>
                  <Grid item xs={6}><Typography variant="body2" color="text.secondary">Куда</Typography><Typography fontWeight={600}>{selectedDelivery.destination?.address || '—'}</Typography></Grid>
                  <Grid item xs={6}><Typography variant="body2" color="text.secondary">Этап</Typography><Typography fontWeight={600}>{selectedDelivery.adminOrderStage || '—'}</Typography></Grid>
                  <Grid item xs={6}><Typography variant="body2" color="text.secondary">Комментарий</Typography><Typography fontWeight={600}>{selectedDelivery.comment || '—'}</Typography></Grid>
                </>}
                <Grid item xs={12}><Divider /></Grid>
                <Grid item xs={4}><Typography variant="body2" color="text.secondary">Начало</Typography><Typography>{formatDate(selectedDelivery.startTime)}</Typography></Grid>
                <Grid item xs={4}><Typography variant="body2" color="text.secondary">Конец</Typography><Typography>{selectedDelivery.endTime ? formatDate(selectedDelivery.endTime) : 'В процессе'}</Typography></Grid>
                <Grid item xs={4}><Typography variant="body2" color="text.secondary">Длительность</Typography><Typography>{formatDuration(selectedDelivery.startTime, selectedDelivery.endTime)}</Typography></Grid>
                <Grid item xs={12}><Divider /></Grid>
                <Grid item xs={3}><Typography variant="body2" color="text.secondary">Расстояние</Typography><Typography fontWeight={600}>{formatDistance(selectedDelivery.distanceMeters)}</Typography></Grid>
                <Grid item xs={3}><Typography variant="body2" color="text.secondary">Стоимость</Typography><Typography fontWeight={600} color="green">{formatCost(selectedDelivery.cost || 0)}</Typography></Grid>
                <Grid item xs={3}><Typography variant="body2" color="text.secondary">Комиссия</Typography><Typography fontWeight={600} color="orange">{formatCost(selectedDelivery.commission || 0)}</Typography></Grid>
                <Grid item xs={3}><Typography variant="body2" color="text.secondary">Ожидание</Typography><Typography fontWeight={600}>{selectedDelivery.waitingMinutes ? `${Math.ceil(selectedDelivery.waitingMinutes)} мин (${formatCost(selectedDelivery.waitingCost || 0)})` : '—'}</Typography></Grid>
                <Grid item xs={3}><Typography variant="body2" color="text.secondary">Ср. скорость</Typography><Typography fontWeight={600} color="primary">{formatSpeed(selectedDelivery.distanceMeters, selectedDelivery.startTime, selectedDelivery.endTime)}</Typography></Grid>
                <Grid item xs={3}><Typography variant="body2" color="text.secondary">Макс. скорость</Typography><Typography fontWeight={600} color="error">{selectedDelivery.maxSpeedKmh != null ? `${selectedDelivery.maxSpeedKmh.toFixed(1)} км/ч` : '—'}</Typography></Grid>
                {selectedDelivery.status === 'IN_PROGRESS' && selectedDelivery.currentSpeedKmh != null && (
                  <Grid item xs={3}><Typography variant="body2" color="text.secondary">Тек. скорость</Typography><Typography fontWeight={600} color="success.main">{`${selectedDelivery.currentSpeedKmh.toFixed(1)} км/ч`}</Typography></Grid>
                )}
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
