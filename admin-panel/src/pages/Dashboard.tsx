import React, { useEffect, useState } from 'react';
import {
  Grid, Card, CardContent, Typography, Box, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Button, Avatar,
  Chip
} from '@mui/material';
import {
  People as PeopleIcon,
  LocalShipping as DeliveryIcon,
  AttachMoney as MoneyIcon,
  PersonPin as ActiveIcon,
  EmojiEvents as TrophyIcon
} from '@mui/icons-material';
import { httpsCallable } from 'firebase/functions';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db, functions } from '../firebase';

interface DashboardProps {
  adminId: string;
}

interface Stats {
  totalCouriers: number;
  activeCouriers: number;
  totalDeliveries: number;
  totalRevenue: number;
}

interface CourierStats {
  id: string;
  name: string;
  deliveries: number;
  revenue: number;
  commission: number;
}

type LeaderboardPeriod = 'week' | 'month' | 'year' | 'all';

const Dashboard: React.FC<DashboardProps> = ({ adminId }) => {
  const [stats, setStats] = useState<Stats>({
    totalCouriers: 0,
    activeCouriers: 0,
    totalDeliveries: 0,
    totalRevenue: 0,
  });
  const [loading, setLoading] = useState(true);
  const [leaderboard, setLeaderboard] = useState<CourierStats[]>([]);
  const [leaderboardPeriod, setLeaderboardPeriod] = useState<LeaderboardPeriod>('month');
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);

  useEffect(() => {
    loadStats();
    loadLeaderboard(leaderboardPeriod);
  }, []);

  const loadStats = async () => {
    try {
      const getStatistics = httpsCallable(functions, 'getStatistics');
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const result = await getStatistics({
        adminId,
        startDate: today.getTime(),
        endDate: Date.now(),
      });

      const data = result.data as any;
      setStats({
        totalCouriers: data.totalCouriers || 0,
        activeCouriers: data.activeCouriers || 0,
        totalDeliveries: data.totalDeliveries || 0,
        totalRevenue: data.totalRevenue || 0,
      });
    } catch (err) {
      console.error('Error loading stats:', err);
    } finally {
      setLoading(false);
    }
  };

  const getDateRange = (period: LeaderboardPeriod): { start: number; end: number } => {
    const now = Date.now();
    let start = 0;
    
    switch (period) {
      case 'week':
        start = now - 7 * 86400000;
        break;
      case 'month':
        start = now - 30 * 86400000;
        break;
      case 'year':
        start = now - 365 * 86400000;
        break;
      case 'all':
        start = 0;
        break;
    }
    
    return { start, end: now };
  };

  const loadLeaderboard = async (period: LeaderboardPeriod) => {
    setLoadingLeaderboard(true);
    try {
      const { start, end } = getDateRange(period);
      
      // Load all couriers
      const couriersQuery = query(collection(db, 'users'), where('role', '==', 'COURIER'));
      const couriersSnapshot = await getDocs(couriersQuery);
      const couriers = couriersSnapshot.docs.map(d => ({
        id: d.id,
        name: d.data().name || '',
        surname: d.data().surname || '',
      }));
      
      // Load all completed deliveries
      const deliveriesQuery = query(
        collection(db, 'deliveries'),
        where('status', '==', 'COMPLETED')
      );
      const deliveriesSnapshot = await getDocs(deliveriesQuery);
      const deliveries = deliveriesSnapshot.docs.map(d => ({
        courierId: d.data().courierId,
        cost: d.data().cost || 0,
        commission: d.data().commission || 0,
        createdAt: d.data().createdAt || 0,
      }));
      
      // Filter by period and calculate stats
      const courierStats: { [key: string]: CourierStats } = {};
      
      couriers.forEach(courier => {
        courierStats[courier.id] = {
          id: courier.id,
          name: `${courier.name} ${courier.surname}`.trim(),
          deliveries: 0,
          revenue: 0,
          commission: 0,
        };
      });
      
      deliveries.forEach(delivery => {
        if (delivery.createdAt >= start && delivery.createdAt <= end) {
          const courierId = delivery.courierId;
          if (courierStats[courierId]) {
            courierStats[courierId].deliveries++;
            courierStats[courierId].revenue += delivery.cost;
            courierStats[courierId].commission += delivery.commission;
          }
        }
      });
      
      // Convert to array and sort by deliveries count
      const sortedStats = Object.values(courierStats)
        .filter(c => c.deliveries > 0)
        .sort((a, b) => b.deliveries - a.deliveries);
      
      setLeaderboard(sortedStats);
    } catch (err) {
      console.error('Error loading leaderboard:', err);
    } finally {
      setLoadingLeaderboard(false);
    }
  };

  const handlePeriodChange = (period: LeaderboardPeriod) => {
    setLeaderboardPeriod(period);
    loadLeaderboard(period);
  };

  const getMedalColor = (place: number): string => {
    if (place === 1) return '#FFD700'; // Gold
    if (place === 2) return '#C0C0C0'; // Silver
    if (place === 3) return '#CD7F32'; // Bronze
    return 'transparent';
  };

  const getMedalEmoji = (place: number): string => {
    if (place === 1) return '🥇';
    if (place === 2) return '🥈';
    if (place === 3) return '🥉';
    return `${place}`;
  };

  const statCards = [
    {
      title: 'Всего курьеров',
      value: stats.totalCouriers,
      icon: <PeopleIcon sx={{ fontSize: 40 }} />,
      color: '#1B5E20',
    },
    {
      title: 'Активные курьеры',
      value: stats.activeCouriers,
      icon: <ActiveIcon sx={{ fontSize: 40 }} />,
      color: '#2196F3',
    },
    {
      title: 'Доставки сегодня',
      value: stats.totalDeliveries,
      icon: <DeliveryIcon sx={{ fontSize: 40 }} />,
      color: '#FF6D00',
    },
    {
      title: 'Выручка сегодня',
      value: `${stats.totalRevenue.toLocaleString()} сомони`,
      icon: <MoneyIcon sx={{ fontSize: 40 }} />,
      color: '#00C853',
    },
  ];

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 3 }}>
        Dashboard
      </Typography>

      <Grid container spacing={3}>
        {statCards.map((card, index) => (
          <Grid item xs={12} sm={6} md={3} key={index}>
            <Card>
              <CardContent sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      {card.title}
                    </Typography>
                    <Typography variant="h4" sx={{ fontWeight: 700, mt: 1 }}>
                      {loading ? '...' : card.value}
                    </Typography>
                  </Box>
                  <Box sx={{ color: card.color, opacity: 0.8 }}>
                    {card.icon}
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Leaderboard */}
      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <TrophyIcon sx={{ fontSize: 30, color: '#FFD700' }} />
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Турнирная таблица курьеров
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant={leaderboardPeriod === 'week' ? 'contained' : 'outlined'}
                size="small"
                onClick={() => handlePeriodChange('week')}
              >
                Неделя
              </Button>
              <Button
                variant={leaderboardPeriod === 'month' ? 'contained' : 'outlined'}
                size="small"
                onClick={() => handlePeriodChange('month')}
              >
                Месяц
              </Button>
              <Button
                variant={leaderboardPeriod === 'year' ? 'contained' : 'outlined'}
                size="small"
                onClick={() => handlePeriodChange('year')}
              >
                Год
              </Button>
              <Button
                variant={leaderboardPeriod === 'all' ? 'contained' : 'outlined'}
                size="small"
                onClick={() => handlePeriodChange('all')}
              >
                Всё время
              </Button>
            </Box>
          </Box>

          {loadingLeaderboard ? (
            <Typography align="center" color="text.secondary" sx={{ py: 4 }}>
              Загрузка...
            </Typography>
          ) : leaderboard.length === 0 ? (
            <Typography align="center" color="text.secondary" sx={{ py: 4 }}>
              Нет данных за выбранный период
            </Typography>
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 80 }}>Место</TableCell>
                    <TableCell>Курьер</TableCell>
                    <TableCell align="center">Доставок</TableCell>
                    <TableCell align="right">Выручка</TableCell>
                    <TableCell align="right">Комиссия</TableCell>
                    <TableCell align="right">Чистый заработок</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {leaderboard.map((courier, index) => {
                    const place = index + 1;
                    const netEarnings = courier.revenue - courier.commission;
                    return (
                      <TableRow
                        key={courier.id}
                        hover
                        sx={{
                          bgcolor: place <= 3 ? `${getMedalColor(place)}10` : 'transparent',
                        }}
                      >
                        <TableCell>
                          <Avatar
                            sx={{
                              width: 40,
                              height: 40,
                              bgcolor: getMedalColor(place),
                              color: place <= 3 ? '#000' : '#fff',
                              fontWeight: 700,
                              fontSize: 20,
                            }}
                          >
                            {getMedalEmoji(place)}
                          </Avatar>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body1" sx={{ fontWeight: place <= 3 ? 700 : 400 }}>
                            {courier.name}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Chip
                            label={courier.deliveries}
                            color="primary"
                            size="small"
                            sx={{ fontWeight: 700, minWidth: 50 }}
                          />
                        </TableCell>
                        <TableCell align="right">
                          <Typography sx={{ color: 'success.main', fontWeight: 600 }}>
                            {courier.revenue.toLocaleString()} с
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography sx={{ color: 'warning.main', fontWeight: 600 }}>
                            {courier.commission.toLocaleString()} с
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography sx={{ color: 'info.main', fontWeight: 700 }}>
                            {netEarnings.toLocaleString()} с
                          </Typography>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

export default Dashboard;
