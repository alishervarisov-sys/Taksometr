import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Card, CardContent, Grid, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, ToggleButton,
  ToggleButtonGroup, TextField, Button, Stack
} from '@mui/material';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

interface StatisticsProps {
  adminId: string;
}

interface StatsData {
  totalDeliveries: number;
  totalRevenue: number;
  totalDistance: number;
  topCouriers: Array<{
    id: string;
    name: string;
    count: number;
    revenue: number;
  }>;
}

type Period = 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'custom';

const Statistics: React.FC<StatisticsProps> = ({ }) => {
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
      case 'today':
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        startDate = today.getTime();
        break;
      case 'yesterday':
        const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        startDate = yesterday.getTime();
        break;
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

      // Query deliveries directly from Firestore for reliability
      const q = query(
        collection(db, 'deliveries'),
        where('status', '==', 'COMPLETED'),
        where('createdAt', '>=', startDate),
        where('createdAt', '<=', endDate)
      );

      const snapshot = await getDocs(q);
      let totalRevenue = 0;
      let totalDistance = 0;
      const courierStats: { [key: string]: { count: number; revenue: number; name: string } } = {};

      snapshot.forEach((doc) => {
        const data = doc.data();
        totalRevenue += data.cost || 0;
        totalDistance += data.distanceMeters || 0;
        const cId = data.courierId || 'unknown';
        if (!courierStats[cId]) {
          courierStats[cId] = { count: 0, revenue: 0, name: data.courierName || 'Неизвестный' };
        }
        courierStats[cId].count++;
        courierStats[cId].revenue += data.cost || 0;
      });

      const topCouriers = Object.entries(courierStats)
        .map(([id, s]) => ({ id, ...s }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10);

      setStats({
        totalDeliveries: snapshot.size,
        totalRevenue,
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
        <Grid item xs={12} sm={4}>
          <Card>
            <CardContent sx={{ textAlign: 'center', p: 3 }}>
              <Typography variant="body2" color="text.secondary">Доставки</Typography>
              <Typography variant="h3" sx={{ fontWeight: 700, color: 'primary.main' }}>
                {loading ? '...' : stats?.totalDeliveries || 0}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card>
            <CardContent sx={{ textAlign: 'center', p: 3 }}>
              <Typography variant="body2" color="text.secondary">Общая выручка</Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, color: '#00C853' }}>
                {loading ? '...' : `${(stats?.totalRevenue || 0).toLocaleString()} сомони`}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card>
            <CardContent sx={{ textAlign: 'center', p: 3 }}>
              <Typography variant="body2" color="text.secondary">Общее расстояние</Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, color: '#2196F3' }}>
                {loading ? '...' : `${((stats?.totalDistance || 0) / 1000).toFixed(1)} км`}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Top couriers */}
      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>Топ курьеры</Typography>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Курьер</TableCell>
                  <TableCell>Доставки</TableCell>
                  <TableCell>Выручка</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {stats?.topCouriers?.map((courier, index) => (
                  <TableRow key={courier.id}>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell>{courier.name}</TableCell>
                    <TableCell>{courier.count}</TableCell>
                    <TableCell>{courier.revenue.toLocaleString()} сомони</TableCell>
                  </TableRow>
                ))}
                {(!stats?.topCouriers || stats.topCouriers.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={4} align="center">
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
