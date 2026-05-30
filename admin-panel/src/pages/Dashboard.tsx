import React, { useEffect, useState } from 'react';
import { Grid, Card, CardContent, Typography, Box } from '@mui/material';
import {
  People as PeopleIcon,
  LocalShipping as DeliveryIcon,
  AttachMoney as MoneyIcon,
  PersonPin as ActiveIcon
} from '@mui/icons-material';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

interface DashboardProps {
  adminId: string;
}

interface Stats {
  totalCouriers: number;
  activeCouriers: number;
  totalDeliveries: number;
  totalRevenue: number;
}

const Dashboard: React.FC<DashboardProps> = ({ adminId }) => {
  const [stats, setStats] = useState<Stats>({
    totalCouriers: 0,
    activeCouriers: 0,
    totalDeliveries: 0,
    totalRevenue: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
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
    </Box>
  );
};

export default Dashboard;
