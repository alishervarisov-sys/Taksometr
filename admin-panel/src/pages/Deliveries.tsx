import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Card, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, TextField, InputAdornment
} from '@mui/material';
import { Search } from '@mui/icons-material';
import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase';

interface Delivery {
  id: string;
  courierName: string;
  clientPhone: string;
  status: string;
  distanceMeters: number;
  cost: number;
  createdAt: number;
}

const Deliveries: React.FC = () => {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadDeliveries();
  }, []);

  const loadDeliveries = async () => {
    const q = query(
      collection(db, 'deliveries'),
      orderBy('createdAt', 'desc'),
      limit(100)
    );
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Delivery[];
    setDeliveries(data);
  };

  const filteredDeliveries = deliveries.filter(d =>
    d.clientPhone?.includes(searchQuery) ||
    d.courierName?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getStatusChip = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return <Chip label="Завершена" color="success" size="small" />;
      case 'IN_PROGRESS':
        return <Chip label="В процессе" color="info" size="small" />;
      case 'CANCELLED':
        return <Chip label="Отменена" color="error" size="small" />;
      default:
        return <Chip label={status} size="small" />;
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('ru-RU');
  };

  const formatDistance = (meters: number) => {
    if (meters < 1000) return `${Math.round(meters)} м`;
    return `${(meters / 1000).toFixed(1)} км`;
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 3 }}>Доставки</Typography>

      <TextField
        fullWidth
        placeholder="Поиск по номеру телефона или имени курьера"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        sx={{ mb: 3 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <Search />
            </InputAdornment>
          ),
        }}
      />

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Дата</TableCell>
                <TableCell>Курьер</TableCell>
                <TableCell>Клиент</TableCell>
                <TableCell>Расстояние</TableCell>
                <TableCell>Стоимость</TableCell>
                <TableCell>Статус</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredDeliveries.map((delivery) => (
                <TableRow key={delivery.id}>
                  <TableCell>{formatDate(delivery.createdAt)}</TableCell>
                  <TableCell>{delivery.courierName}</TableCell>
                  <TableCell>{delivery.clientPhone}</TableCell>
                  <TableCell>{formatDistance(delivery.distanceMeters)}</TableCell>
                  <TableCell>{delivery.cost?.toLocaleString()} сомони</TableCell>
                  <TableCell>{getStatusChip(delivery.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </Box>
  );
};

export default Deliveries;
