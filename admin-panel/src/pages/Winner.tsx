import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Card, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Button, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, Chip, Alert, Grid, Avatar, InputAdornment,
  CircularProgress, Divider
} from '@mui/material';
import { EmojiEvents, Calculate, Send } from '@mui/icons-material';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';

interface WinnerProps {
  adminId: string;
}

interface Courier {
  id: string;
  login: string;
  name: string;
  surname: string;
  phone: string;
  city: string;
  isOnline: boolean;
  isBlocked: boolean;
  balance: number;
}

interface Delivery {
  courierId: string;
  cost: number;
  createdAt: number;
  status: string;
}

// Returns YYYY-MM-DD for an <input type="date">.
const toDateInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Returns YYYY-MM-DDTHH:mm for an <input type="datetime-local">.
const toDateTimeInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const Winner: React.FC<WinnerProps> = ({ adminId }) => {
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [loading, setLoading] = useState(false);

  // Congratulation dialog
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Courier | null>(null);
  const [congratsText, setCongratsText] = useState('');
  const [prizeAmount, setPrizeAmount] = useState('');
  const [orderCount, setOrderCount] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadCouriers();
  }, []);

  const loadCouriers = async () => {
    const q = query(collection(db, 'users'), where('role', '==', 'COURIER'));
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Courier[];
    // Blocked couriers cannot be winners.
    setCouriers(data.filter(c => !c.isBlocked));
  };

  const handleSelect = (courier: Courier) => {
    setSelected(courier);
    setError('');
    setSuccess('');

    const now = new Date();
    // Default period = the current calendar month.
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    // Default: show the congratulation for the next 7 days.
    const showUntil = new Date(now.getTime() + 7 * 86400000);

    setCongratsText(
      `Поздравляем, ${courier.name}! Вы стали лучшим курьером месяца. ` +
      `Спасибо за отличную работу — так держать!`
    );
    setPrizeAmount('');
    setOrderCount('');
    setPeriodStart(toDateInput(monthStart));
    setPeriodEnd(toDateInput(now));
    setExpiresAt(toDateTimeInput(showUntil));
    setOpen(true);
  };

  // Count COMPLETED deliveries for the selected courier within the chosen range.
  const handleCalculateOrders = async () => {
    if (!selected || !periodStart || !periodEnd) {
      setError('Укажите период (даты) для подсчёта заказов');
      return;
    }
    setCalculating(true);
    setError('');
    try {
      const start = new Date(periodStart);
      start.setHours(0, 0, 0, 0);
      const end = new Date(periodEnd);
      end.setHours(23, 59, 59, 999);

      const q = query(
        collection(db, 'deliveries'),
        where('courierId', '==', selected.id),
        where('status', '==', 'COMPLETED')
      );
      const snapshot = await getDocs(q);
      const deliveries = snapshot.docs.map(d => d.data()) as Delivery[];
      const count = deliveries.filter(
        d => d.createdAt >= start.getTime() && d.createdAt <= end.getTime()
      ).length;
      setOrderCount(String(count));
    } catch (err: any) {
      setError(err.message || 'Ошибка подсчёта заказов');
    } finally {
      setCalculating(false);
    }
  };

  const handleSend = async () => {
    if (!selected) return;
    if (!congratsText.trim()) {
      setError('Введите текст поздравления');
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const start = periodStart ? new Date(periodStart) : null;
      if (start) start.setHours(0, 0, 0, 0);
      const end = periodEnd ? new Date(periodEnd) : null;
      if (end) end.setHours(23, 59, 59, 999);
      const expiry = expiresAt ? new Date(expiresAt) : null;

      const announceWinnerFn = httpsCallable(functions, 'announceWinner');
      const res: any = await announceWinnerFn({
        adminId,
        winnerId: selected.id,
        congratsText: congratsText.trim(),
        prizeAmount: Number(prizeAmount) || 0,
        orderCount: Number(orderCount) || 0,
        periodStart: start ? start.getTime() : 0,
        periodEnd: end ? end.getTime() : Date.now(),
        expiresAt: expiry ? expiry.getTime() : Date.now() + 7 * 86400000,
      });

      const data = res?.data || {};
      setSuccess(
        `Поздравление отправлено! Победитель: ${data.winnerName || selected.name}. ` +
        `Уведомлены остальные курьеры: ${data.othersNotified ?? 0}.`
      );
      setOpen(false);
    } catch (err: any) {
      setError(err.message || 'Ошибка отправки поздравления');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <EmojiEvents sx={{ color: '#FFC107', mr: 1, fontSize: 32 }} />
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Победитель месяца</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Нажмите на курьера, чтобы назначить его победителем и отправить поздравление.
        Победитель получит полное поздравление, остальные курьеры — короткое уведомление.
      </Typography>

      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Курьер</TableCell>
                <TableCell>Логин</TableCell>
                <TableCell>Телефон</TableCell>
                <TableCell>Город</TableCell>
                <TableCell align="right">Действие</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {couriers.map((courier) => (
                <TableRow
                  key={courier.id}
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => handleSelect(courier)}
                >
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Avatar sx={{ bgcolor: 'primary.main', width: 36, height: 36 }}>
                        {courier.name?.[0]?.toUpperCase() || '?'}
                      </Avatar>
                      <Typography sx={{ fontWeight: 600 }}>
                        {courier.name} {courier.surname}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>{courier.login}</TableCell>
                  <TableCell>{courier.phone}</TableCell>
                  <TableCell>{courier.city}</TableCell>
                  <TableCell align="right">
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<EmojiEvents />}
                      sx={{ bgcolor: '#FFC107', color: '#000', '&:hover': { bgcolor: '#FFB300' } }}
                      onClick={(e) => { e.stopPropagation(); handleSelect(courier); }}
                    >
                      Выбрать
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {couriers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    <Typography color="text.secondary" sx={{ py: 3 }}>Курьеры не найдены</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Congratulation form dialog */}
      <Dialog open={open} onClose={() => !loading && setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <EmojiEvents sx={{ color: '#FFC107' }} />
          Поздравление победителя
        </DialogTitle>
        <DialogContent>
          {selected && (
            <Chip
              label={`${selected.name}${selected.surname ? ' ' + selected.surname : ''}`}
              color="primary"
              sx={{ mb: 2, mt: 0.5 }}
            />
          )}
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                minRows={3}
                label="Текст поздравления (для победителя)"
                value={congratsText}
                onChange={(e) => setCongratsText(e.target.value)}
              />
            </Grid>

            <Grid item xs={12}>
              <TextField
                fullWidth
                type="number"
                label="Сумма премии"
                value={prizeAmount}
                onChange={(e) => setPrizeAmount(e.target.value)}
                InputProps={{ endAdornment: <InputAdornment position="end">сомони</InputAdornment> }}
              />
            </Grid>

            <Grid item xs={12}>
              <Divider textAlign="left">
                <Typography variant="caption" color="text.secondary">Количество заказов за период</Typography>
              </Divider>
            </Grid>

            <Grid item xs={6}>
              <TextField
                fullWidth
                type="date"
                label="С даты"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                type="date"
                label="По дату"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>

            <Grid item xs={12}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <TextField
                  type="number"
                  label="Кол-во заказов"
                  value={orderCount}
                  onChange={(e) => setOrderCount(e.target.value)}
                  sx={{ flex: 1 }}
                />
                <Button
                  variant="outlined"
                  startIcon={calculating ? <CircularProgress size={16} /> : <Calculate />}
                  onClick={handleCalculateOrders}
                  disabled={calculating}
                >
                  Посчитать
                </Button>
              </Box>
            </Grid>

            <Grid item xs={12}>
              <Divider />
            </Grid>

            <Grid item xs={12}>
              <TextField
                fullWidth
                type="datetime-local"
                label="Показывать поздравление до"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                InputLabelProps={{ shrink: true }}
                helperText="До этого момента поздравление будет показываться в приложении курьера"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOpen(false)} disabled={loading}>Отмена</Button>
          <Button
            variant="contained"
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <Send />}
            onClick={handleSend}
            disabled={loading}
          >
            Отправить поздравление
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Winner;
