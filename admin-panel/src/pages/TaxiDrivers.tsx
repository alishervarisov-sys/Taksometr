import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Card, CardContent, CardMedia, Grid, Button, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Tab, Tabs,
  Avatar, IconButton, InputAdornment, Divider, Stack, Alert,
  CircularProgress, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Tooltip,
} from '@mui/material';
import {
  Search as SearchIcon, Check as CheckIcon, Close as CloseIcon,
  Block as BlockIcon, Send as SendIcon, DirectionsCar as CarIcon,
  Person as PersonIcon, History as HistoryIcon, Refresh as RefreshIcon,
} from '@mui/icons-material';
import {
  collection, query, orderBy, onSnapshot, limit, getDocs, where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TaxiDriver {
  id: string;
  telegramId: string;
  telegramUsername: string;
  telegramPhotoUrl: string;
  firstName: string;
  lastName: string;
  birthYear: string;
  phone: string;
  passport: string;
  driverLicense: string;
  passportLicense: string;
  carBrand: string;
  carModel: string;
  carColor: string;
  carNumber: string;
  status: 'pending' | 'approved' | 'rejected' | 'blocked';
  driverStatus: 'online' | 'offline' | 'on_order';
  photos: {
    passport: string; driverLicense: string; license: string;
    techPassport: string; carFront: string; carBack: string; carInterior: string;
  };
  completedTrips: number;
  cancelledTrips: number;
  totalEarnings: number;
  registeredAt: number;
  lastActiveAt: number;
  blockedReason?: string;
}

interface AuditEntry {
  id: string;
  action: string;
  driverName?: string;
  adminId?: string;
  details: string;
  timestamp: number;
}

interface Props { adminId: string }

type MainTab = 'pending' | 'approved' | 'blocked' | 'audit';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CHIP: Record<string, { label: string; color: 'warning' | 'success' | 'error' | 'default' }> = {
  pending:  { label: 'На проверке', color: 'warning' },
  approved: { label: 'Одобрен',     color: 'success' },
  rejected: { label: 'Отклонён',    color: 'error'   },
  blocked:  { label: 'Заблокирован',color: 'error'   },
};

const DRIVER_STATUS_CHIP: Record<string, { label: string; color: 'success' | 'default' | 'warning' | 'error' }> = {
  online:   { label: 'Онлайн',    color: 'success'  },
  offline:  { label: 'Офлайн',    color: 'default'  },
  on_order: { label: 'На заказе', color: 'warning'  },
};

const ACTION_LABELS: Record<string, string> = {
  driver_registered: '📝 Регистрация',
  driver_approved:   '✅ Одобрение',
  driver_rejected:   '❌ Отклонение',
  driver_blocked:    '🚫 Блокировка',
  broadcast_sent:    '📢 Рассылка',
};

// ─── Component ────────────────────────────────────────────────────────────────

const TaxiDrivers: React.FC<Props> = ({ adminId }) => {
  const [drivers, setDrivers]         = useState<TaxiDriver[]>([]);
  const [auditLog, setAuditLog]       = useState<AuditEntry[]>([]);
  const [tab, setTab]                 = useState<MainTab>('pending');
  const [search, setSearch]           = useState('');
  const [selected, setSelected]       = useState<TaxiDriver | null>(null);
  const [detailOpen, setDetailOpen]   = useState(false);
  const [photoUrl, setPhotoUrl]       = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [blockReason, setBlockReason] = useState('');
  const [rejectOpen, setRejectOpen]   = useState(false);
  const [blockOpen, setBlockOpen]     = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastMsg, setBroadcastMsg]   = useState('');
  const [broadcastTarget, setBroadcastTarget] = useState<'approved' | 'all'>('approved');
  const [loading, setLoading]         = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  // Real-time listeners
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'taxiDrivers'), orderBy('registeredAt', 'desc'), limit(500)),
      (snap) => setDrivers(snap.docs.map(d => ({ id: d.id, ...d.data() } as TaxiDriver))),
    );
    return unsub;
  }, []);

  useEffect(() => {
    if (tab !== 'audit') return;
    const unsub = onSnapshot(
      query(collection(db, 'taxiAuditLog'), orderBy('timestamp', 'desc'), limit(200)),
      (snap) => setAuditLog(snap.docs.map(d => ({ id: d.id, ...d.data() } as AuditEntry))),
    );
    return unsub;
  }, [tab]);

  // ── Filtering ────────────────────────────────────────────────────────────

  const byTab = drivers.filter(d => {
    if (tab === 'pending')  return d.status === 'pending';
    if (tab === 'approved') return d.status === 'approved';
    if (tab === 'blocked')  return d.status === 'blocked' || d.status === 'rejected';
    return false;
  });

  const q = search.toLowerCase();
  const filtered = q
    ? byTab.filter(d =>
        `${d.firstName} ${d.lastName}`.toLowerCase().includes(q) ||
        (d.phone || '').includes(q) ||
        (d.carNumber || '').toLowerCase().includes(q) ||
        (d.telegramId || '').includes(q) ||
        (d.telegramUsername || '').toLowerCase().includes(q),
      )
    : byTab;

  // ── Actions ───────────────────────────────────────────────────────────────

  const runAction = async (fn: () => Promise<any>, successMsg: string) => {
    setLoading(true);
    setActionError('');
    setActionSuccess('');
    try {
      await fn();
      setActionSuccess(successMsg);
      setDetailOpen(false);
      setRejectOpen(false);
      setBlockOpen(false);
    } catch (e: any) {
      setActionError(e.message || 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = (driver: TaxiDriver) =>
    runAction(
      () => httpsCallable(functions, 'approveTaxiDriver')({ adminId, driverId: driver.id }),
      `✅ Водитель ${driver.firstName} ${driver.lastName} одобрен`,
    );

  const handleReject = () => {
    if (!selected) return;
    runAction(
      () => httpsCallable(functions, 'rejectTaxiDriver')({ adminId, driverId: selected.id, reason: rejectReason }),
      `Заявка ${selected.firstName} ${selected.lastName} отклонена`,
    );
  };

  const handleBlock = () => {
    if (!selected) return;
    runAction(
      () => httpsCallable(functions, 'blockTaxiDriver')({ adminId, driverId: selected.id, reason: blockReason }),
      `Водитель ${selected.firstName} ${selected.lastName} заблокирован`,
    );
  };

  const handleBroadcast = () =>
    runAction(
      () => httpsCallable(functions, 'sendTaxiBroadcast')({ adminId, message: broadcastMsg, targetStatus: broadcastTarget }),
      'Рассылка отправлена',
    );

  // ── Helpers ───────────────────────────────────────────────────────────────

  const fmt = (ts: number) => ts
    ? new Date(ts).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

  const tabCounts = {
    pending:  drivers.filter(d => d.status === 'pending').length,
    approved: drivers.filter(d => d.status === 'approved').length,
    blocked:  drivers.filter(d => d.status === 'blocked' || d.status === 'rejected').length,
  };

  const openDetail = (driver: TaxiDriver) => {
    setSelected(driver);
    setDetailOpen(true);
    setActionError('');
    setActionSuccess('');
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h5" fontWeight={700}>🚗 Таксисты</Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<SendIcon />} onClick={() => setBroadcastOpen(true)}>
            Рассылка
          </Button>
        </Stack>
      </Box>

      {/* Feedback banners */}
      {actionSuccess && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setActionSuccess('')}>{actionSuccess}</Alert>}
      {actionError   && <Alert severity="error"   sx={{ mb: 2 }} onClose={() => setActionError('')}>{actionError}</Alert>}

      {/* Search */}
      <TextField
        placeholder="Поиск по имени, телефону, госномеру, Telegram ID..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        size="small"
        fullWidth
        sx={{ mb: 2 }}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }}
      />

      {/* Tabs */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ mb: 2, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Tab label={`На проверке (${tabCounts.pending})`}   value="pending"  />
        <Tab label={`Одобренные (${tabCounts.approved})`}   value="approved" />
        <Tab label={`Заблокированные (${tabCounts.blocked})`} value="blocked" />
        <Tab label="Журнал" value="audit" icon={<HistoryIcon fontSize="small" />} iconPosition="start" />
      </Tabs>

      {/* Audit log tab */}
      {tab === 'audit' && (
        <TableContainer component={Card}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 700, backgroundColor: '#f5f5f5' } }}>
                <TableCell>Действие</TableCell>
                <TableCell>Водитель</TableCell>
                <TableCell>Детали</TableCell>
                <TableCell>Дата / Время</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {auditLog.map(entry => (
                <TableRow key={entry.id} hover>
                  <TableCell>{ACTION_LABELS[entry.action] ?? entry.action}</TableCell>
                  <TableCell>{entry.driverName ?? '—'}</TableCell>
                  <TableCell sx={{ maxWidth: 320, fontSize: 12 }}>{entry.details}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmt(entry.timestamp)}</TableCell>
                </TableRow>
              ))}
              {auditLog.length === 0 && (
                <TableRow><TableCell colSpan={4} align="center" sx={{ py: 4, color: 'text.secondary' }}>Нет записей</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Driver cards */}
      {tab !== 'audit' && (
        <Grid container spacing={2}>
          {filtered.map(driver => (
            <Grid item xs={12} sm={6} md={4} key={driver.id}>
              <Card
                sx={{ cursor: 'pointer', '&:hover': { boxShadow: 4 }, transition: 'box-shadow .2s' }}
                onClick={() => openDetail(driver)}
              >
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5 }}>
                    <Avatar
                      src={driver.telegramPhotoUrl}
                      sx={{ width: 52, height: 52, bgcolor: '#FFC107', fontSize: 22 }}
                    >
                      {driver.firstName?.[0] ?? '?'}
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography fontWeight={700} noWrap>
                        {driver.firstName} {driver.lastName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {driver.phone} {driver.telegramUsername ? `• @${driver.telegramUsername}` : ''}
                      </Typography>
                    </Box>
                    <Chip
                      label={STATUS_CHIP[driver.status]?.label ?? driver.status}
                      color={STATUS_CHIP[driver.status]?.color ?? 'default'}
                      size="small"
                    />
                  </Box>
                  <Divider sx={{ mb: 1.5 }} />
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CarIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                    <Typography variant="body2" noWrap>
                      {driver.carBrand} {driver.carModel} • {driver.carColor} • {driver.carNumber}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      Поездок: {driver.completedTrips ?? 0}
                    </Typography>
                    {driver.status === 'approved' && (
                      <Chip
                        label={DRIVER_STATUS_CHIP[driver.driverStatus ?? 'offline']?.label}
                        color={DRIVER_STATUS_CHIP[driver.driverStatus ?? 'offline']?.color}
                        size="small"
                        sx={{ height: 20, fontSize: 10 }}
                      />
                    )}
                  </Box>
                  {/* Quick actions */}
                  {driver.status === 'pending' && (
                    <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                      <Button
                        size="small" variant="contained" color="success" startIcon={<CheckIcon />}
                        onClick={e => { e.stopPropagation(); handleApprove(driver); }}
                        sx={{ flex: 1 }}
                      >
                        Одобрить
                      </Button>
                      <Button
                        size="small" variant="outlined" color="error" startIcon={<CloseIcon />}
                        onClick={e => { e.stopPropagation(); setSelected(driver); setRejectOpen(true); }}
                        sx={{ flex: 1 }}
                      >
                        Отклонить
                      </Button>
                    </Stack>
                  )}
                  {driver.status === 'approved' && (
                    <Button
                      size="small" variant="outlined" color="error" startIcon={<BlockIcon />}
                      fullWidth sx={{ mt: 1.5 }}
                      onClick={e => { e.stopPropagation(); setSelected(driver); setBlockOpen(true); }}
                    >
                      Заблокировать
                    </Button>
                  )}
                </CardContent>
              </Card>
            </Grid>
          ))}
          {filtered.length === 0 && (
            <Grid item xs={12}>
              <Typography align="center" color="text.secondary" sx={{ py: 5 }}>
                Нет водителей в этом разделе
              </Typography>
            </Grid>
          )}
        </Grid>
      )}

      {/* ── Detail Dialog ── */}
      <Dialog open={detailOpen} onClose={() => setDetailOpen(false)} maxWidth="md" fullWidth scroll="paper">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Avatar src={selected?.telegramPhotoUrl} sx={{ width: 48, height: 48, bgcolor: '#FFC107' }}>
            {selected?.firstName?.[0]}
          </Avatar>
          <Box>
            <Typography fontWeight={700}>{selected?.firstName} {selected?.lastName}</Typography>
            <Typography variant="caption" color="text.secondary">
              Telegram ID: {selected?.telegramId}
              {selected?.telegramUsername ? ` • @${selected.telegramUsername}` : ''}
            </Typography>
          </Box>
          <Box sx={{ ml: 'auto' }}>
            <Chip
              label={STATUS_CHIP[selected?.status ?? 'pending']?.label}
              color={STATUS_CHIP[selected?.status ?? 'pending']?.color}
            />
          </Box>
        </DialogTitle>

        <DialogContent dividers>
          {selected && (
            <Grid container spacing={2}>
              {/* Personal info */}
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" fontWeight={700} gutterBottom>👤 Личные данные</Typography>
                {[
                  ['Имя', selected.firstName],
                  ['Фамилия', selected.lastName],
                  ['Год рождения', selected.birthYear],
                  ['Телефон', selected.phone],
                  ['Паспорт', selected.passport],
                  ['Вод. удостоверение', selected.driverLicense],
                  ['Лицензия', selected.passportLicense],
                ].map(([label, val]) => (
                  <Box key={label} sx={{ display: 'flex', gap: 1, mb: 0.5 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ minWidth: 140 }}>{label}:</Typography>
                    <Typography variant="body2" fontWeight={500}>{val || '—'}</Typography>
                  </Box>
                ))}
              </Grid>

              {/* Car info */}
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" fontWeight={700} gutterBottom>🚗 Автомобиль</Typography>
                {[
                  ['Марка', selected.carBrand],
                  ['Модель', selected.carModel],
                  ['Цвет', selected.carColor],
                  ['Госномер', selected.carNumber],
                ].map(([label, val]) => (
                  <Box key={label} sx={{ display: 'flex', gap: 1, mb: 0.5 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ minWidth: 140 }}>{label}:</Typography>
                    <Typography variant="body2" fontWeight={500}>{val || '—'}</Typography>
                  </Box>
                ))}
                <Divider sx={{ my: 1.5 }} />
                <Typography variant="subtitle2" fontWeight={700} gutterBottom>📊 Статистика</Typography>
                {[
                  ['Выполнено поездок', selected.completedTrips ?? 0],
                  ['Отменено', selected.cancelledTrips ?? 0],
                  ['Общий заработок', `${(selected.totalEarnings ?? 0).toLocaleString('ru-RU')} сомони`],
                  ['Дата регистрации', fmt(selected.registeredAt)],
                  ['Последняя активность', fmt(selected.lastActiveAt)],
                ].map(([label, val]) => (
                  <Box key={String(label)} sx={{ display: 'flex', gap: 1, mb: 0.5 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ minWidth: 140 }}>{label}:</Typography>
                    <Typography variant="body2" fontWeight={500}>{String(val)}</Typography>
                  </Box>
                ))}
              </Grid>

              {/* Photos */}
              <Grid item xs={12}>
                <Typography variant="subtitle2" fontWeight={700} gutterBottom>📸 Документы и фотографии</Typography>
                <Grid container spacing={1}>
                  {[
                    ['Паспорт',      selected.photos?.passport],
                    ['Вод. удост.',  selected.photos?.driverLicense],
                    ['Лицензия',     selected.photos?.license],
                    ['Техпаспорт',   selected.photos?.techPassport],
                    ['Авто (спереди)', selected.photos?.carFront],
                    ['Авто (сзади)', selected.photos?.carBack],
                    ['Салон',        selected.photos?.carInterior],
                  ].map(([label, url]) => url ? (
                    <Grid item xs={6} sm={4} md={3} key={String(label)}>
                      <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                        {label}
                      </Typography>
                      <Box
                        component="img"
                        src={url as string}
                        alt={String(label)}
                        onClick={() => setPhotoUrl(url as string)}
                        sx={{
                          width: '100%', height: 120, objectFit: 'cover', borderRadius: 1,
                          cursor: 'pointer', '&:hover': { opacity: 0.85 }, transition: 'opacity .2s',
                        }}
                      />
                    </Grid>
                  ) : null)}
                </Grid>
              </Grid>
            </Grid>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 2, py: 1.5, gap: 1 }}>
          <Button onClick={() => setDetailOpen(false)}>Закрыть</Button>
          {selected?.status === 'pending' && (
            <>
              <Button variant="contained" color="success" startIcon={<CheckIcon />}
                onClick={() => { handleApprove(selected!); }}
              >Одобрить</Button>
              <Button variant="outlined" color="error" startIcon={<CloseIcon />}
                onClick={() => setRejectOpen(true)}
              >Отклонить</Button>
            </>
          )}
          {(selected?.status === 'approved' || selected?.status === 'pending') && (
            <Button variant="outlined" color="error" startIcon={<BlockIcon />}
              onClick={() => setBlockOpen(true)}
            >Заблокировать</Button>
          )}
        </DialogActions>
      </Dialog>

      {/* ── Reject Dialog ── */}
      <Dialog open={rejectOpen} onClose={() => setRejectOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Отклонить заявку</DialogTitle>
        <DialogContent>
          <TextField
            label="Причина отклонения (необязательно)"
            fullWidth multiline rows={3} margin="normal"
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectOpen(false)}>Отмена</Button>
          <Button variant="contained" color="error" onClick={handleReject} disabled={loading}>
            {loading ? <CircularProgress size={18} /> : 'Отклонить'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Block Dialog ── */}
      <Dialog open={blockOpen} onClose={() => setBlockOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Заблокировать водителя</DialogTitle>
        <DialogContent>
          <TextField
            label="Причина блокировки (необязательно)"
            fullWidth multiline rows={3} margin="normal"
            value={blockReason}
            onChange={e => setBlockReason(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBlockOpen(false)}>Отмена</Button>
          <Button variant="contained" color="error" startIcon={<BlockIcon />} onClick={handleBlock} disabled={loading}>
            {loading ? <CircularProgress size={18} /> : 'Заблокировать'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Broadcast Dialog ── */}
      <Dialog open={broadcastOpen} onClose={() => setBroadcastOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>📢 Рассылка сообщения</DialogTitle>
        <DialogContent>
          <TextField
            select fullWidth margin="normal" label="Кому"
            value={broadcastTarget}
            onChange={e => setBroadcastTarget(e.target.value as any)}
            SelectProps={{ native: true }}
          >
            <option value="approved">Только одобренным водителям</option>
            <option value="all">Всем водителям</option>
          </TextField>
          <TextField
            label="Текст сообщения" fullWidth multiline rows={4} margin="normal"
            value={broadcastMsg}
            onChange={e => setBroadcastMsg(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBroadcastOpen(false)}>Отмена</Button>
          <Button
            variant="contained" startIcon={<SendIcon />}
            onClick={handleBroadcast}
            disabled={loading || !broadcastMsg.trim()}
            sx={{ backgroundColor: '#FFC107', color: '#000', '&:hover': { backgroundColor: '#FFB300' } }}
          >
            {loading ? <CircularProgress size={18} /> : 'Отправить'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Fullscreen photo viewer ── */}
      <Dialog open={!!photoUrl} onClose={() => setPhotoUrl(null)} maxWidth="md">
        <DialogContent sx={{ p: 0, display: 'flex', justifyContent: 'center', backgroundColor: '#000' }}>
          <Box
            component="img"
            src={photoUrl ?? ''}
            sx={{ maxWidth: '90vw', maxHeight: '85vh', objectFit: 'contain' }}
          />
        </DialogContent>
        <DialogActions sx={{ backgroundColor: '#000' }}>
          <Button onClick={() => setPhotoUrl(null)} sx={{ color: 'white' }}>Закрыть</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default TaxiDrivers;
