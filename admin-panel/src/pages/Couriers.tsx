import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Card, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Button, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, IconButton, Chip, Alert
} from '@mui/material';
import { Add, Block, Delete, History } from '@mui/icons-material';
import { collection, getDocs, doc, updateDoc, deleteDoc, query, where, orderBy } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';

interface CouriersProps {
  adminId: string;
}

interface Courier {
  id: string;
  login: string;
  name: string;
  phone: string;
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

const Couriers: React.FC<CouriersProps> = ({ adminId }) => {
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [openDialog, setOpenDialog] = useState(false);
  const [newCourier, setNewCourier] = useState({ login: '', password: '', name: '', phone: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // History dialog
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyCourier, setHistoryCourier] = useState<Courier | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  useEffect(() => {
    loadCouriers();
  }, []);

  const loadCouriers = async () => {
    const q = query(collection(db, 'users'), where('role', '==', 'COURIER'));
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Courier[];
    setCouriers(data);
  };

  const handleCreateCourier = async () => {
    setError('');
    setLoading(true);
    try {
      const createCourierFn = httpsCallable(functions, 'createCourier');
      await createCourierFn({
        ...newCourier,
        adminId,
      });
      setOpenDialog(false);
      setNewCourier({ login: '', password: '', name: '', phone: '' });
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
      // Update local state immediately
      setCouriers(prev => prev.map(c => 
        c.id === courier.id ? { ...c, isBlocked: !c.isBlocked } : c
      ));
    } catch (err: any) {
      alert('Ошибка блокировки: ' + err.message);
    }
  };

  const handleDelete = async (courierId: string) => {
    if (window.confirm('Удалить курьера?')) {
      await deleteDoc(doc(db, 'users', courierId));
      loadCouriers();
    }
  };

  const handleShowHistory = async (courier: Courier) => {
    setHistoryCourier(courier);
    setHistoryOpen(true);
    try {
      const q = query(
        collection(db, 'transactions'),
        where('courierId', '==', courier.id),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDocs(q);
      setTransactions(snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Transaction[]);
    } catch (err) {
      console.error(err);
      setTransactions([]);
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
                  <TableCell>{courier.name}</TableCell>
                  <TableCell>{courier.login}</TableCell>
                  <TableCell>{courier.phone}</TableCell>
                  <TableCell>
                    <Chip
                      label={`${(courier.balance || 0).toLocaleString()} сомони`}
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

      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Новый курьер</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth label="Имя" margin="normal"
            value={newCourier.name}
            onChange={(e) => setNewCourier({ ...newCourier, name: e.target.value })}
          />
          <TextField
            fullWidth label="Логин" margin="normal"
            value={newCourier.login}
            onChange={(e) => setNewCourier({ ...newCourier, login: e.target.value })}
          />
          <TextField
            fullWidth label="Пароль" type="password" margin="normal"
            value={newCourier.password}
            onChange={(e) => setNewCourier({ ...newCourier, password: e.target.value })}
          />
          <TextField
            fullWidth label="Телефон" margin="normal"
            value={newCourier.phone}
            onChange={(e) => setNewCourier({ ...newCourier, phone: e.target.value })}
          />
          {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDialog(false)}>Отмена</Button>
          <Button variant="contained" onClick={handleCreateCourier} disabled={loading}>
            Создать
          </Button>
        </DialogActions>
      </Dialog>

      {/* History dialog */}
      <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>История: {historyCourier?.name}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Баланс: {(historyCourier?.balance || 0).toLocaleString()} сомони
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Дата</TableCell>
                  <TableCell>Тип</TableCell>
                  <TableCell>Сумма</TableCell>
                  <TableCell>Баланс после</TableCell>
                  <TableCell>Описание</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell>{new Date(tx.createdAt).toLocaleString('ru-RU')}</TableCell>
                    <TableCell>
                      <Chip
                        label={tx.type === 'TOP_UP' ? 'Пополнение' : 'Комиссия'}
                        color={tx.type === 'TOP_UP' ? 'success' : 'warning'}
                        size="small"
                      />
                    </TableCell>
                    <TableCell sx={{ color: tx.amount >= 0 ? 'green' : 'red', fontWeight: 600 }}>
                      {tx.amount >= 0 ? '+' : ''}{tx.amount.toLocaleString()} сомони
                    </TableCell>
                    <TableCell>{tx.balanceAfter?.toLocaleString()} сомони</TableCell>
                    <TableCell>{tx.description}</TableCell>
                  </TableRow>
                ))}
                {transactions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center">Нет операций</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHistoryOpen(false)}>Закрыть</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Couriers;
