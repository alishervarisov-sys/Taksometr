import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Card, CardContent, Grid, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, ToggleButton,
  ToggleButtonGroup, TextField, Button, Stack, Chip
} from '@mui/material';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

interface StatisticsProps {
  adminId: string;
}

interface CourierStat {
  id: string;
  name: string;
  count: number;
  revenue: number;
  commission: number;
  distance: number;
  cancelled: number;
  deliveryTimeSum: number; // сумма длительностей доставок (мс)
  timedCount: number;      // кол-во доставок с валидным временем
}

interface StatsData {
  totalDeliveries: number;
  totalRevenue: number;
  totalCommission: number;
  totalDistance: number;
  totalCancelled: number;
  avgDeliveryTime: number;  // средняя длительность доставки (мс)
  avgCheck: number;         // средний чек (сомони)
  repeatCustomers: number;  // клиенты с более чем одним заказом
  repeatOrders: number;     // повторные заказы (заказы сверх первого)
  topCouriers: CourierStat[];
}

type Period = 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'custom';

const Statistics: React.FC<StatisticsProps> = () => {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  useEffect(() => {
    if (period !== 'custom') {
      loadStats();
    }
  }, [period]);

  const getDateRange = (): { startDate: number; endDate: number } => {
    const now = new Date();
    let startDate: number;
    let endDate: number;

    switch (period) {
      case 'today': {
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        startDate = today.getTime();
        endDate = now.getTime();
        break;
      }
      case 'yesterday': {
        const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        startDate = yesterday.getTime();
        endDate = todayStart.getTime() - 1; // конец вчерашнего дня (23:59:59.999)
        break;
      }
      case 'week': {
        const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
        startDate = weekAgo.getTime();
        endDate = now.getTime();
        break;
      }
      case 'month': {
        const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        startDate = monthAgo.getTime();
        endDate = now.getTime();
        break;
      }
      case 'year': {
        const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        startDate = yearAgo.getTime();
        endDate = now.getTime();
        break;
      }
      case 'custom': {
        if (customStart && customEnd) {
          const customStartDate = new Date(customStart);
          const customEndDate = new Date(customEnd);
          startDate = new Date(customStartDate.getFullYear(), customStartDate.getMonth(), customStartDate.getDate()).getTime();
          endDate = new Date(customEndDate.getFullYear(), customEndDate.getMonth(), customEndDate.getDate(), 23, 59, 59, 999).getTime();
        } else {
          endDate = now.getTime();
          startDate = endDate - 86400000;
        }
        return { startDate, endDate };
      }
      default:
        endDate = now.getTime();
        startDate = endDate - 86400000;
    }
    return { startDate, endDate };
  };

  const loadStats = async () => {
    setLoading(true);
    try {
      const { startDate, endDate } = getDateRange();

      // Загружаем все доставки за период (без фильтра по статусу),
      // чтобы посчитать отмены и повторные заказы.
      const q = query(
        collection(db, 'deliveries'),
        where('createdAt', '>=', startDate),
        where('createdAt', '<=', endDate)
      );

      const snapshot = await getDocs(q);
      let totalRevenue = 0;
      let totalCommission = 0;
      let totalDistance = 0;
      let totalCancelled = 0;
      let completedCount = 0;
      let deliveryTimeSum = 0;
      let timedCount = 0;
      const courierStats: { [key: string]: CourierStat } = {};
      const clientOrderCounts: { [phone: string]: number } = {};

      const ensureCourier = (cId: string, name: string): CourierStat => {
        if (!courierStats[cId]) {
          courierStats[cId] = {
            id: cId, name: name || 'Неизвестный',
            count: 0, revenue: 0, commission: 0, distance: 0,
            cancelled: 0, deliveryTimeSum: 0, timedCount: 0,
          };
        }
        return courierStats[cId];
      };

      snapshot.forEach((doc) => {
        const data = doc.data();
        const status = data.status;
        const cId = data.courierId || 'unknown';
        const courier = ensureCourier(cId, data.courierName);

        if (status === 'CANCELLED') {
          totalCancelled++;
          courier.cancelled++;
          return;
        }

        if (status !== 'COMPLETED') return;

        const cost = data.cost || 0;
        const commission = data.commission || 0;
        const distance = data.distanceMeters || 0;

        completedCount++;
        totalRevenue += cost;
        totalCommission += commission;
        totalDistance += distance;

        courier.count++;
        courier.revenue += cost;
        courier.commission += commission;
        courier.distance += distance;

        // Длительность доставки
        if (data.startTime && data.endTime && data.endTime > data.startTime) {
          const dur = data.endTime - data.startTime;
          deliveryTimeSum += dur;
          timedCount++;
          courier.deliveryTimeSum += dur;
          courier.timedCount++;
        }

        // Повторные заказы клиентов
        const phone = data.clientPhone;
        if (phone) {
          clientOrderCounts[phone] = (clientOrderCounts[phone] || 0) + 1;
        }
      });

      // Клиенты с более чем одним заказом и кол-во повторных заказов
      let repeatCustomers = 0;
      let repeatOrders = 0;
      Object.values(clientOrderCounts).forEach((cnt) => {
        if (cnt > 1) {
          repeatCustomers++;
          repeatOrders += cnt - 1;
        }
      });

      const topCouriers = Object.values(courierStats)
        .filter((c) => c.count > 0 || c.cancelled > 0)
        .sort((a, b) => b.commission - a.commission);

      setStats({
        totalDeliveries: completedCount,
        totalRevenue,
        totalCommission,
        totalDistance,
        totalCancelled,
        avgDeliveryTime: timedCount > 0 ? deliveryTimeSum / timedCount : 0,
        avgCheck: completedCount > 0 ? totalRevenue / completedCount : 0,
        repeatCustomers,
        repeatOrders,
        topCouriers,
      });
    } catch (err) {
      console.error('Error loading statistics:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCustomSearch = () => {
    if (customStart && customEnd) {
      loadStats();
    }
  };

  const periodLabels: Record<Period, string> = {
    today: 'Сегодня',
    yesterday: 'Вчера',
    week: 'Неделя',
    month: 'Месяц',
    year: 'Год',
    custom: 'Период',
  };

  const netRevenue = (stats?.totalRevenue || 0) - (stats?.totalCommission || 0);

  const formatCost = (cost: number) => {
    const somoni = Math.floor(cost);
    const diram = Math.round((cost - somoni) * 100);
    if (diram > 0) return `${somoni.toLocaleString()}.${String(diram).padStart(2, '0')} сомони`;
    return `${somoni.toLocaleString()} сомони`;
  };

  const formatDuration = (ms: number) => {
    if (!ms || ms <= 0) return '—';
    const totalMinutes = Math.round(ms / 60000);
    if (totalMinutes < 60) return `${totalMinutes} мин`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes > 0 ? `${hours} ч ${minutes} мин` : `${hours} ч`;
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 3 }}>
        Статистика
      </Typography>

      {/* Period selector */}
      <Box sx={{ mb: 3 }}>
        <ToggleButtonGroup
          value={period}
          exclusive
          onChange={(_, val) => val && setPeriod(val)}
          size="small"
          sx={{ mb: 2 }}
        >
          {Object.entries(periodLabels).map(([key, label]) => (
            <ToggleButton key={key} value={key}>{label}</ToggleButton>
          ))}
        </ToggleButtonGroup>

        {period === 'custom' && (
          <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 1 }}>
            <TextField
              type="date"
              label="От"
              size="small"
              InputLabelProps={{ shrink: true }}
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
            />
            <TextField
              type="date"
              label="До"
              size="small"
              InputLabelProps={{ shrink: true }}
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
            />
            <Button variant="contained" size="small" onClick={handleCustomSearch}>
              Показать
            </Button>
          </Stack>
        )}
      </Box>

      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={3}>
          <Card>
            <CardContent sx={{ textAlign: 'center', p: 3 }}>
              <Typography variant="body2" color="text.secondary">Доставки</Typography>
              <Typography variant="h3" sx={{ fontWeight: 700, color: 'primary.main' }}>
                {loading ? '...' : stats?.totalDeliveries || 0}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={3}>
          <Card>
            <CardContent sx={{ textAlign: 'center', p: 3 }}>
              <Typography variant="body2" color="text.secondary">Чистая выручка</Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, color: '#00C853' }}>
                {loading ? '...' : formatCost(netRevenue)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                (без комиссии)
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={3}>
          <Card>
            <CardContent sx={{ textAlign: 'center', p: 3 }}>
              <Typography variant="body2" color="text.secondary">Комиссия</Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, color: '#FF6D00' }}>
                {loading ? '...' : formatCost(stats?.totalCommission || 0)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={3}>
          <Card>
            <CardContent sx={{ textAlign: 'center', p: 3 }}>
              <Typography variant="body2" color="text.secondary">Расстояние</Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, color: '#2196F3' }}>
                {loading ? '...' : `${((stats?.totalDistance || 0) / 1000).toFixed(1)} км`}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Дополнительные метрики */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent sx={{ textAlign: 'center', p: 3 }}>
              <Typography variant="body2" color="text.secondary">Ср. время доставки</Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, color: '#7B1FA2' }}>
                {loading ? '...' : formatDuration(stats?.avgDeliveryTime || 0)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent sx={{ textAlign: 'center', p: 3 }}>
              <Typography variant="body2" color="text.secondary">Средний чек</Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, color: '#00897B' }}>
                {loading ? '...' : formatCost(stats?.avgCheck || 0)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent sx={{ textAlign: 'center', p: 3 }}>
              <Typography variant="body2" color="text.secondary">Отменённые заказы</Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, color: '#D32F2F' }}>
                {loading ? '...' : stats?.totalCancelled || 0}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent sx={{ textAlign: 'center', p: 3 }}>
              <Typography variant="body2" color="text.secondary">Повторные заказы</Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, color: '#F9A825' }}>
                {loading ? '...' : stats?.repeatOrders || 0}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {loading ? '' : `${stats?.repeatCustomers || 0} пост. клиентов`}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Couriers table with commission */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>Курьеры за период</Typography>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Курьер</TableCell>
                  <TableCell>Доставки</TableCell>
                  <TableCell>Оборот</TableCell>
                  <TableCell>Комиссия</TableCell>
                  <TableCell>Чистая выручка</TableCell>
                  <TableCell>Ср. чек</TableCell>
                  <TableCell>Ср. время</TableCell>
                  <TableCell>Отмены</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {stats?.topCouriers?.map((courier, index) => (
                  <TableRow key={courier.id}>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{courier.name}</TableCell>
                    <TableCell>{courier.count}</TableCell>
                    <TableCell>{formatCost(courier.revenue)}</TableCell>
                    <TableCell>
                      <Chip
                        label={formatCost(courier.commission)}
                        color="warning"
                        size="small"
                      />
                    </TableCell>
                    <TableCell sx={{ fontWeight: 600, color: '#00C853' }}>
                      {formatCost(courier.revenue - courier.commission)}
                    </TableCell>
                    <TableCell>
                      {courier.count > 0 ? formatCost(courier.revenue / courier.count) : '—'}
                    </TableCell>
                    <TableCell>
                      {formatDuration(courier.timedCount > 0 ? courier.deliveryTimeSum / courier.timedCount : 0)}
                    </TableCell>
                    <TableCell>
                      {courier.cancelled > 0
                        ? <Chip label={courier.cancelled} color="error" size="small" />
                        : <Typography variant="body2" color="text.secondary">0</Typography>}
                    </TableCell>
                  </TableRow>
                ))}
                {(!stats?.topCouriers || stats.topCouriers.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={9} align="center">
                      Нет данных
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Couriers distance table */}
      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>Пробег курьеров за период</Typography>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Курьер</TableCell>
                  <TableCell>Доставки</TableCell>
                  <TableCell>Общий пробег</TableCell>
                  <TableCell>Ср. пробег / доставку</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {stats?.topCouriers
                  ?.slice()
                  .sort((a, b) => b.distance - a.distance)
                  .map((courier, index) => (
                    <TableRow key={courier.id}>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{courier.name}</TableCell>
                      <TableCell>{courier.count}</TableCell>
                      <TableCell sx={{ fontWeight: 600, color: '#2196F3' }}>
                        {(courier.distance / 1000).toFixed(2)} км
                      </TableCell>
                      <TableCell>
                        {courier.count > 0 ? `${(courier.distance / 1000 / courier.count).toFixed(2)} км` : '—'}
                      </TableCell>
                    </TableRow>
                  ))
                }
                {(!stats?.topCouriers || stats.topCouriers.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={5} align="center">
                      Нет данных
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </Box>
  );
};

export default Statistics;
