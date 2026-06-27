import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Card, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, Button, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, Grid, Tab, Tabs, CircularProgress, Alert,
  InputAdornment,
} from '@mui/material';
import { LocalTaxi as TaxiIcon, Add as AddIcon } from '@mui/icons-material';
import {
  collection, query, orderBy, where, onSnapshot, getDocs, limit,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TaxiOrder {
  id: string;
  orderNumber: number;
  customerPhone: string;
  pickup: string;
  destination: string;
  status: TabValue;
  driverTelegramId?: string;
  driverName?: string;
  telegramMessageId?: number;
  createdAt: number;
  acceptedAt?: number;
}

interface TaxiProps {
  adminId: string;
}

type TabValue = 'waiting' | 'accepted' | 'completed' | 'cancelled';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<TabValue, { label: string; color: 'warning' | 'success' | 'default' | 'error' }> = {
  waiting:   { label: 'Ожидает',    color: 'warning' },
  accepted:  { label: 'Принят',     color: 'success' },
  completed: { label: 'Завершён',   color: 'default' },
  cancelled: { label: 'Отменён',    color: 'error'   },
};

const TAB_LABELS: Record<TabValue, string> = {
  waiting:   'Новые',
  accepted:  'Приняты',
  completed: 'Завершённые',
  cancelled: 'Отменённые',
};

const YELLOW = '#FFC107';
const YELLOW_DARK = '#FFB300';

// ─── Component ────────────────────────────────────────────────────────────────

const Taxi: React.FC<TaxiProps> = ({ adminId }) => {
  const [orders, setOrders]                   = useState<TaxiOrder[]>([]);
  const [activeTab, setActiveTab]             = useState<TabValue>('waiting');
  const [createOpen, setCreateOpen]           = useState(false);
  const [creating, setCreating]               = useState(false);
  const [createError, setCreateError]         = useState('');
  const [phoneSearching, setPhoneSearching]   = useState(false);
  const [foundClientName, setFoundClientName] = useState<string | null>(null);

  const [form, setForm] = useState({ customerPhone: '', pickup: '', destination: '' });

  // Real-time listener on taxi_orders collection
  useEffect(() => {
    const q = query(
      collection(db, 'taxi_orders'),
      orderBy('createdAt', 'desc'),
      limit(300),
    );
    return onSnapshot(q, (snap) => {
      setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() } as TaxiOrder)));
    });
  }, []);

  const filteredOrders = orders.filter(o => o.status === activeTab);

  const tabCounts: Record<TabValue, number> = {
    waiting:   orders.filter(o => o.status === 'waiting').length,
    accepted:  orders.filter(o => o.status === 'accepted').length,
    completed: orders.filter(o => o.status === 'completed').length,
    cancelled: orders.filter(o => o.status === 'cancelled').length,
  };

  // ── Client lookup by phone ────────────────────────────────────────────────

  const handlePhoneBlur = async () => {
    const phone = form.customerPhone.trim();
    if (!phone || phoneSearching) return;
    setPhoneSearching(true);
    setFoundClientName(null);
    try {
      const snap = await getDocs(
        query(collection(db, 'users'), where('phone', '==', phone), limit(1)),
      );
      if (!snap.empty) {
        setFoundClientName(snap.docs[0].data().name || '—');
      }
    } finally {
      setPhoneSearching(false);
    }
  };

  // ── Create order ──────────────────────────────────────────────────────────

  const handleCreateOrder = async () => {
    if (!form.customerPhone.trim() || !form.pickup.trim()) {
      setCreateError('Телефон и поле «Откуда» обязательны');
      return;
    }
    setCreating(true);
    setCreateError('');
    try {
      const fn = httpsCallable(functions, 'createTaxiOrder');
      await fn({
        adminId,
        customerPhone: form.customerPhone.trim(),
        pickup: form.pickup.trim(),
        destination: form.destination.trim(),
      });
      setCreateOpen(false);
      setForm({ customerPhone: '', pickup: '', destination: '' });
      setFoundClientName(null);
    } catch (e: any) {
      setCreateError(e.message || 'Ошибка создания заказа');
    } finally {
      setCreating(false);
    }
  };

  const handleCloseDialog = () => {
    if (creating) return;
    setCreateOpen(false);
    setCreateError('');
    setFoundClientName(null);
    setForm({ customerPhone: '', pickup: '', destination: '' });
  };

  // ── Formatters ────────────────────────────────────────────────────────────

  const fmt = (ts: number, part: 'date' | 'time') => {
    const d = new Date(ts);
    return part === 'date'
      ? d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TaxiIcon sx={{ color: YELLOW, fontSize: 32 }} />
          <Typography variant="h5" fontWeight={700}>ZaKi Taxi</Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateOpen(true)}
          sx={{ backgroundColor: YELLOW, color: '#000', fontWeight: 700, '&:hover': { backgroundColor: YELLOW_DARK } }}
        >
          Создать заказ
        </Button>
      </Box>

      {/* Summary cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {(['waiting', 'accepted', 'completed', 'cancelled'] as TabValue[]).map((s) => (
          <Grid item xs={6} sm={3} key={s}>
            <Card
              onClick={() => setActiveTab(s)}
              sx={{
                p: 2, textAlign: 'center', cursor: 'pointer',
                border: activeTab === s ? `2px solid ${YELLOW}` : '2px solid transparent',
                transition: 'border-color .2s',
              }}
            >
              <Typography variant="h4" fontWeight={700}>{tabCounts[s]}</Typography>
              <Chip label={STATUS_LABELS[s].label} color={STATUS_LABELS[s].color} size="small" sx={{ mt: 0.5 }} />
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onChange={(_, v) => setActiveTab(v as TabValue)}
        textColor="inherit"
        TabIndicatorProps={{ style: { backgroundColor: YELLOW } }}
        sx={{ mb: 2, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        {(['waiting', 'accepted', 'completed', 'cancelled'] as TabValue[]).map(s => (
          <Tab key={s} label={`${TAB_LABELS[s]} (${tabCounts[s]})`} value={s} />
        ))}
      </Tabs>

      {/* Orders table */}
      <TableContainer component={Card}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ '& th': { fontWeight: 700, backgroundColor: '#f5f5f5' } }}>
              <TableCell>№</TableCell>
              <TableCell>Телефон клиента</TableCell>
              <TableCell>Откуда</TableCell>
              <TableCell>Куда</TableCell>
              <TableCell>Водитель</TableCell>
              <TableCell>Статус</TableCell>
              <TableCell>Дата</TableCell>
              <TableCell>Время</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredOrders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                  Нет заказов в этом разделе
                </TableCell>
              </TableRow>
            ) : (
              filteredOrders.map((order) => (
                <TableRow key={order.id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>#{order.orderNumber}</TableCell>
                  <TableCell>{order.customerPhone}</TableCell>
                  <TableCell sx={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {order.pickup}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {order.destination || '—'}
                  </TableCell>
                  <TableCell>{order.driverName || '—'}</TableCell>
                  <TableCell>
                    <Chip
                      label={STATUS_LABELS[order.status]?.label || order.status}
                      color={STATUS_LABELS[order.status]?.color || 'default'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>{fmt(order.createdAt, 'date')}</TableCell>
                  <TableCell>{fmt(order.createdAt, 'time')}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* ── Create Order Dialog ── */}
      <Dialog open={createOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TaxiIcon sx={{ color: YELLOW }} />
          Новый заказ такси
        </DialogTitle>

        <DialogContent>
          {createError && <Alert severity="error" sx={{ mb: 2 }}>{createError}</Alert>}

          {/* Phone */}
          <TextField
            label="Телефон клиента *"
            fullWidth
            margin="normal"
            value={form.customerPhone}
            onChange={e => {
              setForm(f => ({ ...f, customerPhone: e.target.value }));
              setFoundClientName(null);
            }}
            onBlur={handlePhoneBlur}
            placeholder="+992900000000"
            InputProps={{
              endAdornment: phoneSearching
                ? <InputAdornment position="end"><CircularProgress size={16} /></InputAdornment>
                : undefined,
            }}
            helperText={
              foundClientName
                ? `✅ Клиент найден: ${foundClientName}`
                : form.customerPhone && !phoneSearching
                  ? 'Клиент не найден — заказ будет создан по номеру'
                  : undefined
            }
            FormHelperTextProps={{
              sx: { color: foundClientName ? 'success.main' : 'text.secondary' },
            }}
          />

          {/* Pickup */}
          <TextField
            label="Откуда *"
            fullWidth
            margin="normal"
            value={form.pickup}
            onChange={e => setForm(f => ({ ...f, pickup: e.target.value }))}
            placeholder="Ресторан Ватан"
            autoComplete="off"
          />

          {/* Destination */}
          <TextField
            label="Куда (необязательно)"
            fullWidth
            margin="normal"
            value={form.destination}
            onChange={e => setForm(f => ({ ...f, destination: e.target.value }))}
            placeholder="Бохтар Плаза"
            autoComplete="off"
          />
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button onClick={handleCloseDialog} disabled={creating}>Отмена</Button>
          <Button
            variant="contained"
            onClick={handleCreateOrder}
            disabled={creating}
            sx={{ backgroundColor: YELLOW, color: '#000', fontWeight: 700, '&:hover': { backgroundColor: YELLOW_DARK } }}
          >
            {creating ? <CircularProgress size={20} sx={{ color: '#000' }} /> : 'Создать заказ'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Taxi;
