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
}

interface StatsData {
  totalDeliveries: number;
  totalRevenue: number;
  totalCommission: number;
  totalDistance: number;
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
    const endDate = now.getTime();
    let startDate: number;

    switch (period) {
      case 'today': {
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        startDate = today.getTime();
        break;
      }
      case 'yesterday': {
        const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        startDate = yesterday.getTime();
        break;
      }
      case 'week':
        startDate = endDate - 7 * 24 * 60 * 60 * 1000;
        break;
      case 'month':
        startDate = endDate - 30 * 24 * 60 * 60 * 1000;
        break;
      case 'year':
        startDate = endDate - 365 * 24 * 60 * 60 * 1000;
        break;
      case 'custom':
        startDate = customStart ? new Date(customStart).getTime() : endDate - 86400000;
        return { startDate, endDate: customEnd ? new Date(customEnd).getTime() + 86400000 : endDate };
      default:
        startDate = endDate - 86400000;
    }
    return { startDate, endDate };
  };

  const loadStats = async () => {
    setLoading(true);
    try {
      const { startDate, endDate } = getDateRange();

      const q = query(
        collection(db, 'deliveries'),
        where('status', '==', 'COMPLETED'),
        where('createdAt', '>=', startDate),
        where('createdAt', '<=', endDate)
      );

      const snapshot = await getDocs(q);
      let totalRevenue = 0;
      let totalCommission = 0;
      let totalDistance = 0;
      const courierStats: { [key: string]: CourierStat } = {};

      snapshot.forEach((doc) => {
        const data = doc.data();
        const cost = data.cost || 0;
        const commission = data.commission || 0;
        totalRevenue += cost;
        totalCommission += commission;
        totalDistance += data.distanceMeters || 0;

        const cId = data.courierId || 'unknown';
        if (!courierStats[cId]) {
          courierStats[cId] = { id: cId, count: 0, revenue: 0, commission: 0, name: data.courierName || 'Неизвестный' };
        }
        courierStats[cId].count++;
        courierStats[cId].revenue += cost;
        courierStats[cId].commission += commission;
      });

      const topCouriers = Object.values(courierStats)
        .sort((a, b) => b.commission - a.commission);

      setStats({
        totalDeliveries: snapshot.size,
        totalRevenue,
        totalCommission,
        totalDistance,
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
                {loading ? '...' : `formatCost(netRevenue)`}
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
                {loading ? '...' : `formatCost(stats?.totalCommission || 0)`}
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

      {/* Couriers table with commission */}
      <Card>
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
                        label={`${formatCost(courier.commission)}`}
                        color="warning"
                        size="small"
                      />
                    </TableCell>
                    <TableCell sx={{ fontWeight: 600, color: '#00C853' }}>
                      {formatCost(courier.revenue - courier.commission)}
                    </TableCell>
                  </TableRow>
                ))}
                {(!stats?.topCouriers || stats.topCouriers.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
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
