import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Card, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Button, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, IconButton, Chip, Alert, MenuItem,
  Grid, InputLabel, CardContent
} from '@mui/material';
import { Add, Block, Delete, History, PersonAdd, Edit } from '@mui/icons-material';
import { collection, getDocs, doc, updateDoc, deleteDoc, query, where, orderBy } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { db, functions, storage } from '../firebase';

interface CouriersProps {
  adminId: string;
}

interface Courier {
  id: string;
  login: string;
  name: string;
  surname: string;
  phone: string;
  city: string;
  birthYear: string;
  isOnline: boolean;
  isBlocked: boolean;
  balance: number;
  createdAt: number;
}

interface Transaction {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string;
  createdAt: number;
}

interface Delivery {
  id: string;
  courierId: string;
  clientPhone: string;
  cost: number;
  commission: number;
  distanceMeters: number;
  createdAt: number;
  status: string;
}

// Cities and districts of Tajikistan. Keep the administrative type in the
// stored value so a city and a district can never become ambiguous later.
const TAJIKISTAN_CITIES = [
  // Dushanbe
  'Душанбе (город)',
  'Исмоили Сомони (район Душанбе)',
  'Сино (район Душанбе)',
  'Фирдавси (район Душанбе)',
  'Шохмансур (район Душанбе)',

  // Gorno-Badakhshan Autonomous Region
  'Хорог (город, ГБАО)',
  'Ванч (район, ГБАО)',
  'Дарвоз (район, ГБАО)',
  'Ишкашим (район, ГБАО)',
  'Мургаб (район, ГБАО)',
  'Рошткала (район, ГБАО)',
  'Рушан (район, ГБАО)',
  'Шугнан (район, ГБАО)',

  // Sughd Region
  'Худжанд (город, Согдийская область)',
  'Бустон (город, Согдийская область)',
  'Гулистон (город, Согдийская область)',
  'Истаравшан (город, Согдийская область)',
  'Истиклол (город, Согдийская область)',
  'Исфара (город, Согдийская область)',
  'Канибадам (город, Согдийская область)',
  'Пенджикент (город, Согдийская область)',
  'Айни (район, Согдийская область)',
  'Ашт (район, Согдийская область)',
  'Бободжон Гафуров (район, Согдийская область)',
  'Деваштич (район, Согдийская область)',
  'Джаббор Расулов (район, Согдийская область)',
  'Зафарабад (район, Согдийская область)',
  'Кухистони Мастчох (район, Согдийская область)',
  'Мастчох (район, Согдийская область)',
  'Спитамен (район, Согдийская область)',
  'Шахристан (район, Согдийская область)',

  // Khatlon Region
  'Бохтар (город, Хатлонская область)',
  'Куляб (город, Хатлонская область)',
  'Левакант (город, Хатлонская область)',
  'Нурек (город, Хатлонская область)',
  'Абдурахмони Джоми (район, Хатлонская область)',
  'Бальджуван (район, Хатлонская область)',
  'Вахш (район, Хатлонская область)',
  'Восе (район, Хатлонская область)',
  'Дангара (район, Хатлонская область)',
  'Дусти (район, Хатлонская область)',
  'Джайхун (район, Хатлонская область)',
  'Джалолиддини Балхи (район, Хатлонская область)',
  'Кубодиён (район, Хатлонская область)',
  'Кушониён (район, Хатлонская область)',
  'Мир Сайид Али Хамадони (район, Хатлонская область)',
  'Муминабад (район, Хатлонская область)',
  'Носири Хусрав (район, Хатлонская область)',
  'Пяндж (район, Хатлонская область)',
  'Темурмалик (район, Хатлонская область)',
  'Фархор (район, Хатлонская область)',
  'Ховалинг (район, Хатлонская область)',
  'Хуросон (район, Хатлонская область)',
  'Шамсиддин Шохин (район, Хатлонская область)',
  'Шахритус (район, Хатлонская область)',
  'Яван (район, Хатлонская область)',

  // Districts under republican subordination
  'Вахдат (город, РРП)',
  'Гиссар (город, РРП)',
  'Рогун (город, РРП)',
  'Турсунзаде (город, РРП)',
  'Варзоб (район, РРП)',
  'Лахш (район, РРП)',
  'Нурабад (район, РРП)',
  'Рашт (район, РРП)',
  'Рудаки (район, РРП)',
  'Сангвор (район, РРП)',
  'Таджикабад (район, РРП)',
  'Файзабад (район, РРП)',
  'Шахринав (район, РРП)',
];

const Couriers: React.FC<CouriersProps> = ({ adminId }) => {
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [openDialog, setOpenDialog] = useState(false);
  const [newCourier, setNewCourier] = useState({
    name: '', surname: '', birthYear: '', city: '', phone: '', login: '', password: ''
  });
  const [scooterPhoto, setScooterPhoto] = useState<File | null>(null);
  const [passportFront, setPassportFront] = useState<File | null>(null);
  const [passportBack, setPassportBack] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // History dialog
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyCourier, setHistoryCourier] = useState<Courier | null>(null);
  const [historyPeriod, setHistoryPeriod] = useState<'today' | 'yesterday' | 'week' | 'month' | 'year' | 'all'>('all');
  const [historyStats, setHistoryStats] = useState<{
    deliveries: Delivery[];
    totalDeliveries: number;
    totalEarnings: number;
    totalCommission: number;
    netEarnings: number;
  } | null>(null);

  // Assign to client dialog
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignCourier, setAssignCourier] = useState<Courier | null>(null);
  const [clientPhone, setClientPhone] = useState('');
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignError, setAssignError] = useState('');

  // Edit courier dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editingCourier, setEditingCourier] = useState<Courier | null>(null);
  const [editData, setEditData] = useState({
    name: '', surname: '', birthYear: '', city: '', phone: ''
  });
  const [editScooterPhoto, setEditScooterPhoto] = useState<File | null>(null);
  const [editPassportFront, setEditPassportFront] = useState<File | null>(null);
  const [editPassportBack, setEditPassportBack] = useState<File | null>(null);
  const [editError, setEditError] = useState('');
  const [editLoading, setEditLoading] = useState(false);

  useEffect(() => {
    loadCouriers();
  }, []);

  const formatCost = (cost: number) => {
    const abs = Math.abs(cost);
    const somoni = Math.floor(abs);
    const diram = Math.round((abs - somoni) * 100);
    const sign = cost < 0 ? '-' : '';
    if (diram > 0) return `${sign}${somoni.toLocaleString()}.${String(diram).padStart(2, '0')} сомони`;
    return `${sign}${somoni.toLocaleString()} сомони`;
  };

  const loadCouriers = async () => {
    const q = query(collection(db, 'users'), where('role', '==', 'COURIER'));
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Courier[];
    setCouriers(data);
  };

  const uploadFile = async (file: File, path: string): Promise<string> => {
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    return getDownloadURL(storageRef);
  };

  const handleCreateCourier = async () => {
    setError('');
    if (!newCourier.name || !newCourier.login || !newCourier.password) {
      setError('Имя, логин и пароль обязательны');
      return;
    }
    setLoading(true);
    try {
      // Upload photos if provided
      const timestamp = Date.now();
      let scooterPhotoUrl = '';
      let passportFrontUrl = '';
      let passportBackUrl = '';

      if (scooterPhoto) {
        scooterPhotoUrl = await uploadFile(scooterPhoto, `couriers/${newCourier.login}/scooter_${timestamp}.jpg`);
      }
      if (passportFront) {
        passportFrontUrl = await uploadFile(passportFront, `couriers/${newCourier.login}/passport_front_${timestamp}.jpg`);
      }
      if (passportBack) {
        passportBackUrl = await uploadFile(passportBack, `couriers/${newCourier.login}/passport_back_${timestamp}.jpg`);
      }

      const createCourierFn = httpsCallable(functions, 'createCourier');
      await createCourierFn({
        ...newCourier,
        adminId,
        scooterPhotoUrl,
        passportFrontUrl,
        passportBackUrl,
      });
      setOpenDialog(false);
      setNewCourier({ name: '', surname: '', birthYear: '', city: '', phone: '', login: '', password: '' });
      setScooterPhoto(null);
      setPassportFront(null);
      setPassportBack(null);
      loadCouriers();
    } catch (err: any) {
      setError(err.message || 'Ошибка создания курьера');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleBlock = async (courier: Courier) => {
    try {
      await updateDoc(doc(db, 'users', courier.id), {
        isBlocked: !courier.isBlocked,
      });
      setCouriers(prev => prev.map(c =>
        c.id === courier.id ? { ...c, isBlocked: !c.isBlocked } : c
      ));
    } catch (err: any) {
      alert('Ошибка: ' + err.message);
    }
  };

  const handleDelete = async (courierId: string) => {
    if (window.confirm('Удалить курьера?')) {
      await deleteDoc(doc(db, 'users', courierId));
      loadCouriers();
    }
  };

  const getDateRange = (p: typeof historyPeriod): { start: number; end: number } => {
    const now = new Date();
    let start = 0;
    let end = now.getTime();
    
    switch (p) {
      case 'today': {
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        start = todayStart.getTime();
        end = now.getTime();
        break;
      }
      case 'yesterday': {
        const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        const yesterdayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        start = yesterdayStart.getTime();
        end = yesterdayEnd.getTime() - 1;
        break;
      }
      case 'week': 
        start = end - 7 * 86400000; 
        break;
      case 'month': 
        start = end - 30 * 86400000; 
        break;
      case 'year': 
        start = end - 365 * 86400000; 
        break;
      default: 
        start = 0;
    }
    return { start, end };
  };

  const handleShowHistory = async (courier: Courier) => {
    setHistoryCourier(courier);
    setHistoryPeriod('all');
    setHistoryOpen(true);
    await loadHistoryStats(courier, 'all');
  };

  const loadHistoryStats = async (courier: Courier, period: typeof historyPeriod) => {
    try {
      const { start, end } = getDateRange(period);
      
      // Load deliveries
      let q = query(
        collection(db, 'deliveries'),
        where('courierId', '==', courier.id),
        where('status', '==', 'COMPLETED')
      );
      
      const snapshot = await getDocs(q);
      const allDeliveries = snapshot.docs.map(d => ({
        id: d.id,
        ...d.data()
      })) as Delivery[];
      
      // Filter by date range
      const filteredDeliveries = allDeliveries.filter(d => {
        if (period === 'all') return true;
        return d.createdAt >= start && d.createdAt <= end;
      });
      
      // Calculate stats
      const totalDeliveries = filteredDeliveries.length;
      const totalEarnings = filteredDeliveries.reduce((sum, d) => sum + (d.cost || 0), 0);
      const totalCommission = filteredDeliveries.reduce((sum, d) => sum + (d.commission || 0), 0);
      const netEarnings = totalEarnings - totalCommission;
      
      setHistoryStats({
        deliveries: filteredDeliveries,
        totalDeliveries,
        totalEarnings,
        totalCommission,
        netEarnings,
      });
    } catch (err) {
      console.error('Error loading history:', err);
      setHistoryStats(null);
    }
  };

  const handleHistoryPeriodChange = (period: typeof historyPeriod) => {
    setHistoryPeriod(period);
    if (historyCourier) {
      loadHistoryStats(historyCourier, period);
    }
  };

  const handleAssignToClient = (courier: Courier) => {
    setAssignCourier(courier);
    setClientPhone('');
    setAssignError('');
    setAssignOpen(true);
  };

  const handleConfirmAssign = async () => {
    if (!assignCourier || !clientPhone) {
      setAssignError('Введите номер телефона клиента');
      return;
    }

    setAssignLoading(true);
    setAssignError('');

    try {
      const assignCourierToClientFn = httpsCallable(functions, 'assignCourierToClient');
      await assignCourierToClientFn({
        adminId,
        courierId: assignCourier.id,
        clientPhone: clientPhone.trim(),
      });

      setAssignOpen(false);
      setClientPhone('');
      alert(`Курьер ${assignCourier.name} назначен клиенту. SMS отправлено.`);
    } catch (err: any) {
      setAssignError(err.message || 'Ошибка назначения курьера');
    } finally {
      setAssignLoading(false);
    }
  };

  const handleOpenEdit = (courier: Courier) => {
    setEditingCourier(courier);
    setEditData({
      name: courier.name,
      surname: courier.surname || '',
      birthYear: courier.birthYear || '',
      city: courier.city || '',
      phone: courier.phone || '',
    });
    setEditScooterPhoto(null);
    setEditPassportFront(null);
    setEditPassportBack(null);
    setEditError('');
    setEditOpen(true);
  };

  const handleUpdateCourier = async () => {
    if (!editingCourier || !editData.name) {
      setEditError('Имя обязательно');
      return;
    }

    setEditLoading(true);
    setEditError('');

    try {
      // Upload new photos if provided
      const timestamp = Date.now();
      const updates: any = {
        name: editData.name,
        surname: editData.surname,
        birthYear: editData.birthYear,
        city: editData.city,
        phone: editData.phone,
      };

      if (editScooterPhoto) {
        updates.scooterPhotoUrl = await uploadFile(
          editScooterPhoto,
          `couriers/${editingCourier.login}/scooter_${timestamp}.jpg`
        );
      }
      if (editPassportFront) {
        updates.passportFrontUrl = await uploadFile(
          editPassportFront,
          `couriers/${editingCourier.login}/passport_front_${timestamp}.jpg`
        );
      }
      if (editPassportBack) {
        updates.passportBackUrl = await uploadFile(
          editPassportBack,
          `couriers/${editingCourier.login}/passport_back_${timestamp}.jpg`
        );
      }

      await updateDoc(doc(db, 'users', editingCourier.id), updates);

      setEditOpen(false);
      alert('Данные курьера обновлены');
      loadCouriers();
    } catch (err: any) {
      setEditError(err.message || 'Ошибка обновления данных');
    } finally {
      setEditLoading(false);
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Курьеры</Typography>
        <Button variant="contained" startIcon={<Add />} onClick={() => setOpenDialog(true)}>
          Добавить курьера
        </Button>
      </Box>

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Имя</TableCell>
                <TableCell>Логин</TableCell>
                <TableCell>Телефон</TableCell>
                <TableCell>Баланс</TableCell>
                <TableCell>Статус</TableCell>
                <TableCell>Действия</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {couriers.map((courier) => (
                <TableRow key={courier.id}>
                  <TableCell>{courier.name} {courier.surname}</TableCell>
                  <TableCell>{courier.login}</TableCell>
                  <TableCell>{courier.phone}</TableCell>
                  <TableCell>
                    <Chip
                      label={formatCost(courier.balance || 0)}
                      color={(courier.balance || 0) >= 5 ? 'success' : 'error'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    {courier.isBlocked ? (
                      <Chip label="Заблокирован" color="error" size="small" />
                    ) : courier.isOnline ? (
                      <Chip label="Онлайн" color="success" size="small" />
                    ) : (
                      <Chip label="Оффлайн" size="small" />
                    )}
                  </TableCell>
                  <TableCell>
                    <IconButton onClick={() => handleOpenEdit(courier)} color="primary" title="Редактировать">
                      <Edit />
                    </IconButton>
                    <IconButton onClick={() => handleAssignToClient(courier)} color="info" title="Назначить клиенту">
                      <PersonAdd />
                    </IconButton>
                    <IconButton onClick={() => handleShowHistory(courier)} color="primary" title="История">
                      <History />
                    </IconButton>
                    <IconButton onClick={() => handleToggleBlock(courier)} color={courier.isBlocked ? 'success' : 'warning'} title={courier.isBlocked ? 'Разблокировать' : 'Заблокировать'}>
                      <Block />
                    </IconButton>
                    <IconButton onClick={() => handleDelete(courier.id)} color="error" title="Удалить">
                      <Delete />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Create courier dialog */}
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Новый курьер</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={6}>
              <TextField fullWidth label="Имя *" value={newCourier.name}
                onChange={(e) => setNewCourier({ ...newCourier, name: e.target.value })} />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth label="Фамилия" value={newCourier.surname}
                onChange={(e) => setNewCourier({ ...newCourier, surname: e.target.value })} />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth label="Год рождения" type="number" value={newCourier.birthYear}
                onChange={(e) => setNewCourier({ ...newCourier, birthYear: e.target.value })} />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth select label="Город" value={newCourier.city}
                onChange={(e) => setNewCourier({ ...newCourier, city: e.target.value })}>
                {TAJIKISTAN_CITIES.map(city => (
                  <MenuItem key={city} value={city}>{city}</MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth label="Телефон" value={newCourier.phone}
                onChange={(e) => setNewCourier({ ...newCourier, phone: e.target.value })} />
            </Grid>

            {/* Photo uploads */}
            <Grid item xs={12}>
              <InputLabel sx={{ mb: 0.5, fontSize: 14 }}>Фото скутера</InputLabel>
              <input type="file" accept="image/*"
                onChange={(e) => setScooterPhoto(e.target.files?.[0] || null)} />
            </Grid>
            <Grid item xs={6}>
              <InputLabel sx={{ mb: 0.5, fontSize: 14 }}>Паспорт (лицевая)</InputLabel>
              <input type="file" accept="image/*"
                onChange={(e) => setPassportFront(e.target.files?.[0] || null)} />
            </Grid>
            <Grid item xs={6}>
              <InputLabel sx={{ mb: 0.5, fontSize: 14 }}>Паспорт (обратная)</InputLabel>
              <input type="file" accept="image/*"
                onChange={(e) => setPassportBack(e.target.files?.[0] || null)} />
            </Grid>

            {/* Credentials */}
            <Grid item xs={6}>
              <TextField fullWidth label="Логин *" value={newCourier.login}
                onChange={(e) => setNewCourier({ ...newCourier, login: e.target.value })} />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth label="Пароль *" type="password" value={newCourier.password}
                onChange={(e) => setNewCourier({ ...newCourier, password: e.target.value })} />
            </Grid>
          </Grid>
          {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDialog(false)}>Отмена</Button>
          <Button variant="contained" onClick={handleCreateCourier} disabled={loading}>
            {loading ? 'Создание...' : 'Создать'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* History dialog */}
      <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          История доставок: {historyCourier?.name} {historyCourier?.surname}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Текущий баланс: <strong>{formatCost(historyCourier?.balance || 0)}</strong>
            </Typography>
            
            {/* Period selector */}
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 3 }}>
              {[
                { value: 'today', label: 'Сегодня' },
                { value: 'yesterday', label: 'Вчера' },
                { value: 'week', label: 'Неделя' },
                { value: 'month', label: 'Месяц' },
                { value: 'year', label: 'Год' },
                { value: 'all', label: 'Всё время' },
              ].map(period => (
                <Button
                  key={period.value}
                  variant={historyPeriod === period.value ? 'contained' : 'outlined'}
                  size="small"
                  onClick={() => handleHistoryPeriodChange(period.value as typeof historyPeriod)}
                >
                  {period.label}
                </Button>
              ))}
            </Box>

            {/* Stats cards */}
            {historyStats && (
              <Grid container spacing={2} sx={{ mb: 3 }}>
                <Grid item xs={12} sm={3}>
                  <Card sx={{ bgcolor: 'primary.main', color: 'white' }}>
                    <CardContent sx={{ textAlign: 'center', py: 2 }}>
                      <Typography variant="h4" sx={{ fontWeight: 700 }}>
                        {historyStats.totalDeliveries}
                      </Typography>
                      <Typography variant="body2">
                        Доставок
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={12} sm={3}>
                  <Card sx={{ bgcolor: 'success.main', color: 'white' }}>
                    <CardContent sx={{ textAlign: 'center', py: 2 }}>
                      <Typography variant="h5" sx={{ fontWeight: 700 }}>
                        {formatCost(historyStats.totalEarnings)}
                      </Typography>
                      <Typography variant="body2">
                        Заработок
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={12} sm={3}>
                  <Card sx={{ bgcolor: 'warning.main', color: 'white' }}>
                    <CardContent sx={{ textAlign: 'center', py: 2 }}>
                      <Typography variant="h5" sx={{ fontWeight: 700 }}>
                        {formatCost(historyStats.totalCommission)}
                      </Typography>
                      <Typography variant="body2">
                        Комиссия
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={12} sm={3}>
                  <Card sx={{ bgcolor: 'info.main', color: 'white' }}>
                    <CardContent sx={{ textAlign: 'center', py: 2 }}>
                      <Typography variant="h5" sx={{ fontWeight: 700 }}>
                        {formatCost(historyStats.netEarnings)}
                      </Typography>
                      <Typography variant="body2">
                        Чистый заработок
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            )}

            {/* Deliveries list */}
            {historyStats && historyStats.deliveries.length > 0 && (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Дата</TableCell>
                      <TableCell>Клиент</TableCell>
                      <TableCell>Расстояние</TableCell>
                      <TableCell>Стоимость</TableCell>
                      <TableCell>Комиссия</TableCell>
                      <TableCell>Чистый</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {historyStats.deliveries.map((delivery) => (
                      <TableRow key={delivery.id}>
                        <TableCell>
                          {new Date(delivery.createdAt).toLocaleDateString('ru-RU')}
                        </TableCell>
                        <TableCell>{delivery.clientPhone}</TableCell>
                        <TableCell>
                          {delivery.distanceMeters 
                            ? `${(delivery.distanceMeters / 1000).toFixed(1)} км`
                            : '—'}
                        </TableCell>
                        <TableCell sx={{ color: 'success.main', fontWeight: 600 }}>
                          {formatCost(delivery.cost || 0)}
                        </TableCell>
                        <TableCell sx={{ color: 'warning.main', fontWeight: 600 }}>
                          {formatCost(delivery.commission || 0)}
                        </TableCell>
                        <TableCell sx={{ color: 'info.main', fontWeight: 600 }}>
                          {formatCost((delivery.cost || 0) - (delivery.commission || 0))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            {historyStats && historyStats.deliveries.length === 0 && (
              <Alert severity="info">
                Нет доставок за выбранный период
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHistoryOpen(false)}>Закрыть</Button>
        </DialogActions>
      </Dialog>

      {/* Assign to client dialog */}
      <Dialog open={assignOpen} onClose={() => setAssignOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Назначить курьера клиенту</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Курьер: {assignCourier?.name} {assignCourier?.surname}
          </Typography>
          <TextField
            fullWidth
            label="Номер телефона клиента"
            placeholder="+992XXXXXXXXX или 9XXXXXXXX"
            value={clientPhone}
            onChange={(e) => setClientPhone(e.target.value)}
            sx={{ mt: 1 }}
            autoFocus
          />
          {assignError && <Alert severity="error" sx={{ mt: 2 }}>{assignError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAssignOpen(false)} disabled={assignLoading}>
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={handleConfirmAssign}
            disabled={assignLoading}
          >
            {assignLoading ? 'Отправка...' : 'Назначить'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit courier dialog */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Редактировать курьера</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={6}>
              <TextField
                fullWidth
                label="Имя *"
                value={editData.name}
                onChange={(e) => setEditData({ ...editData, name: e.target.value })}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                label="Фамилия"
                value={editData.surname}
                onChange={(e) => setEditData({ ...editData, surname: e.target.value })}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                label="Год рождения"
                type="number"
                value={editData.birthYear}
                onChange={(e) => setEditData({ ...editData, birthYear: e.target.value })}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                select
                label="Город"
                value={editData.city}
                onChange={(e) => setEditData({ ...editData, city: e.target.value })}
              >
                {TAJIKISTAN_CITIES.map(city => (
                  <MenuItem key={city} value={city}>{city}</MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Телефон"
                value={editData.phone}
                onChange={(e) => setEditData({ ...editData, phone: e.target.value })}
              />
            </Grid>

            {/* Photo uploads */}
            <Grid item xs={12}>
              <InputLabel sx={{ mb: 0.5, fontSize: 14 }}>
                Фото скутера {editScooterPhoto && '(новое фото выбрано)'}
              </InputLabel>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setEditScooterPhoto(e.target.files?.[0] || null)}
              />
            </Grid>
            <Grid item xs={6}>
              <InputLabel sx={{ mb: 0.5, fontSize: 14 }}>
                Паспорт (лицевая) {editPassportFront && '(новое фото)'}
              </InputLabel>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setEditPassportFront(e.target.files?.[0] || null)}
              />
            </Grid>
            <Grid item xs={6}>
              <InputLabel sx={{ mb: 0.5, fontSize: 14 }}>
                Паспорт (обратная) {editPassportBack && '(новое фото)'}
              </InputLabel>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setEditPassportBack(e.target.files?.[0] || null)}
              />
            </Grid>
          </Grid>
          {editError && <Alert severity="error" sx={{ mt: 2 }}>{editError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)} disabled={editLoading}>
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={handleUpdateCourier}
            disabled={editLoading}
          >
            {editLoading ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Couriers;
