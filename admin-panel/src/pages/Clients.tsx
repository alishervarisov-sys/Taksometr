import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Card, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, TextField, InputAdornment, Dialog,
  DialogTitle, DialogContent, DialogActions, Button, Grid, Divider,
  Stack, Tabs, Tab, CircularProgress, Avatar,
} from '@mui/material';
import { Search, Person as PersonIcon, LocalShipping as DeliveryIcon, LocalTaxi as TaxiIcon } from '@mui/icons-material';
import { collection, getDocs, query, orderBy, limit, where } from 'firebase/firestore';
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
  completedOrders: number;
  totalSpent: number;
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

// ─── Component ──────────────────────────────────────────────────────────────

const Clients: React.FC<ClientsProps> = ({ adminId }) => {
  void adminId;
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<DeliveryOrder | null>(null);
  const [routeOpen, setRouteOpen] = useState(false);

  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
  });

  useEffect(() => {
    loadClients();
  }, []);

  const loadClients = async () => {
    setLoading(true);
    try {
      // Load user names by phone
      const usersSnap = await getDocs(query(collection(db, 'users'), where('phone', '!=', '')));
      const nameByPhone = new Map<string, string>();
      usersSnap.docs.forEach(d => {
        const data = d.data() as any;
        if (data.phone) nameByPhone.set(String(data.phone), data.name || '');
      });

      // Load deliveries
      const delSnap = await getDocs(query(collection(db, 'deliveries'), orderBy('createdAt', 'desc'), limit(1000)));
      const deliveryOrders: DeliveryOrder[] = delSnap.docs.map(d => {
        const data = d.data() as any;
        return { id: d.id, kind: 'delivery', ...data } as DeliveryOrder;
      });

      // Load taxi orders
      let taxiOrders: TaxiHistoryOrder[] = [];
      try {
        const taxiSnap = await getDocs(query(collection(db, 'taxi_orders'), orderBy('createdAt', 'desc'), limit(1000)));
        taxiOrders = taxiSnap.docs.map(d => {
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
        });
      } catch (e) {
        // taxi_orders may not exist / be inaccessible — ignore
        console.warn('Не удалось загрузить такси-заказы', e);
      }

      // Aggregate by phone
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
            completedOrders: 0,
            totalSpent: 0,
            lastOrderAt: 0,
            orders: [],
          };
          map.set(phone, c);
        }
        return c;
      };

      deliveryOrders.forEach(o => {
        if (!o.clientPhone) return;
        const c = ensure(o.clientPhone);
        c.orders.push(o);
        c.deliveryOrders += 1;
        c.totalOrders += 1;
        if (isCompleted(o)) { c.completedOrders += 1; c.totalSpent += o.cost || 0; }
        if ((o.createdAt || 0) > c.lastOrderAt) c.lastOrderAt = o.createdAt || 0;
      });

      taxiOrders.forEach(o => {
        if (!o.clientPhone) return;
        const c = ensure(o.clientPhone);
        c.orders.push(o);
        c.taxiOrders += 1;
        c.totalOrders += 1;
        if (isCompleted(o)) c.completedOrders += 1;
        if ((o.createdAt || 0) > c.lastOrderAt) c.lastOrderAt = o.createdAt || 0;
      });

      const list = Array.from(map.values());
      // Sort each client's orders newest first
      list.forEach(c => c.orders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
      // Sort clients by number of orders desc
      list.sort((a, b) => b.totalOrders - a.totalOrders || b.lastOrderAt - a.lastOrderAt);
      setClients(list);
    } catch (e) {
      console.error('Ошибка загрузки клиентов', e);
    } finally {
      setLoading(false);
    }
  };

  const filteredClients = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(c =>
      c.phone.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
    );
  }, [clients, searchQuery]);

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
  }), [clients]);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Клиенты</Typography>
        <Button variant="outlined" onClick={loadClients} disabled={loading}>Обновить</Button>
      </Box>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} md={3}>
          <Card sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">Всего клиентов</Typography>
            <Typography variant="h5" fontWeight={700}>{totals.clients}</Typography>
          </Card>
        </Grid>
        <Grid item xs={6} md={3}>
          <Card sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">Всего заказов</Typography>
            <Typography variant="h5" fontWeight={700}>{totals.orders}</Typography>
          </Card>
        </Grid>
      </Grid>

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
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 5 }}><CircularProgress /></Box>
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Клиент</TableCell>
                  <TableCell>Телефон</TableCell>
                  <TableCell align="center">Всего заказов</TableCell>
                  <TableCell align="center">Доставки</TableCell>
                  <TableCell align="center">Такси</TableCell>
                  <TableCell align="center">Завершено</TableCell>
                  <TableCell align="right">Потрачено</TableCell>
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
                    <TableCell align="center">{client.deliveryOrders}</TableCell>
                    <TableCell align="center">{client.taxiOrders}</TableCell>
                    <TableCell align="center">{client.completedOrders}</TableCell>
                    <TableCell align="right" style={{ whiteSpace: 'nowrap' }}>{formatCost(client.totalSpent)}</TableCell>
                    <TableCell>{formatDate(client.lastOrderAt)}</TableCell>
                  </TableRow>
                ))}
                {filteredClients.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} align="center" sx={{ py: 4, color: 'text.secondary' }}>Клиенты не найдены</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>

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
                <Grid item xs={6} md={3}><Typography variant="body2" color="text.secondary">Доставки / Такси</Typography><Typography fontWeight={700}>{selectedClient.deliveryOrders} / {selectedClient.taxiOrders}</Typography></Grid>
                <Grid item xs={6} md={3}><Typography variant="body2" color="text.secondary">Потрачено</Typography><Typography fontWeight={700} color="green">{formatCost(selectedClient.totalSpent)}</Typography></Grid>
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
                            ? <Chip icon={<DeliveryIcon />} label={o.orderKind === 'MARKETPLACE' ? 'Админ заказ' : 'Доставка'} size="small" />
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
