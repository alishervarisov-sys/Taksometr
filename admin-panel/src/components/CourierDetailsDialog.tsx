import React, { useEffect, useState } from 'react';
import {
  Alert, Avatar, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Grid, Link, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';

export interface CourierProfile {
  id: string;
  name: string;
  surname: string;
  login: string;
  phone: string;
  city: string;
  birthYear: string;
  createdAt: number;
  balance: number;
  isOnline: boolean;
  isBlocked: boolean;
  isOnShift?: boolean;
  balanceTransferEnabled?: boolean;
  photoBase64?: string;
  scooterPhotoUrl?: string;
  passportFrontUrl?: string;
  passportBackUrl?: string;
  rating?: number;
  ratingCount?: number;
  pendingTopUpAmount?: number;
  pendingTopUpRequestId?: string;
}

interface CourierOrder {
  id: string;
  status: string;
  createdAt: number;
  clientPhone?: string;
  cost?: number;
  commission?: number;
  distanceMeters?: number;
}

const statusLabels: Record<string, string> = {
  PENDING: 'Ожидает', IN_PROGRESS: 'В процессе',
  COMPLETED: 'Выполнен', CANCELLED: 'Отменён',
};

const money = (value: number) => `${value.toLocaleString('ru-RU', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})} сомони`;
const date = (value: number) => value ? new Date(value).toLocaleString('ru-RU') : '—';

interface Props {
  courier: CourierProfile;
  onClose: () => void;
  onHistory: (courier: CourierProfile) => void;
}

const CourierDetailsDialog: React.FC<Props> = ({ courier, onClose, onHistory }) => {
  const [profile, setProfile] = useState(courier);
  const [orders, setOrders] = useState<CourierOrder[]>([]);
  const [profileLoading, setProfileLoading] = useState(true);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [ordersError, setOrdersError] = useState('');
  const [deleted, setDeleted] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setProfileLoading(true);
    setOrdersLoading(true);
    setProfileError('');
    setOrdersError('');
    setDeleted(false);
    const stopProfile = onSnapshot(doc(db, 'users', courier.id), snapshot => {
      setDeleted(!snapshot.exists());
      if (snapshot.exists()) {
        setProfile({ ...snapshot.data(), id: snapshot.id } as CourierProfile);
      }
      setProfileLoading(false);
    }, () => {
      setProfileError('Не удалось обновить данные курьера. Показаны данные из списка.');
      setProfileLoading(false);
    });
    // Read every status so the lifetime order count includes cancellations and
    // active assignments. Income is calculated only from completed deliveries.
    const stopOrders = onSnapshot(query(collection(db, 'deliveries'),
      where('courierId', '==', courier.id)), snapshot => {
      setOrders(snapshot.docs.map(item => ({ ...item.data(), id: item.id } as CourierOrder))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
      setOrdersLoading(false);
    }, () => {
      setOrdersError('Не удалось загрузить заказы и статистику курьера.');
      setOrdersLoading(false);
    });
    return () => { stopProfile(); stopOrders(); };
  }, [courier.id, retry]);

  const completed = orders.filter(order => order.status === 'COMPLETED');
  const revenue = completed.reduce((sum, order) => sum + (order.cost || 0), 0);
  const commission = completed.reduce((sum, order) => sum + (order.commission || 0), 0);
  const distance = completed.reduce((sum, order) => sum + (order.distanceMeters || 0), 0);
  const otherOrders = orders.filter(order => !statusLabels[order.status]).length;
  const fields = [
    ['Имя', profile.name], ['Фамилия', profile.surname],
    ['Логин', profile.login], ['Телефон', profile.phone],
    ['Город / район', profile.city], ['Год рождения', profile.birthYear],
    ['Дата регистрации', date(profile.createdAt)], ['ID курьера', profile.id],
    ['Смена', profile.isOnShift === false ? 'Не на смене' : 'На смене'],
    ['Переводы баланса', profile.balanceTransferEnabled === false ? 'Запрещены' : 'Разрешены'],
    ['Рейтинг', profile.ratingCount
      ? `${(profile.rating || 0).toFixed(1)} из 5 (${profile.ratingCount} оценок)` : 'Нет оценок'],
    ['Заявка на пополнение', profile.pendingTopUpRequestId
      ? money(profile.pendingTopUpAmount || 0) : 'Нет ожидающей заявки'],
  ];
  const photos = [
    ['Фото скутера', profile.scooterPhotoUrl],
    ['Паспорт — лицевая сторона', profile.passportFrontUrl],
    ['Паспорт — обратная сторона', profile.passportBackUrl],
  ];
  const stats = [
    ['Всего заказов', orders.length], ['Выполнено', completed.length],
    ['В процессе', orders.filter(order => order.status === 'IN_PROGRESS').length],
    ['Ожидают', orders.filter(order => order.status === 'PENDING').length],
    ['Отменено', orders.filter(order => order.status === 'CANCELLED').length],
    ...(otherOrders ? [['Другие статусы', otherOrders]] : []),
    ['Стоимость доставок', money(revenue)], ['Комиссия', money(commission)],
    ['Чистый заработок', money(revenue - commission)],
    ['Пройдено на доставках', `${(distance / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} км`],
  ];

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth aria-labelledby="courier-details-title">
      <DialogTitle id="courier-details-title">Карточка курьера</DialogTitle>
      <DialogContent dividers>
        {deleted ? <Alert severity="warning">Курьер удалён.</Alert> : <>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 3 }}>
            <Avatar
              src={profile.photoBase64 ? `data:image/jpeg;base64,${profile.photoBase64}` : undefined}
              alt={`${profile.name} ${profile.surname || ''}`} sx={{ width: 64, height: 64 }}
            >{profile.name?.[0]}</Avatar>
            <Box>
              <Typography variant="h6">{profile.name} {profile.surname}</Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                <Chip size="small" label={profile.isOnline ? 'Онлайн' : 'Оффлайн'}
                  color={profile.isOnline ? 'success' : 'default'} />
                {profile.isBlocked && <Chip size="small" label="Заблокирован" color="error" />}
                <Chip size="small" label={`Баланс: ${money(profile.balance || 0)}`} color="primary" />
              </Box>
            </Box>
          </Box>
          {profileLoading && <Typography color="text.secondary" sx={{ mb: 2 }}>Обновление данных…</Typography>}
          {profileError && <Alert severity="warning" sx={{ mb: 2 }}>{profileError}</Alert>}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            {fields.map(([label, value]) => <Grid item xs={12} sm={6} key={label}>
              <Typography variant="body2" color="text.secondary">{label}</Typography>
              <Typography sx={{ overflowWrap: 'anywhere', fontWeight: 500 }}>{value || '—'}</Typography>
            </Grid>)}
          </Grid>
          <Typography variant="h6" sx={{ mb: 2 }}>Статистика за всё время</Typography>
          {ordersLoading ? <Box role="status" sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2 }}>
            <CircularProgress size={24} /><Typography>Загрузка заказов…</Typography>
          </Box> : ordersError ? <Alert severity="error" sx={{ mb: 2 }}>{ordersError}</Alert> : <>
            <Grid container spacing={2} sx={{ mb: 2 }}>
              {stats.map(([label, value]) => <Grid item xs={6} sm={4} key={label}>
                <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'background.default', height: '100%' }}>
                  <Typography variant="body2" color="text.secondary">{label}</Typography>
                  <Typography sx={{ fontWeight: 700, mt: 0.5 }}>{value}</Typography>
                </Box>
              </Grid>)}
            </Grid>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Всего — заказы, назначенные этому курьеру. Заработок, комиссия и расстояние — по выполненным доставкам.
            </Typography>
            <Typography variant="h6" sx={{ mb: 1 }}>Последние заказы</Typography>
            {orders.length === 0 ? <Alert severity="info" sx={{ mb: 3 }}>У курьера пока нет заказов.</Alert> :
              <TableContainer sx={{ mb: 3 }}>
                <Table size="small" aria-label="Последние заказы курьера">
                  <TableHead><TableRow>
                    <TableCell>Дата</TableCell><TableCell>Клиент</TableCell>
                    <TableCell>Статус</TableCell><TableCell>Стоимость</TableCell>
                  </TableRow></TableHead>
                  <TableBody>{orders.slice(0, 10).map(order => <TableRow key={order.id}>
                    <TableCell>{date(order.createdAt)}</TableCell>
                    <TableCell>{order.clientPhone || '—'}</TableCell>
                    <TableCell>{statusLabels[order.status] || order.status || '—'}</TableCell>
                    <TableCell>{money(order.cost || 0)}</TableCell>
                  </TableRow>)}</TableBody>
                </Table>
              </TableContainer>}
          </>}
          {(profileError || ordersError) && <Button onClick={() => setRetry(value => value + 1)} sx={{ mb: 2 }}>
            Повторить загрузку
          </Button>}
          <Typography variant="h6" sx={{ mb: 2 }}>Фотографии и документы</Typography>
          <Grid container spacing={2}>
            {photos.map(([label, url]) => <Grid item xs={12} sm={4} key={label}>
              <Typography variant="body2" sx={{ mb: 1 }}>{label}</Typography>
              {url ? <Link href={url} target="_blank" rel="noopener noreferrer" aria-label={`Открыть: ${label}`}>
                <Box component="img" src={url} alt={label} loading="lazy"
                  sx={{ width: '100%', height: 160, objectFit: 'contain', borderRadius: 1, bgcolor: 'background.default' }} />
                <Typography variant="body2">Открыть фото</Typography>
              </Link> : <Typography variant="body2" color="text.secondary">Не загружено</Typography>}
            </Grid>)}
          </Grid>
        </>}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap' }}>
        <Button onClick={onClose}>Закрыть</Button>
        <Button variant="contained" disabled={deleted} onClick={() => onHistory(profile)}>
          История выполненных доставок
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CourierDetailsDialog;
