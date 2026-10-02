import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Select, Snackbar, Stack, TextField, Typography } from '@mui/material';
import { Notifications } from '@mui/icons-material';
import { httpsCallable } from 'firebase/functions';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { functions } from '../firebase';
import { enableAdminWebPush, listenToAdminPush, usesWindowsNotifications } from '../adminPush';

interface TopUpRequest { id: string; courierName: string; courierPhone: string; amount: number; createdAt: number; }
const RequestsContext = createContext({ adminId: '', requests: [] as TopUpRequest[], error: '', refresh: async () => {} });

export function BalanceRequestsProvider({ adminId, children }: { adminId: string; children: React.ReactNode }) {
  const [requests, setRequests] = useState<TopUpRequest[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const previousIds = useRef<Set<string> | null>(null);
  const pending = useRef(false);
  const refresh = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    try {
      const result = await httpsCallable(functions, 'getBalanceTopUpRequests')({ adminId });
      const next = (result.data as { requests: TopUpRequest[] }).requests;
      const added = previousIds.current ? next.filter(row => !previousIds.current!.has(row.id)) : [];
      if (added.length) setNotice(`Новая заявка: ${added[0].courierName}, ${added[0].amount} сомони`);
      previousIds.current = new Set(next.map(row => row.id));
      setRequests(next);
      setError('');
    } catch (err: any) {
      setError(err.message || 'Не удалось загрузить заявки');
    } finally { pending.current = false; }
  }, [adminId]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15000);
    window.addEventListener('focus', refresh);
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    listenToAdminPush(adminId, refresh).then(off => { if (disposed) off(); else unsubscribe = off; }).catch(() => {});
    return () => { disposed = true; unsubscribe?.(); window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [adminId, refresh]);
  return <RequestsContext.Provider value={{ adminId, requests, error, refresh }}>
    {children}
    <Snackbar open={!!notice} autoHideDuration={8000} onClose={() => setNotice('')}>
      <Alert severity="info" onClose={() => setNotice('')}>{notice}</Alert>
    </Snackbar>
  </RequestsContext.Provider>;
}

export function AdminBalanceAlerts() {
  const desktopNotifications = usesWindowsNotifications();
  const { adminId, requests } = useContext(RequestsContext);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [vapidKey, setVapidKey] = useState('');
  const [error, setError] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const { refresh } = useContext(RequestsContext);
  useEffect(() => {
    let active = true;
    if (desktopNotifications) return;
    httpsCallable(functions, 'getAdminWebPushConfig')({ adminId }).then(async result => {
      const key = (result.data as { vapidKey: string }).vapidKey;
      if (!active) return;
      setVapidKey(key);
      if (key && 'Notification' in window && Notification.permission === 'granted') {
        await enableAdminWebPush(adminId, key, false);
        if (active) setEnabled(true);
      }
    }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [adminId, desktopNotifications]);
  const enable = async () => {
    setBusy(true); setError('');
    try {
      if (!('Notification' in window)) throw new Error('Этот браузер не поддерживает push-уведомления.');
      if (await Notification.requestPermission() !== 'granted') throw new Error('Разрешите уведомления для этого сайта.');
      if (adminId === 'SUPER_ADMIN') await httpsCallable(functions, 'setAdminWebPushConfig')({ adminId, vapidKey: vapidKey.trim() });
      await enableAdminWebPush(adminId, vapidKey.trim(), false);
      setEnabled(true);
    } catch (err: any) { setError(err.message || 'Не удалось включить уведомления'); }
    finally { setBusy(false); }
  };
  return <>
    <IconButton title="Заявки на пополнение" aria-label="Заявки на пополнение" onClick={() => { setOpen(true); void refresh(); }}>
      <Badge badgeContent={requests.length} color="error"><Notifications /></Badge>
    </IconButton>
    <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
      <DialogTitle>Заявки на пополнение баланса</DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 2 }}>{requests.length ? `Ожидают решения: ${requests.length}` : 'Нет ожидающих заявок'}</Typography>
        {requests.map(row => <Box key={row.id} sx={{ mb: 1 }}><Button onClick={() => { setOpen(false); navigate(`/commission?requestId=${row.id}`); }}>{row.courierName}: {row.amount} сомони</Button></Box>)}
        {error && <Alert severity="error" sx={{ my: 2 }}>{error}</Alert>}
        {desktopNotifications ? <Alert severity="info">Заявки показываются в уведомлениях Windows. При закрытии окна ZaKi продолжает работать рядом с часами. Проверить уведомления можно кнопкой в верхней панели приложения.</Alert> : enabled ? <Alert severity="success">Push включён: заявки приходят и при закрытой панели.</Alert> : <>
          <Typography variant="body2" sx={{ mb: 2 }}>Включите push на этом устройстве, чтобы получать заявки при закрытой панели.</Typography>
          {adminId === 'SUPER_ADMIN' && <TextField fullWidth label="Публичный ключ Web Push" value={vapidKey} onChange={event => setVapidKey(event.target.value)} helperText="Firebase → Настройки проекта → Cloud Messaging → Web Push certificates" sx={{ mb: 2 }} />}
          {!vapidKey && adminId !== 'SUPER_ADMIN' && <Alert severity="info">Суперадминистратор должен подключить ключ Web Push.</Alert>}
          <Button variant="contained" disabled={busy || !vapidKey} onClick={enable}>{busy ? 'Подключение…' : 'Включить push-уведомления'}</Button>
        </>}
      </DialogContent>
      <DialogActions><Button onClick={() => setOpen(false)}>Закрыть</Button></DialogActions>
    </Dialog>
  </>;
}

export function BalanceTopUpRequests({ onReviewed }: { onReviewed: () => void }) {
  const { adminId, requests, error, refresh } = useContext(RequestsContext);
  const [params] = useSearchParams();
  const [statuses, setStatuses] = useState<Record<string, 'PAID' | 'DEBT'>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState('');
  const review = async (row: TopUpRequest, decision: 'APPROVE' | 'REJECT') => {
    if (busy) return;
    if (!window.confirm(decision === 'APPROVE' ? `Одобрить пополнение ${row.courierName} на ${row.amount} сомони (${statuses[row.id] === 'PAID' ? 'оплачено' : 'долг'})?` : 'Отклонить заявку?')) return;
    setBusy(row.id); setReviewError('');
    try {
      await httpsCallable(functions, 'reviewBalanceTopUp')({ adminId, requestId: row.id, decision, paymentStatus: statuses[row.id] || 'DEBT' });
      await refresh(); onReviewed();
    } catch (err: any) { setReviewError(err.message || 'Не удалось обработать заявку'); }
    finally { setBusy(null); }
  };
  return <Card sx={{ mb: 3 }}><CardContent>
    <Stack direction="row" justifyContent="space-between"><Typography variant="h6">Заявки курьеров на пополнение</Typography><Button onClick={() => void refresh()}>Обновить</Button></Stack>
    {(reviewError || error) && <Alert severity="error" sx={{ my: 2 }}>{reviewError || error}</Alert>}
    {!requests.length && <Typography color="text.secondary" sx={{ mt: 2 }}>Нет ожидающих заявок</Typography>}
    {requests.map(row => <Stack key={row.id} direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} sx={{ p: 2, mt: 1, border: '1px solid', borderColor: params.get('requestId') === row.id ? 'primary.main' : 'divider', borderRadius: 2 }}>
      <Box sx={{ flex: 1 }}><Typography fontWeight={600}>{row.courierName}</Typography><Typography variant="body2">{row.courierPhone} · {new Date(row.createdAt).toLocaleString('ru-RU')}</Typography></Box>
      <Chip label={`${row.amount} сомони`} color="primary" />
      <Select size="small" inputProps={{ 'aria-label': `Статус оплаты: ${row.courierName}` }} value={statuses[row.id] || 'DEBT'} disabled={!!busy} onChange={event => setStatuses(current => ({ ...current, [row.id]: event.target.value as 'PAID' | 'DEBT' }))}>
        <MenuItem value="DEBT">Долг</MenuItem><MenuItem value="PAID">Оплачено</MenuItem>
      </Select>
      <Button variant="contained" disabled={!!busy} onClick={() => void review(row, 'APPROVE')}>{busy === row.id ? 'Обработка…' : 'Одобрить'}</Button>
      <Button color="error" disabled={!!busy} onClick={() => void review(row, 'REJECT')}>Отклонить</Button>
    </Stack>)}
    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>Баланс начисляется после одобрения. Статус оплаты можно затем изменить в истории операций.</Typography>
  </CardContent></Card>;
}
