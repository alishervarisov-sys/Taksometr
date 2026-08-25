import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Typography, Card, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, TextField, InputAdornment, Dialog,
  DialogTitle, DialogContent, DialogActions, Button, Grid, Divider,
  Stack, CircularProgress, Avatar, MenuItem, FormControl, InputLabel, Select,
  SelectChangeEvent,
} from '@mui/material';
import { Search, Person as PersonIcon, LocalShipping as DeliveryIcon, LocalTaxi as TaxiIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import { collection, getDocs, query, orderBy, limit, where, startAfter, QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import { GoogleMap, useJsApiLoader, PolylineF, MarkerF } from '@react-google-maps/api';
import { db, GOOGLE_MAPS_API_KEY } from '../firebase';

// ─── Types ──────────────────────────────────────────────────────────────────

interface DeliveryOrder {
  id: string;
  kind: 'delivery';
  courierName?: string;
  clientPhone: string;
  status: string;
  distanceMeters?: number;
  cost?: number;
  startTime?: number;
  endTime?: number | null;
  createdAt: number;
  route?: Array<{ latitude: number; longitude: number }>;
  orderKind?: string;
  orderSource?: string;
  comment?: string;
  pickup?: { address?: string; latitude: number; longitude: number };
  destination?: { address?: string; latitude: number; longitude: number };
}

interface TaxiHistoryOrder {
  id: string;
  kind: 'taxi';
  orderNumber?: number;
  clientPhone: string;
  pickup?: string;
  destination?: string;
  status: string;
  driverName?: string;
  createdAt: number;
}

type ClientOrder = DeliveryOrder | TaxiHistoryOrder;

interface Client {
  phone: string;
  name: string;
  totalOrders: number;
  deliveryOrders: number;
  taxiOrders: number;
  courierOrders: number;
  adminOrders: number;
  completedOrders: number;
  totalSpent: number;
  firstOrderAt: number;
  lastOrderAt: number;
  orders: ClientOrder[];
}

interface ClientsProps {
  adminId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatDate = (ts?: number) => ts ? new Date(ts).toLocaleString('ru-RU') : '—';
const formatDistance = (m?: number) => !m ? '0 м' : m < 1000 ? `${Math.round(m)} м` : `${(m / 1000).toFixed(1)} км`;
const formatCost = (cost?: number) => {
  const value = cost || 0;
  const s = Math.floor(value); const d = Math.round((value - s) * 100);
  return d > 0 ? `${s.toLocaleString()}.${String(d).padStart(2, '0')} сомони` : `${s.toLocaleString()} сомони`;
};
const formatDuration = (start?: number, end?: number | null) => {
  if (!start || !end) return '—';
  const mins = Math.floor((end - start) / 60000);
  return mins >= 60 ? `${Math.floor(mins / 60)} ч ${mins % 60} мин` : `${mins} мин`;
};
const getMapCenter = (route?: Array<{ latitude: number; longitude: number }>) => {
  if (!route || route.length === 0) return { lat: 38.5598, lng: 68.7740 };
  const mid = route[Math.floor(route.length / 2)];
  return { lat: mid.latitude, lng: mid.longitude };
};

const statusChip = (status: string) => {
  switch (status) {
    case 'PENDING': return <Chip label="Ожидает курьера" color="warning" size="small" />;
    case 'COMPLETED': return <Chip label="Завершена" color="success" size="small" />;
    case 'IN_PROGRESS': return <Chip label="В процессе" color="info" size="small" />;
    case 'CANCELLED': return <Chip label="Отменена" color="error" size="small" />;
    case 'waiting': return <Chip label="Ожидает" color="warning" size="small" />;
    case 'accepted': return <Chip label="Принят" color="success" size="small" />;
    case 'completed': return <Chip label="Завершён" color="default" size="small" />;
    case 'cancelled': return <Chip label="Отменён" color="error" size="small" />;
    default: return <Chip label={status} size="small" />;
  }
};

const isCompleted = (o: ClientOrder) => o.status === 'COMPLETED' || o.status === 'completed';

const isAdminOrder = (o: DeliveryOrder) =>
  o.orderSource === 'ADMIN_PANEL' || o.orderKind === 'MARKETPLACE';

type SourceFilter = 'all' | 'courier' | 'admin' | 'taxi';

// Ленивая загрузка: сначала последние INITIAL_PAGE заказов, далее подгрузка порциями при скролле
const INITIAL_PAGE = 50;
const LOAD_MORE_PAGE = 500;

const fetchPage = async (
  collName: string,
  cursor: QueryDocumentSnapshot<DocumentData> | null,
  pageSize: number,
): Promise<{ docs: QueryDocumentSnapshot<DocumentData>[]; cursor: QueryDocumentSnapshot<DocumentData> | null; hasMore: boolean }> => {
  let q = query(collection(db, collName), orderBy('createdAt', 'desc'), limit(pageSize));
  if (cursor) q = query(q, startAfter(cursor));
  const snap = await getDocs(q);
  return {
    docs: snap.docs,
    cursor: snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : cursor,
    hasMore: snap.docs.length === pageSize,
  };
};

const mapDeliveryDoc = (d: QueryDocumentSnapshot<DocumentData>): DeliveryOrder =>
  ({ id: d.id, kind: 'delivery', ...(d.data() as any) } as DeliveryOrder);

const mapTaxiDoc = (d: QueryDocumentSnapshot<DocumentData>): TaxiHistoryOrder => {
  const data = d.data() as any;
  return {
    id: d.id,
    kind: 'taxi',
    orderNumber: data.orderNumber,
    clientPhone: data.customerPhone || '',
    pickup: data.pickup,
    destination: data.destination,
    status: data.status || '',
    driverName: data.driverName,
    createdAt: data.createdAt || 0,
  } as TaxiHistoryOrder;
};

// ─── Component ──────────────────────────────────────────────────────────────

const Clients: React.FC<ClientsProps> = ({ adminId }) => {
  void adminId;
  const [allDeliveryOrders, setAllDeliveryOrders] = useState<DeliveryOrder[]>([]);
  const [allTaxiOrders, setAllTaxiOrders] = useState<TaxiHistoryOrder[]>([]);
  const [nameByPhone, setNameByPhone] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<DeliveryOrder | null>(null);
  const [routeOpen, setRouteOpen] = useState(false);

  const deliveryCursorRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const taxiCursorRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const busyRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
  });

  useEffect(() => {
    loadClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Первичная загрузка: последние 50 заказов каждой коллекции — быстро открываем страницу
  const loadClients = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    try {
      // Load user names by phone
      const usersSnap = await getDocs(query(collection(db, 'users'), where('phone', '!=', '')));
      const names = new Map<string, string>();
      usersSnap.docs.forEach(d => {
        const data = d.data() as any;
        if (data.phone) names.set(String(data.phone), data.name || '');
      });
      setNameByPhone(names);

      const delPage = await fetchPage('deliveries', null, INITIAL_PAGE);
      deliveryCursorRef.current = delPage.cursor;
      setAllDeliveryOrders(delPage.docs.map(mapDeliveryDoc));

      let more = delPage.hasMore;
      try {
        const taxiPage = await fetchPage('taxi_orders', null, INITIAL_PAGE);
        taxiCursorRef.current = taxiPage.cursor;
        setAllTaxiOrders(taxiPage.docs.map(mapTaxiDoc));
        more = more || taxiPage.hasMore;
      } catch (e) {
        // taxi_orders may not exist / be inaccessible — ignore
        console.warn('Не удалось загрузить такси-заказы', e);
        taxiCursorRef.current = null;
      }
      setHasMore(more);
    } catch (e) {
      console.error('Ошибка загрузки клиентов', e);
      setHasMore(false);
    } finally {
      setLoading(false);
      busyRef.current = false;
    }
  };

  // Подгрузка следующей порции заказов при скролле
  const loadMore = async () => {
    if (busyRef.current || loading || !hasMore) return;
    busyRef.current = true;
    setLoadingMore(true);
    try {
      let more = false;
      if (deliveryCursorRef.current) {
        const page = await fetchPage('deliveries', deliveryCursorRef.current, LOAD_MORE_PAGE);
        deliveryCursorRef.current = page.cursor;
        if (page.docs.length > 0) {
          setAllDeliveryOrders(prev => [...prev, ...page.docs.map(mapDeliveryDoc)]);
        }
        more = more || page.hasMore;
      }
      if (taxiCursorRef.current) {
        try {
          const page = await fetchPage('taxi_orders', taxiCursorRef.current, LOAD_MORE_PAGE);
          taxiCursorRef.current = page.cursor;
          if (page.docs.length > 0) {
            setAllTaxiOrders(prev => [...prev, ...page.docs.map(mapTaxiDoc)]);
          }
          more = more || page.hasMore;
        } catch (e) {
          console.warn('Не удалось загрузить такси-заказы', e);
          taxiCursorRef.current = null;
        }
      }
      setHasMore(more);
    } catch (e) {
      console.error('Ошибка подгрузки заказов', e);
      setHasMore(false);
    } finally {
      setLoadingMore(false);
      busyRef.current = false;
    }
  };

  // Автоподгрузка при появлении "сентинела" в зоне видимости
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || loading || !hasMore) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) loadMore();
    }, { rootMargin: '400px' });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, loadingMore, hasMore]);

  const clients = useMemo(() => {
    const from = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : null;
    const to = dateTo ? new Date(dateTo + 'T23:59:59.999').getTime() : null;
    const inRange = (ts: number) => {
      if (from !== null && ts < from) return false;
      if (to !== null && ts > to) return false;
      return true;
    };

    const map = new Map<string, Client>();
    const ensure = (phone: string): Client => {
      let c = map.get(phone);
      if (!c) {
        c = {
          phone,
          name: nameByPhone.get(phone) || '',
          totalOrders: 0,
          deliveryOrders: 0,
          taxiOrders: 0,
          courierOrders: 0,
          adminOrders: 0,
          completedOrders: 0,
          totalSpent: 0,
          firstOrderAt: 0,
          lastOrderAt: 0,
          orders: [],
        };
        map.set(phone, c);
      }
      return c;
    };

    allDeliveryOrders.forEach(o => {
      if (!o.clientPhone) return;
      if (!inRange(o.createdAt || 0)) return;
      const admin = isAdminOrder(o);
      if (sourceFilter === 'courier' && admin) return;
      if (sourceFilter === 'admin' && !admin) return;
      if (sourceFilter === 'taxi') return;
      const c = ensure(o.clientPhone);
      c.orders.push(o);
      c.deliveryOrders += 1;
      if (admin) c.adminOrders += 1; else c.courierOrders += 1;
      c.totalOrders += 1;
      if (isCompleted(o)) { c.completedOrders += 1; c.totalSpent += o.cost || 0; }
      const ts = o.createdAt || 0;
      if (ts > c.lastOrderAt) c.lastOrderAt = ts;
      if (c.firstOrderAt === 0 || ts < c.firstOrderAt) c.firstOrderAt = ts;
    });

    allTaxiOrders.forEach(o => {
      if (!o.clientPhone) return;
      if (!inRange(o.createdAt || 0)) return;
      if (sourceFilter === 'courier' || sourceFilter === 'admin') return;
      const c = ensure(o.clientPhone);
      c.orders.push(o);
      c.taxiOrders += 1;
      c.totalOrders += 1;
      if (isCompleted(o)) c.completedOrders += 1;
      const ts = o.createdAt || 0;
      if (ts > c.lastOrderAt) c.lastOrderAt = ts;
      if (c.firstOrderAt === 0 || ts < c.firstOrderAt) c.firstOrderAt = ts;
    });

    const list = Array.from(map.values());
    // Sort each client's orders newest first
    list.forEach(c => c.orders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
    // Sort clients by number of orders desc
    list.sort((a, b) => b.totalOrders - a.totalOrders || b.lastOrderAt - a.lastOrderAt);
    return list;
  }, [allDeliveryOrders, allTaxiOrders, nameByPhone, dateFrom, dateTo, sourceFilter]);

  const filteredClients = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(c =>
      c.phone.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
    );
  }, [clients, searchQuery]);

  const hasDateFilter = dateFrom !== '' || dateTo !== '';

  const resetFilters = () => {
    setDateFrom('');
    setDateTo('');
    setSourceFilter('all');
  };

  const openClient = (client: Client) => {
    setSelectedClient(client);
    setDetailOpen(true);
  };

  const openRoute = (order: ClientOrder) => {
    if (order.kind !== 'delivery') return;
    setSelectedOrder(order);
    setRouteOpen(true);
  };

  const totals = useMemo(() => ({
    clients: clients.length,
    orders: clients.reduce((s, c) => s + c.totalOrders, 0),
    courierOrders: clients.reduce((s, c) => s + c.courierOrders, 0),
    adminOrders: clients.reduce((s, c) => s + c.adminOrders, 0),
    taxiOrders: clients.reduce((s, c) => s + c.taxiOrders, 0),
  }), [clients]);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Клиенты</Typography>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadClients} disabled={loading}>Обновить</Button>
      </Box>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} md={3}>
          <Card sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Всего клиентов{hasDateFilter ? ' (за период)' : hasMore ? ' (по загруженным заказам)' : ''}
            </Typography>
            <Typography variant="h5" fontWeight={700}>{totals.clients}</Typography>
          </Card>
        </Grid>
        <Grid item xs={6} md={3}>
          <Card sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">Всего заказов{hasDateFilter ? ' (за период)' : ''}</Typography>
            <Typography variant="h5" fontWeight={700}>{totals.orders}</Typography>
          </Card>
        </Grid>
        <Grid item xs={6} md={3}>
          <Card sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">Заказы курьеров (счётчик)</Typography>
            <Typography variant="h5" fontWeight={700}>{totals.courierOrders}</Typography>
          </Card>
        </Grid>
        <Grid item xs={6} md={3}>
          <Card sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">Заказы админа / Такси</Typography>
            <Typography variant="h5" fontWeight={700}>{totals.adminOrders} / {totals.taxiOrders}</Typography>
          </Card>
        </Grid>
      </Grid>

      {/* Filters: date range + source */}
      <Card sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'center' }}>
          <TextField
            label="Дата с"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 160 }}
            size="small"
          />
          <TextField
            label="Дата по"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 160 }}
            size="small"
          />
          <FormControl size="small" sx={{ minWidth: 240 }}>
            <InputLabel>Источник клиентов</InputLabel>
            <Select
              value={sourceFilter}
              label="Источник клиентов"
              onChange={(e: SelectChangeEvent<SourceFilter>) => setSourceFilter(e.target.value as SourceFilter)}
            >
              <MenuItem value="all">Все источники</MenuItem>
              <MenuItem value="courier">Курьер включил счётчик</MenuItem>
              <MenuItem value="admin">Заказы, созданные админом</MenuItem>
              <MenuItem value="taxi">Такси-заказы</MenuItem>
            </Select>
          </FormControl>
          <Button variant="text" onClick={resetFilters} disabled={!hasDateFilter && sourceFilter === 'all'}>Сбросить</Button>
          <Box sx={{ flex: 1 }} />
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
            Загружено заказов: {allDeliveryOrders.length + allTaxiOrders.length}{hasMore ? ' — прокрутите вниз, чтобы загрузить ещё' : ' (все)'}
          </Typography>
        </Stack>
      </Card>

      <TextField
        fullWidth
        placeholder="Поиск по номеру телефона или имени"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        sx={{ mb: 2 }}
        InputProps={{ startAdornment: <InputAdornment position="start"><Search /></InputAdornment> }}
      />

      <Card>
        {loading ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, p: 5 }}>
            <CircularProgress />
            <Typography variant="body2" color="text.secondary">Загрузка последних заказов...</Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Клиент</TableCell>
                  <TableCell>Телефон</TableCell>
                  <TableCell align="center">Всего заказов</TableCell>
                  <TableCell align="center">Курьер</TableCell>
                  <TableCell align="center">Админ</TableCell>
                  <TableCell align="center">Такси</TableCell>
                  <TableCell align="center">Завершено</TableCell>
                  <TableCell align="right">Потрачено</TableCell>
                  <TableCell>Первый заказ</TableCell>
                  <TableCell>Последний заказ</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredClients.map((client) => (
                  <TableRow key={client.phone} hover sx={{ cursor: 'pointer' }} onClick={() => openClient(client)}>
                    <TableCell>
                      <Stack direction="row" spacing={1.5} alignItems="center">
                        <Avatar sx={{ bgcolor: 'primary.light', width: 34, height: 34 }}><PersonIcon fontSize="small" /></Avatar>
                        <Typography fontWeight={600}>{client.name || 'Без имени'}</Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>{client.phone}</TableCell>
                    <TableCell align="center"><Chip label={client.totalOrders} color="primary" size="small" /></TableCell>
                    <TableCell align="center">{client.courierOrders > 0 ? client.courierOrders : '—'}</TableCell>
                    <TableCell align="center">{client.adminOrders > 0 ? client.adminOrders : '—'}</TableCell>
                    <TableCell align="center">{client.taxiOrders > 0 ? client.taxiOrders : '—'}</TableCell>
                    <TableCell align="center">{client.completedOrders}</TableCell>
                    <TableCell align="right" style={{ whiteSpace: 'nowrap' }}>{formatCost(client.totalSpent)}</TableCell>
                    <TableCell style={{ whiteSpace: 'nowrap' }}>{formatDate(client.firstOrderAt)}</TableCell>
                    <TableCell style={{ whiteSpace: 'nowrap' }}>{formatDate(client.lastOrderAt)}</TableCell>
                  </TableRow>
                ))}
                {filteredClients.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} align="center" sx={{ py: 4, color: 'text.secondary' }}>Клиенты не найдены</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      {/* Infinite scroll: подгрузка истории заказов при скролле вниз */}
      {!loading && (
        <Box ref={sentinelRef} sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 2, py: 3 }}>
          {loadingMore ? (
            <>
              <CircularProgress size={24} />
              <Typography variant="body2" color="text.secondary">Загрузка ещё заказов...</Typography>
            </>
          ) : hasMore ? (
            <Button variant="outlined" onClick={loadMore}>Загрузить ещё</Button>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Загружена вся история: {allDeliveryOrders.length + allTaxiOrders.length} заказов
            </Typography>
          )}
        </Box>
      )}

      {/* Client detail dialog with order history */}
      <Dialog open={detailOpen} onClose={() => setDetailOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Avatar sx={{ bgcolor: 'primary.main' }}><PersonIcon /></Avatar>
            <Box>
              <Typography fontWeight={700}>{selectedClient?.name || 'Без имени'}</Typography>
              <Typography variant="body2" color="text.secondary">{selectedClient?.phone}</Typography>
            </Box>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {selectedClient && (
            <Box>
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={6} md={3}><Typography variant="body2" color="text.secondary">Всего заказов</Typography><Typography fontWeight={700}>{selectedClient.totalOrders}</Typography></Grid>
                <Grid item xs={6} md={3}><Typography variant="body2" color="text.secondary">Завершено</Typography><Typography fontWeight={700}>{selectedClient.completedOrders}</Typography></Grid>
                <Grid item xs={6} md={3}><Typography variant="body2" color="text.secondary">Курьер / Админ / Такси</Typography><Typography fontWeight={700}>{selectedClient.courierOrders} / {selectedClient.adminOrders} / {selectedClient.taxiOrders}</Typography></Grid>
                <Grid item xs={6} md={3}><Typography variant="body2" color="text.secondary">Потрачено</Typography><Typography fontWeight={700} color="green">{formatCost(selectedClient.totalSpent)}</Typography></Grid>
                <Grid item xs={6} md={3}><Typography variant="body2" color="text.secondary">Первый заказ (создан)</Typography><Typography fontWeight={700}>{formatDate(selectedClient.firstOrderAt)}</Typography></Grid>
                <Grid item xs={6} md={3}><Typography variant="body2" color="text.secondary">Последний заказ</Typography><Typography fontWeight={700}>{formatDate(selectedClient.lastOrderAt)}</Typography></Grid>
              </Grid>
              <Divider sx={{ mb: 2 }} />
              <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>История заказов</Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Дата</TableCell>
                      <TableCell>Тип</TableCell>
                      <TableCell>Маршрут</TableCell>
                      <TableCell>Исполнитель</TableCell>
                      <TableCell align="right">Стоимость</TableCell>
                      <TableCell>Статус</TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {selectedClient.orders.map((o) => (
                      <TableRow key={`${o.kind}-${o.id}`} hover>
                        <TableCell style={{ whiteSpace: 'nowrap' }}>{formatDate(o.createdAt)}</TableCell>
                        <TableCell>
                          {o.kind === 'delivery'
                            ? <Chip icon={<DeliveryIcon />} label={isAdminOrder(o) ? 'Админ заказ' : 'Счётчик курьера'} size="small" />
                            : <Chip icon={<TaxiIcon />} label="Такси" size="small" sx={{ bgcolor: '#FFF3C4' }} />}
                        </TableCell>
                        <TableCell sx={{ maxWidth: 240 }}>
                          {o.kind === 'delivery'
                            ? (o.pickup?.address || o.destination?.address
                                ? `${o.pickup?.address || '—'} → ${o.destination?.address || '—'}`
                                : formatDistance(o.distanceMeters))
                            : `${o.pickup || '—'} → ${o.destination || '—'}`}
                        </TableCell>
                        <TableCell>{o.kind === 'delivery' ? (o.courierName || '—') : (o.driverName || '—')}</TableCell>
                        <TableCell align="right" style={{ whiteSpace: 'nowrap' }}>{o.kind === 'delivery' ? formatCost(o.cost) : '—'}</TableCell>
                        <TableCell>{statusChip(o.status)}</TableCell>
                        <TableCell>
                          {o.kind === 'delivery' && o.route && o.route.length > 0 && (
                            <Button size="small" onClick={() => openRoute(o)}>Маршрут</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {selectedClient.orders.length === 0 && (
                      <TableRow><TableCell colSpan={7} align="center" sx={{ py: 3, color: 'text.secondary' }}>Нет заказов</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailOpen(false)}>Закрыть</Button>
        </DialogActions>
      </Dialog>

      {/* Route map dialog */}
      <Dialog open={routeOpen} onClose={() => setRouteOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Маршрут заказа
          {selectedOrder && statusChip(selectedOrder.status)}
        </DialogTitle>
        <DialogContent>
          {selectedOrder && (
            <Box>
              {isLoaded && selectedOrder.route && selectedOrder.route.length > 0 ? (
                <Box sx={{ height: 320, borderRadius: 2, overflow: 'hidden', mb: 2 }}>
                  <GoogleMap
                    mapContainerStyle={{ width: '100%', height: '100%' }}
                    center={getMapCenter(selectedOrder.route)}
                    zoom={14}
                    options={{ streetViewControl: false, mapTypeControl: false }}
                  >
                    <PolylineF path={selectedOrder.route.map(p => ({ lat: p.latitude, lng: p.longitude }))} options={{ strokeColor: '#1B5E20', strokeWeight: 4 }} />
                    <MarkerF position={{ lat: selectedOrder.route[0].latitude, lng: selectedOrder.route[0].longitude }} label="A" />
                    <MarkerF position={{ lat: selectedOrder.route[selectedOrder.route.length - 1].latitude, lng: selectedOrder.route[selectedOrder.route.length - 1].longitude }} label="B" />
                  </GoogleMap>
                </Box>
              ) : (
                <Box sx={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#f5f5f5', borderRadius: 2, mb: 2 }}>
                  <Typography color="text.secondary">Маршрут не доступен</Typography>
                </Box>
              )}
              <Grid container spacing={2}>
                <Grid item xs={6}><Typography variant="body2" color="text.secondary">Дата</Typography><Typography fontWeight={600}>{formatDate(selectedOrder.createdAt)}</Typography></Grid>
                <Grid item xs={6}><Typography variant="body2" color="text.secondary">Курьер</Typography><Typography fontWeight={600}>{selectedOrder.courierName || '—'}</Typography></Grid>
                <Grid item xs={6}><Typography variant="body2" color="text.secondary">Откуда</Typography><Typography fontWeight={600}>{selectedOrder.pickup?.address || '—'}</Typography></Grid>
                <Grid item xs={6}><Typography variant="body2" color="text.secondary">Куда</Typography><Typography fontWeight={600}>{selectedOrder.destination?.address || '—'}</Typography></Grid>
                <Grid item xs={12}><Divider /></Grid>
                <Grid item xs={4}><Typography variant="body2" color="text.secondary">Расстояние</Typography><Typography fontWeight={600}>{formatDistance(selectedOrder.distanceMeters)}</Typography></Grid>
                <Grid item xs={4}><Typography variant="body2" color="text.secondary">Длительность</Typography><Typography fontWeight={600}>{formatDuration(selectedOrder.startTime, selectedOrder.endTime)}</Typography></Grid>
                <Grid item xs={4}><Typography variant="body2" color="text.secondary">Стоимость</Typography><Typography fontWeight={600} color="green">{formatCost(selectedOrder.cost)}</Typography></Grid>
                {selectedOrder.comment && (
                  <Grid item xs={12}><Typography variant="body2" color="text.secondary">Комментарий</Typography><Typography fontWeight={600}>{selectedOrder.comment}</Typography></Grid>
                )}
              </Grid>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRouteOpen(false)}>Закрыть</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Clients;
