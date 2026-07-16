import React, { useEffect, useState, useMemo } from 'react';
import {
  Box, Typography, Card, CardContent, Grid, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, ToggleButton,
  ToggleButtonGroup, TextField, Button, Stack, Chip, Divider,
  Avatar, LinearProgress,
} from '@mui/material';
import {
  TrendingUp, TrendingDown, TrendingFlat, FileDownload,
  Insights, PeopleAlt, LocalShipping,
} from '@mui/icons-material';
import {
  ResponsiveContainer, ComposedChart, Area, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell, BarChart,
} from 'recharts';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

interface AnalyticsProps {
  adminId: string;
}

// ─── Raw data types ─────────────────────────────────────────────────────────
interface RawDelivery {
  id: string;
  courierId?: string;
  courierName?: string;
  clientPhone?: string;
  status?: string;
  cost?: number;
  commission?: number;
  distanceMeters?: number;
  waitingCost?: number;
  startTime?: number;
  endTime?: number | null;
  createdAt?: number;
  orderKind?: string;
}

interface RawTaxi {
  id: string;
  status?: string;
  createdAt?: number;
  driverName?: string;
  customerPhone?: string;
}

type Period = 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'custom';
type Granularity = 'hour' | 'day' | 'month';

// ─── Metric aggregate ───────────────────────────────────────────────────────
interface Metrics {
  total: number;
  completed: number;
  cancelled: number;
  inProgress: number;
  pending: number;
  revenue: number;
  commission: number;
  net: number;
  distance: number;
  avgCheck: number;
  avgTime: number;      // ms
  completionRate: number;
  cancelRate: number;
  revenuePerKm: number;
  uniqueClients: number;
  activeCouriers: number;
}

const COLORS = {
  revenue: '#00C853',
  net: '#1B5E20',
  commission: '#FF6D00',
  orders: '#2196F3',
  taxi: '#FFC107',
  delivery: '#1B5E20',
  purple: '#7B1FA2',
  teal: '#00897B',
  red: '#D32F2F',
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  COMPLETED: { label: 'Завершено', color: '#00C853' },
  CANCELLED: { label: 'Отменено', color: '#D32F2F' },
  IN_PROGRESS: { label: 'В процессе', color: '#2196F3' },
  PENDING: { label: 'Ожидает', color: '#FF9800' },
};

const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const Analytics: React.FC<AnalyticsProps> = () => {
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('week');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // Raw datasets (loaded up to endDate so we can derive current + previous + lifetime)
  const [allDeliveries, setAllDeliveries] = useState<RawDelivery[]>([]);
  const [allTaxi, setAllTaxi] = useState<RawTaxi[]>([]);
  const [totalCouriers, setTotalCouriers] = useState(0);
  const [range, setRange] = useState<{ start: number; end: number }>({ start: 0, end: Date.now() });

  useEffect(() => {
    if (period !== 'custom') loadData();
  }, [period]);

  // ─── Date range ───────────────────────────────────────────────────────────
  const getDateRange = (): { start: number; end: number } => {
    const now = new Date();
    const end = now.getTime();
    switch (period) {
      case 'today': {
        const s = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return { start: s.getTime(), end };
      }
      case 'yesterday': {
        const s = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        const e = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - 1;
        return { start: s.getTime(), end: e };
      }
      case 'week':
        return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime(), end };
      case 'month':
        return { start: new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()).getTime(), end };
      case 'year':
        return { start: new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).getTime(), end };
      case 'custom': {
        if (customStart && customEnd) {
          const s = new Date(customStart);
          const e = new Date(customEnd);
          return {
            start: new Date(s.getFullYear(), s.getMonth(), s.getDate()).getTime(),
            end: new Date(e.getFullYear(), e.getMonth(), e.getDate(), 23, 59, 59, 999).getTime(),
          };
        }
        return { start: end - 7 * 86400000, end };
      }
      default:
        return { start: end - 7 * 86400000, end };
    }
  };

  // ─── Data loading ───────────────────────────────────────────────────────────
  const loadData = async () => {
    setLoading(true);
    try {
      const { start, end } = getDateRange();
      setRange({ start, end });

      // Load deliveries up to endDate (covers current period + previous period + lifetime cohort)
      const delSnap = await getDocs(query(
        collection(db, 'deliveries'),
        where('createdAt', '<=', end),
        orderBy('createdAt', 'desc'),
        limit(20000),
      ));
      const deliveries = delSnap.docs.map(d => ({ id: d.id, ...d.data() })) as RawDelivery[];

      // Taxi orders up to endDate
      let taxi: RawTaxi[] = [];
      try {
        const taxiSnap = await getDocs(query(
          collection(db, 'taxi_orders'),
          where('createdAt', '<=', end),
          orderBy('createdAt', 'desc'),
          limit(20000),
        ));
        taxi = taxiSnap.docs.map(d => ({ id: d.id, ...d.data() })) as RawTaxi[];
      } catch (e) {
        console.warn('taxi_orders load failed', e);
      }

      // Total couriers
      let couriers = 0;
      try {
        const cSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'COURIER')));
        couriers = cSnap.size;
      } catch (e) {
        console.warn('couriers load failed', e);
      }

      setAllDeliveries(deliveries);
      setAllTaxi(taxi);
      setTotalCouriers(couriers);
    } catch (err) {
      console.error('Error loading analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  // ─── Derived analytics ──────────────────────────────────────────────────────
  const analytics = useMemo(() => {
    const { start, end } = range;
    const span = Math.max(end - start, 1);
    const prevEnd = start - 1;
    const prevStart = start - span;

    const inRange = (t?: number, s = start, e = end) => t != null && t >= s && t <= e;

    const current = allDeliveries.filter(d => inRange(d.createdAt));
    const previous = allDeliveries.filter(d => inRange(d.createdAt, prevStart, prevEnd));
    const taxiCurrent = allTaxi.filter(t => inRange(t.createdAt));
    const taxiPrevious = allTaxi.filter(t => inRange(t.createdAt, prevStart, prevEnd));

    const computeMetrics = (list: RawDelivery[]): Metrics => {
      let revenue = 0, commission = 0, distance = 0;
      let completed = 0, cancelled = 0, inProgress = 0, pending = 0;
      let timeSum = 0, timed = 0;
      const clients = new Set<string>();
      const couriers = new Set<string>();
      list.forEach(d => {
        switch (d.status) {
          case 'CANCELLED': cancelled++; return;
          case 'IN_PROGRESS': inProgress++; return;
          case 'PENDING': pending++; return;
          case 'COMPLETED': break;
          default: return;
        }
        completed++;
        revenue += d.cost || 0;
        commission += d.commission || 0;
        distance += d.distanceMeters || 0;
        if (d.clientPhone) clients.add(d.clientPhone);
        if (d.courierId) couriers.add(d.courierId);
        if (d.startTime && d.endTime && d.endTime > d.startTime) {
          timeSum += d.endTime - d.startTime;
          timed++;
        }
      });
      const total = list.length;
      return {
        total, completed, cancelled, inProgress, pending,
        revenue, commission, net: revenue - commission, distance,
        avgCheck: completed ? revenue / completed : 0,
        avgTime: timed ? timeSum / timed : 0,
        completionRate: total ? (completed / total) * 100 : 0,
        cancelRate: total ? (cancelled / total) * 100 : 0,
        revenuePerKm: distance ? revenue / (distance / 1000) : 0,
        uniqueClients: clients.size,
        activeCouriers: couriers.size,
      };
    };

    const cur = computeMetrics(current);
    const prev = computeMetrics(previous);

    // ── Trend over time ──
    let granularity: Granularity;
    if (period === 'today' || period === 'yesterday' || span <= 2 * 86400000) granularity = 'hour';
    else if (span <= 92 * 86400000) granularity = 'day';
    else granularity = 'month';

    const trendMap = new Map<string, { key: string; label: string; sortKey: number; revenue: number; net: number; orders: number; commission: number }>();

    const bucketOf = (ts: number): { key: string; label: string; sortKey: number } => {
      const d = new Date(ts);
      if (granularity === 'hour') {
        const h = d.getHours();
        return { key: `h${h}`, label: `${String(h).padStart(2, '0')}:00`, sortKey: h };
      }
      if (granularity === 'day') {
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        return {
          key,
          label: `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`,
          sortKey: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(),
        };
      }
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      return {
        key,
        label: `${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`,
        sortKey: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
      };
    };

    // Pre-seed hour buckets for full-day view for a clean 0..23 axis
    if (granularity === 'hour' && (period === 'today' || period === 'yesterday')) {
      for (let h = 0; h < 24; h++) {
        trendMap.set(`h${h}`, { key: `h${h}`, label: `${String(h).padStart(2, '0')}:00`, sortKey: h, revenue: 0, net: 0, orders: 0, commission: 0 });
      }
    }

    const hourBuckets = new Array(24).fill(0).map((_, h) => ({ hour: h, label: `${String(h).padStart(2, '0')}`, orders: 0, revenue: 0 }));
    const weekdayBuckets = WEEKDAY_LABELS.map((label) => ({ label, orders: 0, revenue: 0 }));

    current.forEach(d => {
      if (d.status !== 'COMPLETED' || d.createdAt == null) return;
      const b = bucketOf(d.createdAt);
      const existing = trendMap.get(b.key) || { ...b, revenue: 0, net: 0, orders: 0, commission: 0 };
      const cost = d.cost || 0;
      const comm = d.commission || 0;
      existing.revenue += cost;
      existing.commission += comm;
      existing.net += cost - comm;
      existing.orders += 1;
      trendMap.set(b.key, existing);

      const dt = new Date(d.createdAt);
      hourBuckets[dt.getHours()].orders += 1;
      hourBuckets[dt.getHours()].revenue += cost;
      const wd = (dt.getDay() + 6) % 7; // Mon=0
      weekdayBuckets[wd].orders += 1;
      weekdayBuckets[wd].revenue += cost;
    });

    const trend = Array.from(trendMap.values())
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(t => ({ label: t.label, revenue: Math.round(t.revenue), net: Math.round(t.net), commission: Math.round(t.commission), orders: t.orders }));

    // ── Status breakdown ──
    const statusData = [
      { name: STATUS_META.COMPLETED.label, value: cur.completed, color: STATUS_META.COMPLETED.color },
      { name: STATUS_META.CANCELLED.label, value: cur.cancelled, color: STATUS_META.CANCELLED.color },
      { name: STATUS_META.IN_PROGRESS.label, value: cur.inProgress, color: STATUS_META.IN_PROGRESS.color },
      { name: STATUS_META.PENDING.label, value: cur.pending, color: STATUS_META.PENDING.color },
    ].filter(s => s.value > 0);

    // ── Courier performance ──
    interface CourierRow {
      id: string; name: string; orders: number; revenue: number;
      commission: number; net: number; distance: number; cancelled: number;
      timeSum: number; timed: number; avgCheck: number; avgTime: number;
    }
    const courierMap = new Map<string, CourierRow>();
    const ensure = (id: string, name?: string): CourierRow => {
      let r = courierMap.get(id);
      if (!r) {
        r = { id, name: name || 'Неизвестный', orders: 0, revenue: 0, commission: 0, net: 0, distance: 0, cancelled: 0, timeSum: 0, timed: 0, avgCheck: 0, avgTime: 0 };
        courierMap.set(id, r);
      }
      if (name && r.name === 'Неизвестный') r.name = name;
      return r;
    };
    current.forEach(d => {
      const id = d.courierId || 'unknown';
      const r = ensure(id, d.courierName);
      if (d.status === 'CANCELLED') { r.cancelled++; return; }
      if (d.status !== 'COMPLETED') return;
      r.orders++;
      r.revenue += d.cost || 0;
      r.commission += d.commission || 0;
      r.net += (d.cost || 0) - (d.commission || 0);
      r.distance += d.distanceMeters || 0;
      if (d.startTime && d.endTime && d.endTime > d.startTime) { r.timeSum += d.endTime - d.startTime; r.timed++; }
    });
    const couriers = Array.from(courierMap.values())
      .filter(c => c.orders > 0 || c.cancelled > 0)
      .map(c => ({ ...c, avgCheck: c.orders ? c.revenue / c.orders : 0, avgTime: c.timed ? c.timeSum / c.timed : 0 }))
      .sort((a, b) => b.net - a.net);

    // ── Customer segmentation (lifetime cohort) ──
    // First-ever order time per client (from full dataset up to endDate)
    const firstOrder = new Map<string, number>();
    allDeliveries.forEach(d => {
      if (d.status !== 'COMPLETED' || !d.clientPhone || d.createdAt == null) return;
      const cur2 = firstOrder.get(d.clientPhone);
      if (cur2 == null || d.createdAt < cur2) firstOrder.set(d.clientPhone, d.createdAt);
    });
    // In-period client aggregates
    interface ClientRow { phone: string; orders: number; spent: number; }
    const clientMap = new Map<string, ClientRow>();
    current.forEach(d => {
      if (d.status !== 'COMPLETED' || !d.clientPhone) return;
      let c = clientMap.get(d.clientPhone);
      if (!c) { c = { phone: d.clientPhone, orders: 0, spent: 0 }; clientMap.set(d.clientPhone, c); }
      c.orders++;
      c.spent += d.cost || 0;
    });
    let newClients = 0, returningClients = 0;
    clientMap.forEach((_c, phone) => {
      const first = firstOrder.get(phone);
      if (first != null && first >= start) newClients++;
      else returningClients++;
    });
    const loyalClients = Array.from(clientMap.values()).filter(c => c.orders > 1).length;
    const topClients = Array.from(clientMap.values()).sort((a, b) => b.spent - a.spent).slice(0, 10);
    const customerSegments = [
      { name: 'Новые', value: newClients, color: COLORS.orders },
      { name: 'Вернувшиеся', value: returningClients, color: COLORS.revenue },
    ].filter(s => s.value > 0);

    // ── Delivery vs Taxi ──
    const taxiCompleted = taxiCurrent.filter(t => t.status === 'completed').length;
    const taxiCancelled = taxiCurrent.filter(t => t.status === 'cancelled').length;
    const channelData = [
      { name: 'Доставка', orders: cur.completed, color: COLORS.delivery },
      { name: 'Такси', orders: taxiCompleted, color: COLORS.taxi },
    ];

    // Peak hour / best weekday
    const peakHour = hourBuckets.reduce((a, b) => (b.orders > a.orders ? b : a), hourBuckets[0]);
    const bestWeekday = weekdayBuckets.reduce((a, b) => (b.orders > a.orders ? b : a), weekdayBuckets[0]);

    return {
      cur, prev, trend, statusData, couriers, customerSegments, topClients,
      loyalClients, newClients, returningClients, channelData, hourBuckets, weekdayBuckets,
      taxiCurrent: taxiCurrent.length, taxiCompleted, taxiCancelled,
      taxiPrev: taxiPrevious.length, granularity, peakHour, bestWeekday,
    };
  }, [allDeliveries, allTaxi, range, period]);

  // ─── Formatters ─────────────────────────────────────────────────────────────
  const formatCost = (v: number) => {
    const s = Math.floor(v);
    const d = Math.round((v - s) * 100);
    return d > 0 ? `${s.toLocaleString('ru-RU')}.${String(d).padStart(2, '0')} c` : `${s.toLocaleString('ru-RU')} c`;
  };
  const formatCompact = (v: number) => {
    if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}к`;
    return `${Math.round(v)}`;
  };
  const formatDuration = (ms: number) => {
    if (!ms || ms <= 0) return '—';
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m} мин`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem > 0 ? `${h} ч ${rem} мин` : `${h} ч`;
  };
  const delta = (now: number, prev: number): number | null => {
    if (prev === 0) return now === 0 ? 0 : null; // null => "new" (no baseline)
    return ((now - prev) / prev) * 100;
  };

  const periodLabels: Record<Period, string> = {
    today: 'Сегодня', yesterday: 'Вчера', week: 'Неделя',
    month: 'Месяц', year: 'Год', custom: 'Период',
  };

  // ─── CSV export ───────────────────────────────────────────────────────────
  const exportCsv = () => {
    const lines: string[] = [];
    lines.push('Отчёт по аналитике ZaKi');
    lines.push(`Период;${new Date(range.start).toLocaleDateString('ru-RU')} - ${new Date(range.end).toLocaleDateString('ru-RU')}`);
    lines.push('');
    lines.push('Сводные показатели');
    lines.push('Метрика;Значение');
    lines.push(`Оборот;${analytics.cur.revenue.toFixed(2)}`);
    lines.push(`Чистая выручка;${analytics.cur.net.toFixed(2)}`);
    lines.push(`Комиссия (доход платформы);${analytics.cur.commission.toFixed(2)}`);
    lines.push(`Завершённых доставок;${analytics.cur.completed}`);
    lines.push(`Отменённых;${analytics.cur.cancelled}`);
    lines.push(`Средний чек;${analytics.cur.avgCheck.toFixed(2)}`);
    lines.push(`Конверсия (%);${analytics.cur.completionRate.toFixed(1)}`);
    lines.push(`Отмены (%);${analytics.cur.cancelRate.toFixed(1)}`);
    lines.push(`Уникальных клиентов;${analytics.cur.uniqueClients}`);
    lines.push(`Активных курьеров;${analytics.cur.activeCouriers}`);
    lines.push(`Заказов такси;${analytics.taxiCurrent}`);
    lines.push('');
    lines.push('Курьеры');
    lines.push('Курьер;Доставки;Оборот;Комиссия;Чистая выручка;Ср. чек;Пробег (км);Отмены');
    analytics.couriers.forEach(c => {
      lines.push(`${c.name};${c.orders};${c.revenue.toFixed(2)};${c.commission.toFixed(2)};${c.net.toFixed(2)};${c.avgCheck.toFixed(2)};${(c.distance / 1000).toFixed(2)};${c.cancelled}`);
    });
    lines.push('');
    lines.push('Динамика');
    lines.push('Период;Оборот;Чистая выручка;Заказы');
    analytics.trend.forEach(t => lines.push(`${t.label};${t.revenue};${t.net};${t.orders}`));

    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zaki-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── KPI card ────────────────────────────────────────────────────────────
  const KpiCard: React.FC<{
    title: string; value: string; nowVal: number; prevVal: number;
    color?: string; invert?: boolean; caption?: string;
  }> = ({ title, value, nowVal, prevVal, color = 'primary.main', invert = false, caption }) => {
    const d = delta(nowVal, prevVal);
    let trendColor = 'text.secondary';
    let Icon = TrendingFlat;
    if (d != null && Math.abs(d) >= 0.05) {
      const positive = invert ? d < 0 : d > 0;
      trendColor = positive ? '#00C853' : '#D32F2F';
      Icon = d > 0 ? TrendingUp : TrendingDown;
    }
    return (
      <Card sx={{ height: '100%' }}>
        <CardContent sx={{ p: 2.5 }}>
          <Typography variant="body2" color="text.secondary" noWrap>{title}</Typography>
          <Typography variant="h5" sx={{ fontWeight: 700, color, mt: 0.5 }}>
            {loading ? '...' : value}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
            <Icon sx={{ fontSize: 18, color: trendColor }} />
            <Typography variant="caption" sx={{ color: trendColor, fontWeight: 600 }}>
              {d == null ? 'новое' : `${d > 0 ? '+' : ''}${d.toFixed(1)}%`}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {caption || 'к пред. периоду'}
            </Typography>
          </Box>
        </CardContent>
      </Card>
    );
  };

  const chartCardSx = { mb: 3 };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Insights sx={{ fontSize: 32, color: 'primary.main' }} />
          <Typography variant="h5" sx={{ fontWeight: 700 }}>Аналитика бизнеса</Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<FileDownload />}
          onClick={exportCsv}
          disabled={loading}
        >
          Экспорт CSV
        </Button>
      </Box>

      {/* Period selector */}
      <Box sx={{ mb: 3 }}>
        <ToggleButtonGroup
          value={period}
          exclusive
          onChange={(_, val) => val && setPeriod(val)}
          size="small"
          sx={{ flexWrap: 'wrap' }}
        >
          {Object.entries(periodLabels).map(([key, label]) => (
            <ToggleButton key={key} value={key}>{label}</ToggleButton>
          ))}
        </ToggleButtonGroup>

        {period === 'custom' && (
          <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 2 }} flexWrap="wrap">
            <TextField type="date" label="От" size="small" InputLabelProps={{ shrink: true }}
              value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
            <TextField type="date" label="До" size="small" InputLabelProps={{ shrink: true }}
              value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
            <Button variant="contained" size="small" onClick={loadData} disabled={!customStart || !customEnd}>
              Показать
            </Button>
          </Stack>
        )}
      </Box>

      {loading && <LinearProgress sx={{ mb: 3 }} />}

      {/* ── KPI ROW 1 ── */}
      <Grid container spacing={2.5} sx={{ mb: 1 }}>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard title="Оборот" value={formatCost(analytics.cur.revenue)}
            nowVal={analytics.cur.revenue} prevVal={analytics.prev.revenue} color={COLORS.revenue} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard title="Чистая выручка" value={formatCost(analytics.cur.net)}
            nowVal={analytics.cur.net} prevVal={analytics.prev.net} color={COLORS.net}
            caption="без комиссии" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard title="Комиссия (доход)" value={formatCost(analytics.cur.commission)}
            nowVal={analytics.cur.commission} prevVal={analytics.prev.commission} color={COLORS.commission} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard title="Завершённые доставки" value={String(analytics.cur.completed)}
            nowVal={analytics.cur.completed} prevVal={analytics.prev.completed} color={COLORS.orders} />
        </Grid>
      </Grid>

      {/* ── KPI ROW 2 ── */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard title="Средний чек" value={formatCost(analytics.cur.avgCheck)}
            nowVal={analytics.cur.avgCheck} prevVal={analytics.prev.avgCheck} color={COLORS.teal} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard title="Конверсия" value={`${analytics.cur.completionRate.toFixed(1)}%`}
            nowVal={analytics.cur.completionRate} prevVal={analytics.prev.completionRate} color={COLORS.net}
            caption="завершено из всех" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard title="Отмены" value={`${analytics.cur.cancelRate.toFixed(1)}%`}
            nowVal={analytics.cur.cancelRate} prevVal={analytics.prev.cancelRate} color={COLORS.red}
            invert caption="меньше — лучше" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard title="Ср. время доставки" value={formatDuration(analytics.cur.avgTime)}
            nowVal={analytics.cur.avgTime} prevVal={analytics.prev.avgTime} color={COLORS.purple}
            invert caption="меньше — лучше" />
        </Grid>
      </Grid>

      {/* ── KPI ROW 3 ── */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard title="Уникальные клиенты" value={String(analytics.cur.uniqueClients)}
            nowVal={analytics.cur.uniqueClients} prevVal={analytics.prev.uniqueClients} color={COLORS.orders} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard title="Активные курьеры" value={`${analytics.cur.activeCouriers} / ${totalCouriers}`}
            nowVal={analytics.cur.activeCouriers} prevVal={analytics.prev.activeCouriers} color={COLORS.net}
            caption="работали / всего" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard title="Пробег" value={`${(analytics.cur.distance / 1000).toFixed(1)} км`}
            nowVal={analytics.cur.distance} prevVal={analytics.prev.distance} color={COLORS.orders} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard title="Заказы такси" value={String(analytics.taxiCurrent)}
            nowVal={analytics.taxiCurrent} prevVal={analytics.taxiPrev} color={COLORS.taxi}
            caption={`${analytics.taxiCompleted} завершено`} />
        </Grid>
      </Grid>

      {/* ── REVENUE TREND ── */}
      <Card sx={chartCardSx}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>Динамика выручки и заказов</Typography>
          {analytics.trend.length === 0 ? (
            <Typography color="text.secondary" align="center" sx={{ py: 6 }}>Нет данных за период</Typography>
          ) : (
            <ResponsiveContainer width="100%" height={340}>
              <ComposedChart data={analytics.trend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.revenue} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={COLORS.revenue} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 12 }} tickFormatter={formatCompact} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip formatter={(v: number, name: string) =>
                  name === 'Заказы' ? [v, name] : [formatCost(v as number), name]} />
                <Legend />
                <Area yAxisId="left" type="monotone" dataKey="revenue" name="Оборот" stroke={COLORS.revenue} fill="url(#revGrad)" strokeWidth={2} />
                <Bar yAxisId="left" dataKey="commission" name="Комиссия" fill={COLORS.commission} barSize={18} radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="orders" name="Заказы" stroke={COLORS.orders} strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ── STATUS + CHANNEL + CUSTOMER SEGMENTS ── */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={4}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>Статусы заказов</Typography>
              {analytics.statusData.length === 0 ? (
                <Typography color="text.secondary" align="center" sx={{ py: 6 }}>Нет данных</Typography>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={analytics.statusData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                      innerRadius={55} outerRadius={90} paddingAngle={2}
                      label={(e: any) => `${e.name}: ${e.value}`} labelLine={false}>
                      {analytics.statusData.map((s, i) => <Cell key={i} fill={s.color} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>Клиенты: новые и вернувшиеся</Typography>
              {analytics.customerSegments.length === 0 ? (
                <Typography color="text.secondary" align="center" sx={{ py: 6 }}>Нет данных</Typography>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={analytics.customerSegments} dataKey="value" nameKey="name" cx="50%" cy="50%"
                        outerRadius={80} label={(e: any) => `${e.value}`} labelLine={false}>
                        {analytics.customerSegments.map((s, i) => <Cell key={i} fill={s.color} />)}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                  <Divider sx={{ my: 1 }} />
                  <Stack direction="row" justifyContent="space-around">
                    <Box textAlign="center">
                      <Typography variant="h6" fontWeight={700} color={COLORS.teal}>{analytics.loyalClients}</Typography>
                      <Typography variant="caption" color="text.secondary">постоянных (2+ заказа)</Typography>
                    </Box>
                    <Box textAlign="center">
                      <Typography variant="h6" fontWeight={700} color={COLORS.orders}>
                        {analytics.cur.uniqueClients > 0 ? `${((analytics.returningClients / analytics.cur.uniqueClients) * 100).toFixed(0)}%` : '0%'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">удержание</Typography>
                    </Box>
                  </Stack>
                </>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>Каналы: доставка и такси</Typography>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={analytics.channelData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="orders" name="Завершено" radius={[6, 6, 0, 0]}>
                    {analytics.channelData.map((c, i) => <Cell key={i} fill={c.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* ── PEAK HOURS + WEEKDAY ── */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={7}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">Загрузка по часам</Typography>
                <Chip size="small" color="primary" label={`Пик: ${analytics.peakHour.label}:00 (${analytics.peakHour.orders})`} />
              </Box>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={analytics.hourBuckets} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={1} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip formatter={(v: number, n: string) => n === 'Выручка' ? formatCost(v) : v}
                    labelFormatter={(l) => `${l}:00`} />
                  <Bar dataKey="orders" name="Заказы" fill={COLORS.orders} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={5}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">По дням недели</Typography>
                <Chip size="small" color="success" label={`Лучший: ${analytics.bestWeekday.label} (${analytics.bestWeekday.orders})`} />
              </Box>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={analytics.weekdayBuckets} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="orders" name="Заказы" fill={COLORS.net} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* ── COURIER PERFORMANCE CHART ── */}
      <Card sx={chartCardSx}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <LocalShipping fontSize="small" /> Эффективность курьеров (топ-10 по чистой выручке)
          </Typography>
          {analytics.couriers.length === 0 ? (
            <Typography color="text.secondary" align="center" sx={{ py: 6 }}>Нет данных</Typography>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(240, Math.min(analytics.couriers.length, 10) * 46)}>
              <BarChart data={analytics.couriers.slice(0, 10)} layout="vertical" margin={{ top: 0, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={formatCompact} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v: number, n: string) => n === 'Доставки' ? v : formatCost(v)} />
                <Legend />
                <Bar dataKey="net" name="Чистая выручка" fill={COLORS.net} radius={[0, 4, 4, 0]} barSize={14} />
                <Bar dataKey="commission" name="Комиссия" fill={COLORS.commission} radius={[0, 4, 4, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ── COURIER TABLE ── */}
      <Card sx={chartCardSx}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>Детализация по курьерам</Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Курьер</TableCell>
                  <TableCell align="right">Доставки</TableCell>
                  <TableCell align="right">Оборот</TableCell>
                  <TableCell align="right">Комиссия</TableCell>
                  <TableCell align="right">Чистая выручка</TableCell>
                  <TableCell align="right">Ср. чек</TableCell>
                  <TableCell align="right">Ср. время</TableCell>
                  <TableCell align="right">Пробег</TableCell>
                  <TableCell align="right">Отмены</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {analytics.couriers.map((c, i) => (
                  <TableRow key={c.id} hover>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{c.name}</TableCell>
                    <TableCell align="right">{c.orders}</TableCell>
                    <TableCell align="right">{formatCost(c.revenue)}</TableCell>
                    <TableCell align="right">
                      <Chip label={formatCost(c.commission)} color="warning" size="small" />
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, color: COLORS.revenue }}>{formatCost(c.net)}</TableCell>
                    <TableCell align="right">{c.orders > 0 ? formatCost(c.avgCheck) : '—'}</TableCell>
                    <TableCell align="right">{formatDuration(c.avgTime)}</TableCell>
                    <TableCell align="right">{(c.distance / 1000).toFixed(1)} км</TableCell>
                    <TableCell align="right">
                      {c.cancelled > 0 ? <Chip label={c.cancelled} color="error" size="small" /> : '0'}
                    </TableCell>
                  </TableRow>
                ))}
                {analytics.couriers.length === 0 && (
                  <TableRow><TableCell colSpan={10} align="center">Нет данных</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* ── TOP CLIENTS ── */}
      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <PeopleAlt fontSize="small" /> Лучшие клиенты периода
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Телефон клиента</TableCell>
                  <TableCell align="right">Заказы</TableCell>
                  <TableCell align="right">Сумма</TableCell>
                  <TableCell align="right">Ср. чек</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {analytics.topClients.map((c, i) => (
                  <TableRow key={c.phone} hover>
                    <TableCell>
                      <Avatar sx={{ width: 28, height: 28, fontSize: 13, bgcolor: i < 3 ? COLORS.revenue : 'grey.300' }}>
                        {i + 1}
                      </Avatar>
                    </TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{c.phone}</TableCell>
                    <TableCell align="right">
                      <Chip label={c.orders} size="small" color={c.orders > 1 ? 'primary' : 'default'} />
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, color: COLORS.revenue }}>{formatCost(c.spent)}</TableCell>
                    <TableCell align="right">{c.orders > 0 ? formatCost(c.spent / c.orders) : '—'}</TableCell>
                  </TableRow>
                ))}
                {analytics.topClients.length === 0 && (
                  <TableRow><TableCell colSpan={5} align="center">Нет данных</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </Box>
  );
};

export default Analytics;
