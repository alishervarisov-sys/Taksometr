import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Card, CardContent, TextField, Button, Alert, Grid,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Dialog, DialogTitle, DialogContent, DialogActions, Chip, IconButton,
  InputAdornment, Tooltip
} from '@mui/material';
import { Add, Save, Edit } from '@mui/icons-material';
import { doc, getDoc, collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';

interface CommissionProps {
  adminId: string;
}

interface Courier {
  id: string;
  name: string;
  phone: string;
  balance: number;
  commissionPercent?: number;
}

interface Transaction {
  id: string;
  courierId: string;
  courierName: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string;
  createdAt: number;
}

const Commission: React.FC<CommissionProps> = ({ adminId }) => {
  const [globalCommission, setGlobalCommission] = useState('10');
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  // Per-courier commission editing
  const [editingCourierId, setEditingCourierId] = useState<string | null>(null);
  const [editCommissionValue, setEditCommissionValue] = useState('');
  const [savingCommission, setSavingCommission] = useState<string | null>(null);

  // Top-up dialog
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [selectedCourier, setSelectedCourier] = useState<Courier | null>(null);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [topUpNote, setTopUpNote] = useState('');
  const [topUpLoading, setTopUpLoading] = useState(false);

  useEffect(() => {
    loadCommission();
    loadCouriers();
    loadTransactions();
  }, []);

  const loadCommission = async () => {
    try {
      const docSnap = await getDoc(doc(db, 'settings', 'commission'));
      if (docSnap.exists()) {
        setGlobalCommission(String(docSnap.data().percent ?? 10));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadCouriers = async () => {
    const q = query(collection(db, 'users'), where('role', '==', 'COURIER'));
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map(d => ({
      id: d.id,
      name: d.data().name || '',
      phone: d.data().phone || '',
      balance: d.data().balance || 0,
      commissionPercent: d.data().commissionPercent,
    }));
    setCouriers(data);
  };

  const loadTransactions = async () => {
    try {
      const q = query(
        collection(db, 'transactions'),
        orderBy('createdAt', 'desc'),
      );
      const snapshot = await getDocs(q);
      const data = snapshot.docs.slice(0, 50).map(d => ({
        id: d.id,
        ...d.data(),
      })) as Transaction[];
      setTransactions(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveGlobalCommission = async () => {
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const fn = httpsCallable(functions, 'updateCommission');
      await fn({ adminId, percent: Number(globalCommission) });
      setSuccess('Глобальная комиссия обновлена');
    } catch (err: any) {
      setError(err.message || 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCourierCommission = async (courierId: string) => {
    setSavingCommission(courierId);
    setError('');
    try {
      const fn = httpsCallable(functions, 'updateCourierCommission');
      await fn({ adminId, courierId, percent: Number(editCommissionValue) });
      // Update local state
      setCouriers(prev => prev.map(c =>
        c.id === courierId ? { ...c, commissionPercent: Number(editCommissionValue) } : c
      ));
      setEditingCourierId(null);
      setSuccess(`Комиссия курьера обновлена: ${editCommissionValue}%`);
    } catch (err: any) {
      setError(err.message || 'Ошибка обновления комиссии');
    } finally {
      setSavingCommission(null);
    }
  };

  const handleTopUp = async () => {
    if (!selectedCourier || !topUpAmount) return;
    setTopUpLoading(true);
    setError('');
    try {
      const fn = httpsCallable(functions, 'topUpBalance');
      const result = await fn({
        adminId,
        courierId: selectedCourier.id,
        amount: Number(topUpAmount),
        note: topUpNote || 'Пополнение баланса',
      });
      const data = result.data as any;
      setSuccess(`Баланс пополнен. Новый баланс: ${data.newBalance} сомони`);
      setTopUpOpen(false);
      setTopUpAmount('');
      setTopUpNote('');
      loadCouriers();
      loadTransactions();
    } catch (err: any) {
      setError(err.message || 'Ошибка пополнения');
    } finally {
      setTopUpLoading(false);
    }
  };

  const formatDate = (ts: number) => new Date(ts).toLocaleString('ru-RU');

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 3 }}>Комиссия и баланс</Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      <Grid container spacing={3}>
        {/* Global commission settings */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>Глобальная комиссия</Typography>
              <TextField
                fullWidth
                label="Комиссия по умолчанию (%)"
                type="number"
                value={globalCommission}
                onChange={(e) => setGlobalCommission(e.target.value)}
                margin="normal"
                helperText="Применяется к курьерам, у которых не задана индивидуальная комиссия"
              />
              <Button
                variant="contained"
                fullWidth
                onClick={handleSaveGlobalCommission}
                disabled={loading}
                sx={{ mt: 2 }}
              >
                Сохранить
              </Button>
            </CardContent>
          </Card>
        </Grid>

        {/* Courier balances + individual commission */}
        <Grid item xs={12} md={8}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>Курьеры — комиссия и баланс</Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Курьер</TableCell>
                      <TableCell>Телефон</TableCell>
                      <TableCell>Комиссия (%)</TableCell>
                      <TableCell>Баланс</TableCell>
                      <TableCell>Действие</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {couriers.map((courier) => (
                      <TableRow key={courier.id}>
                        <TableCell>{courier.name}</TableCell>
                        <TableCell>{courier.phone}</TableCell>
                        <TableCell>
                          {editingCourierId === courier.id ? (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <TextField
                                size="small"
                                type="number"
                                value={editCommissionValue}
                                onChange={(e) => setEditCommissionValue(e.target.value)}
                                sx={{ width: 80 }}
                                InputProps={{
                                  endAdornment: <InputAdornment position="end">%</InputAdornment>,
                                }}
                              />
                              <IconButton
                                size="small"
                                color="primary"
                                onClick={() => handleSaveCourierCommission(courier.id)}
                                disabled={savingCommission === courier.id}
                              >
                                <Save fontSize="small" />
                              </IconButton>
                            </Box>
                          ) : (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Chip
                                label={
                                  courier.commissionPercent !== undefined && courier.commissionPercent !== null
                                    ? `${courier.commissionPercent}%`
                                    : `${globalCommission}% (общая)`
                                }
                                color={
                                  courier.commissionPercent !== undefined && courier.commissionPercent !== null
                                    ? 'primary'
                                    : 'default'
                                }
                                size="small"
                                variant={
                                  courier.commissionPercent !== undefined && courier.commissionPercent !== null
                                    ? 'filled'
                                    : 'outlined'
                                }
                              />
                              <Tooltip title="Изменить комиссию">
                                <IconButton
                                  size="small"
                                  onClick={() => {
                                    setEditingCourierId(courier.id);
                                    setEditCommissionValue(
                                      String(courier.commissionPercent ?? globalCommission)
                                    );
                                  }}
                                >
                                  <Edit fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={`${courier.balance.toLocaleString()} сомони`}
                            color={courier.balance >= 0 ? 'success' : 'error'}
                            size="small"
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<Add />}
                            onClick={() => {
                              setSelectedCourier(courier);
                              setTopUpOpen(true);
                            }}
                          >
                            Пополнить
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        {/* Transaction history */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>История операций</Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Дата</TableCell>
                      <TableCell>Курьер</TableCell>
                      <TableCell>Тип</TableCell>
                      <TableCell>Сумма</TableCell>
                      <TableCell>Баланс после</TableCell>
                      <TableCell>Описание</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {transactions.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell>{formatDate(tx.createdAt)}</TableCell>
                        <TableCell>{tx.courierName}</TableCell>
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
                        <TableCell colSpan={6} align="center">Нет операций</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Top-up dialog */}
      <Dialog open={topUpOpen} onClose={() => setTopUpOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Пополнить баланс: {selectedCourier?.name}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Текущий баланс: {selectedCourier?.balance?.toLocaleString()} сомони
          </Typography>
          <TextField
            fullWidth
            label="Сумма пополнения (сомони)"
            type="number"
            value={topUpAmount}
            onChange={(e) => setTopUpAmount(e.target.value)}
            margin="normal"
          />
          <TextField
            fullWidth
            label="Примечание (необязательно)"
            value={topUpNote}
            onChange={(e) => setTopUpNote(e.target.value)}
            margin="normal"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTopUpOpen(false)}>Отмена</Button>
          <Button variant="contained" onClick={handleTopUp} disabled={topUpLoading || !topUpAmount}>
            Пополнить
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Commission;
