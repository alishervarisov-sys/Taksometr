import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, FormControlLabel,
  Grid, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TextField, Typography,
} from '@mui/material';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';

interface SmartDispatchProps {
  adminId: string;
}

interface SmartDispatchConfig {
  enabled: boolean;
  offerTimeoutSeconds: number;
  maxAssignmentAttempts: number;
  etaWeight: number;
  distanceWeight: number;
  courierLoadWeight: number;
  idleTimeWeight: number;
  maxDistanceMeters: number;
}

interface DispatchOrder {
  id: string;
  status?: string;
  orderKind?: string;
  dispatchState?: string;
  offerCourierId?: string | null;
  offerExpiresAt?: number | null;
  assignmentAttemptCount?: number;
  autoAssignmentFailedAt?: number;
  clientPhone?: string;
  createdAt?: number;
  pickup?: { address?: string };
  destination?: { address?: string };
}

interface DispatchHistoryEntry {
  id: string;
  courierId?: string;
  courierName?: string;
  event: string;
  reason?: string;
  at?: number;
  score?: number;
  distanceMeters?: number;
  etaSeconds?: number;
}

const INITIAL_CONFIG: SmartDispatchConfig = {
  enabled: false,
  offerTimeoutSeconds: 20,
  maxAssignmentAttempts: 3,
  etaWeight: 1,
  distanceWeight: 0.001,
  courierLoadWeight: 5,
  idleTimeWeight: 0.01,
  maxDistanceMeters: 15000,
};

const ACTIVE_STATES = ['AUTO_ASSIGNMENT_PENDING', 'OFFERED', 'REASSIGNING'];

const eventLabels: Record<string, string> = {
  CONSIDERED: 'Рассмотрен системой',
  OFFERED: 'Предложен',
  ACCEPTED: 'Принял заказ',
  DECLINED: 'Отказался',
  EXPIRED: 'Не принял вовремя',
  EXCLUDED: 'Исключён из подбора',
};

const eventColors: Record<string, 'default' | 'info' | 'success' | 'error' | 'warning'> = {
  CONSIDERED: 'default',
  OFFERED: 'info',
  ACCEPTED: 'success',
  DECLINED: 'error',
  EXPIRED: 'warning',
  EXCLUDED: 'default',
};

const stateLabels: Record<string, string> = {
  AUTO_ASSIGNMENT_PENDING: 'Идёт поиск',
  OFFERED: 'Ожидается ответ',
  REASSIGNING: 'Переназначение',
  ACCEPTED: 'Принят',
  OPEN_POOL: 'Общий пул',
};

const reasonLabels: Record<string, string> = {
  NOT_A_COURIER: 'Пользователь не является курьером',
  BLOCKED: 'Курьер заблокирован',
  OFFLINE: 'Курьер не на смене или недоступен',
  ALREADY_ATTEMPTED: 'Этому курьеру уже предлагали заказ',
  MISSING_GPS: 'Нет данных о геолокации',
  STALE_GPS: 'Данные геолокации устарели',
  MAX_ACTIVE_ORDERS: 'Достигнут лимит активных заказов',
  INSUFFICIENT_BALANCE: 'Баланс ниже 5 сомони',
  ACTIVE_CHAIN: 'Курьер выполняет цепочку доставок',
  COURIER_RESERVED: 'Курьер ожидает ответа на другое предложение',
  VEHICLE_MISMATCH: 'Не подходит тип транспорта',
  OUTSIDE_ALLOWED_ZONE: 'Курьер вне зоны обслуживания',
  ORDER_UNAVAILABLE: 'Заказ больше недоступен',
  DECLINED: 'Курьер отказался от заказа',
  EXPIRED: 'Курьер не ответил вовремя',
  UNAVAILABLE: 'Курьер стал недоступен',
  MAX_ATTEMPTS: 'Исчерпано число попыток назначения',
  NO_ELIGIBLE_COURIERS: 'Нет подходящих курьеров',
  NO_REMAINING_CANDIDATES: 'Не осталось доступных кандидатов',
};

function asMillis(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}

function formatTime(value?: number): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(new Date(value));
}

function formatRemaining(expiresAt?: number | null): string {
  if (!expiresAt) return '—';
  const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  return seconds > 0 ? `${seconds} сек.` : 'время вышло';
}

function formatReason(reason?: string): string | null {
  if (!reason) return null;
  if (reason.startsWith('OPEN_POOL:')) {
    const openPoolReason = reason.slice('OPEN_POOL:'.length);
    return `${reasonLabels[openPoolReason] || openPoolReason} — заказ отправлен в общий пул`;
  }
  return reasonLabels[reason] || reason;
}

function formatDispatchDetails(entry: DispatchHistoryEntry): string {
  const reason = formatReason(entry.reason);
  if (reason) return reason;
  if (entry.distanceMeters) {
    return `${Math.round(entry.distanceMeters)} м, прибытие через ${Math.ceil((entry.etaSeconds || 0) / 60)} мин.`;
  }
  return '—';
}

const SmartDispatch: React.FC<SmartDispatchProps> = ({ adminId }) => {
  const [config, setConfig] = useState<SmartDispatchConfig>(INITIAL_CONFIG);
  const [configLoading, setConfigLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configError, setConfigError] = useState('');
  const [recentOrders, setRecentOrders] = useState<DispatchOrder[]>([]);
  const [activeOrders, setActiveOrders] = useState<DispatchOrder[]>([]);
  const [historyByOrder, setHistoryByOrder] = useState<Record<string, DispatchHistoryEntry[]>>({});
  const [courierNames, setCourierNames] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadConfig = async () => {
      try {
        setConfigLoading(true);
        setConfigError('');
        const getConfig = httpsCallable(functions, 'getSmartDispatchConfig');
        const result: any = await getConfig({ adminId });
        if (mounted) setConfig(current => ({ ...current, ...(result.data || {}) }));
      } catch (error: any) {
        if (mounted) setConfigError(error.message || 'Не удалось загрузить настройки Smart Dispatch.');
      } finally {
        if (mounted) setConfigLoading(false);
      }
    };
    loadConfig();
    return () => { mounted = false; };
  }, [adminId]);

  useEffect(() => {
    const unsubscribeRecent = onSnapshot(
      query(collection(db, 'deliveries'), orderBy('createdAt', 'desc'), limit(100)),
      snapshot => setRecentOrders(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as DispatchOrder))),
      error => setConfigError(error.message || 'Не удалось обновить список заказов.'),
    );
    const unsubscribeActive = onSnapshot(
      query(
        collection(db, 'deliveries'),
        where('status', '==', 'PENDING'),
        where('dispatchState', 'in', ACTIVE_STATES),
      ),
      snapshot => setActiveOrders(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as DispatchOrder))),
      error => setConfigError(error.message || 'Не удалось обновить активные предложения.'),
    );
    const unsubscribeCouriers = onSnapshot(
      query(collection(db, 'users'), where('role', '==', 'COURIER')),
      snapshot => setCourierNames(Object.fromEntries(snapshot.docs.map(item => [item.id, item.data().name || item.data().phone || item.id]))),
    );
    return () => {
      unsubscribeRecent();
      unsubscribeActive();
      unsubscribeCouriers();
    };
  }, []);

  const orders = useMemo(() => {
    const combined = new Map<string, DispatchOrder>();
    [...recentOrders, ...activeOrders].forEach(order => combined.set(order.id, order));
    return [...combined.values()]
      .filter(order => order.orderKind === 'MARKETPLACE' && (
        ACTIVE_STATES.includes(order.dispatchState || '') ||
        order.dispatchState === 'ACCEPTED' ||
        Boolean(order.assignmentAttemptCount) ||
        Boolean(order.autoAssignmentFailedAt) ||
        Boolean(order.offerCourierId)
      ))
      .sort((a, b) => {
        const activeDifference = Number(ACTIVE_STATES.includes(b.dispatchState || '')) - Number(ACTIVE_STATES.includes(a.dispatchState || ''));
        return activeDifference || asMillis(b.createdAt) - asMillis(a.createdAt);
      });
  }, [recentOrders, activeOrders]);

  useEffect(() => {
    const orderIds = new Set(orders.map(order => order.id));
    setHistoryByOrder(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => orderIds.has(id))));
    const unsubscribers = orders.map(order => onSnapshot(
      query(collection(db, 'deliveries', order.id, 'dispatchHistory'), orderBy('at', 'desc'), limit(50)),
      snapshot => setHistoryByOrder(previous => ({
        ...previous,
        [order.id]: snapshot.docs.map(item => ({ id: item.id, ...item.data(), at: asMillis(item.data().at) } as DispatchHistoryEntry)),
      })),
      error => setConfigError(error.message || 'Не удалось обновить журнал Smart Dispatch.'),
    ));
    return () => unsubscribers.forEach(unsubscribe => unsubscribe());
  }, [orders]);

  const activity = useMemo(() => orders.flatMap(order => (historyByOrder[order.id] || []).map(entry => ({ order, entry })))
    .sort((a, b) => (b.entry.at || 0) - (a.entry.at || 0)), [orders, historyByOrder]);
  const declinedCount = activity.filter(item => item.entry.event === 'DECLINED').length;
  const expiredCount = activity.filter(item => item.entry.event === 'EXPIRED').length;
  const offeredCount = orders.filter(order => order.dispatchState === 'OFFERED').length;

  const saveConfig = async () => {
    try {
      setSaving(true);
      setConfigError('');
      const updateConfig = httpsCallable(functions, 'updateSmartDispatchConfig');
      await updateConfig({ adminId, config });
    } catch (error: any) {
      setConfigError(error.message || 'Не удалось сохранить настройки Smart Dispatch.');
    } finally {
      setSaving(false);
    }
  };

  const courierName = (entry: DispatchHistoryEntry, order: DispatchOrder) => {
    const courierId = entry.courierId || (entry.event === 'OFFERED' ? order.offerCourierId : undefined);
    return entry.courierName || (courierId ? courierNames[courierId] : '') || 'Система';
  };

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Smart Dispatch</Typography>
        <Typography color="text.secondary">Предложения курьерам и их ответы обновляются автоматически.</Typography>
      </Box>

      {configError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setConfigError('')}>{configError}</Alert>}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={4}><Card><CardContent><Typography color="text.secondary">Ожидают ответа</Typography><Typography variant="h4" color="info.main">{offeredCount}</Typography></CardContent></Card></Grid>
        <Grid item xs={12} sm={4}><Card><CardContent><Typography color="text.secondary">Отказались в ленте</Typography><Typography variant="h4" color="error.main">{declinedCount}</Typography></CardContent></Card></Grid>
        <Grid item xs={12} sm={4}><Card><CardContent><Typography color="text.secondary">Не приняли вовремя</Typography><Typography variant="h4" color="warning.main">{expiredCount}</Typography></CardContent></Card></Grid>
      </Grid>

      <Grid container spacing={3}>
        <Grid item xs={12} lg={8}>
          <Card>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Box><Typography variant="h6">Заказы в Smart Dispatch</Typography><Typography variant="body2" color="text.secondary">Активные — вверху; последние события видны сразу после изменения.</Typography></Box>
                <Chip label={`обновлено ${new Date(now).toLocaleTimeString('ru-RU')}`} size="small" color="success" variant="outlined" />
              </Stack>
              <TableContainer>
                <Table size="small">
                  <TableHead><TableRow><TableCell>Заказ</TableCell><TableCell>Статус</TableCell><TableCell>Кому предложен</TableCell><TableCell>Время ответа</TableCell><TableCell>Попытки</TableCell><TableCell>Последнее событие</TableCell></TableRow></TableHead>
                  <TableBody>
                    {orders.map(order => {
                      const latest = historyByOrder[order.id]?.[0];
                      const offeredTo = order.offerCourierId ? (courierNames[order.offerCourierId] || order.offerCourierId) : '—';
                      return <TableRow key={order.id}>
                        <TableCell><Typography variant="body2" fontWeight={600}>#{order.id.slice(0, 8)}</Typography><Typography variant="caption" color="text.secondary">{order.pickup?.address || order.clientPhone || 'Заказ доставки'}</Typography></TableCell>
                        <TableCell><Chip size="small" color={order.dispatchState === 'OFFERED' ? 'info' : order.dispatchState === 'ACCEPTED' ? 'success' : 'default'} label={stateLabels[order.dispatchState || ''] || order.dispatchState || '—'} /></TableCell>
                        <TableCell>{offeredTo}</TableCell>
                        <TableCell>{order.dispatchState === 'OFFERED' ? formatRemaining(order.offerExpiresAt) : '—'}</TableCell>
                        <TableCell>{order.assignmentAttemptCount || 0}/{config.maxAssignmentAttempts}</TableCell>
                        <TableCell>{latest ? <><Chip size="small" color={eventColors[latest.event] || 'default'} label={eventLabels[latest.event] || latest.event} /><Typography variant="caption" display="block">{formatTime(latest.at)}</Typography></> : 'Ожидание'}</TableCell>
                      </TableRow>;
                    })}
                    {!orders.length && <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>Пока нет заказов, прошедших через Smart Dispatch.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} lg={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1 }}>Настройки Smart Dispatch</Typography>
              {configLoading ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}><CircularProgress /></Box> : <>
                <Alert severity={config.enabled ? 'success' : 'info'} sx={{ mb: 2 }}>{config.enabled ? 'Автоматическое распределение включено.' : 'Выключено: новые заказы идут в общий пул.'}</Alert>
                <FormControlLabel control={<Switch checked={config.enabled} onChange={event => setConfig(value => ({ ...value, enabled: event.target.checked }))} />} label="Включить автоматическое распределение" />
                <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
                  <Grid item xs={6}><TextField fullWidth type="number" label="Таймаут, сек" value={config.offerTimeoutSeconds} onChange={event => setConfig(value => ({ ...value, offerTimeoutSeconds: Number(event.target.value) }))} inputProps={{ min: 5, max: 300 }} /></Grid>
                  <Grid item xs={6}><TextField fullWidth type="number" label="Макс. попыток" value={config.maxAssignmentAttempts} onChange={event => setConfig(value => ({ ...value, maxAssignmentAttempts: Number(event.target.value) }))} inputProps={{ min: 1, max: 20 }} /></Grid>
                  <Grid item xs={6}><TextField fullWidth type="number" label="Вес ETA" value={config.etaWeight} onChange={event => setConfig(value => ({ ...value, etaWeight: Number(event.target.value) }))} /></Grid>
                  <Grid item xs={6}><TextField fullWidth type="number" label="Вес расстояния" value={config.distanceWeight} onChange={event => setConfig(value => ({ ...value, distanceWeight: Number(event.target.value) }))} inputProps={{ step: 0.001 }} /></Grid>
                  <Grid item xs={6}><TextField fullWidth type="number" label="Вес загрузки" value={config.courierLoadWeight} onChange={event => setConfig(value => ({ ...value, courierLoadWeight: Number(event.target.value) }))} /></Grid>
                  <Grid item xs={6}><TextField fullWidth type="number" label="Вес простоя" value={config.idleTimeWeight} onChange={event => setConfig(value => ({ ...value, idleTimeWeight: Number(event.target.value) }))} inputProps={{ step: 0.01 }} /></Grid>
                  <Grid item xs={12}><TextField fullWidth type="number" label="Макс. дистанция поиска, м" value={config.maxDistanceMeters} onChange={event => setConfig(value => ({ ...value, maxDistanceMeters: Number(event.target.value) }))} inputProps={{ min: 100, max: 100000 }} /></Grid>
                </Grid>
                <Button fullWidth variant="contained" sx={{ mt: 2 }} onClick={saveConfig} disabled={saving}>{saving ? 'Сохранение...' : 'Сохранить настройки'}</Button>
              </>}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>Живая лента решений</Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead><TableRow><TableCell>Время</TableCell><TableCell>Заказ</TableCell><TableCell>Курьер</TableCell><TableCell>Событие</TableCell><TableCell>Детали</TableCell></TableRow></TableHead>
                  <TableBody>
                    {activity.slice(0, 100).map(({ order, entry }) => <TableRow key={`${order.id}-${entry.id}`} sx={entry.event === 'DECLINED' || entry.event === 'EXPIRED' ? { bgcolor: 'rgba(255, 152, 0, 0.06)' } : undefined}>
                      <TableCell>{formatTime(entry.at)}</TableCell>
                      <TableCell>#{order.id.slice(0, 8)}</TableCell>
                      <TableCell>{courierName(entry, order)}</TableCell>
                      <TableCell><Chip size="small" color={eventColors[entry.event] || 'default'} label={eventLabels[entry.event] || entry.event} /></TableCell>
                      <TableCell>{formatDispatchDetails(entry)}</TableCell>
                    </TableRow>)}
                    {!activity.length && <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>Событий пока нет.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default SmartDispatch;
