import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Card, CardContent, Grid, TextField, Button,
  Alert, CircularProgress, Divider, Stack, Chip
} from '@mui/material';
import { Send as SendIcon, Schedule as ScheduleIcon, Check as CheckIcon } from '@mui/icons-material';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../firebase';

interface TelegramReportProps {
  adminId: string;
}

const TelegramReport: React.FC<TelegramReportProps> = ({ adminId }) => {
  const [scheduledHour, setScheduledHour] = useState<string>('23');
  const [scheduledMinute, setScheduledMinute] = useState<string>('00');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentSchedule, setCurrentSchedule] = useState<string | null>(null);

  useEffect(() => {
    loadSchedule();
  }, []);

  const loadSchedule = async () => {
    try {
      const snap = await getDoc(doc(db, 'settings', 'telegramReport'));
      if (snap.exists()) {
        const data = snap.data();
        const h = String(data.hour ?? 23).padStart(2, '0');
        const m = String(data.minute ?? 0).padStart(2, '0');
        setScheduledHour(h);
        setScheduledMinute(m);
        setCurrentSchedule(`${h}:${m}`);
      }
    } catch (e) {
      console.error('Failed to load schedule', e);
    }
  };

  const handleSaveSchedule = async () => {
    const h = parseInt(scheduledHour, 10);
    const m = parseInt(scheduledMinute, 10);

    if (isNaN(h) || h < 0 || h > 23) {
      setError('Часы должны быть от 0 до 23');
      return;
    }
    if (isNaN(m) || m < 0 || m > 59) {
      setError('Минуты должны быть от 0 до 59');
      return;
    }

    setSaving(true);
    setError(null);
    setSaveSuccess(false);

    try {
      await setDoc(doc(db, 'settings', 'telegramReport'), {
        hour: h,
        minute: m,
        enabled: true,
        updatedAt: Date.now(),
        updatedBy: adminId,
      }, { merge: true });

      const hStr = String(h).padStart(2, '0');
      const mStr = String(m).padStart(2, '0');
      setCurrentSchedule(`${hStr}:${mStr}`);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e: any) {
      setError('Ошибка сохранения: ' + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  const handleSendNow = async () => {
    setSending(true);
    setError(null);
    setSendSuccess(false);

    try {
      const functions = getFunctions();
      const sendReport = httpsCallable(functions, 'sendTelegramReport');
      await sendReport({ adminId });
      setSendSuccess(true);
      setTimeout(() => setSendSuccess(false), 4000);
    } catch (e: any) {
      setError('Ошибка отправки: ' + (e.message || e));
    } finally {
      setSending(false);
    }
  };

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={3}>
        Telegram Отчёт
      </Typography>

      <Grid container spacing={3}>
        {/* Schedule settings */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1} mb={2}>
                <ScheduleIcon color="primary" />
                <Typography variant="h6" fontWeight={600}>
                  Расписание отчёта
                </Typography>
              </Stack>

              <Typography variant="body2" color="text.secondary" mb={3}>
                Каждый день в указанное время бот автоматически отправит отчёт
                по доставкам в Telegram-группу.
              </Typography>

              {currentSchedule && (
                <Box mb={2}>
                  <Chip
                    label={`Текущее время: ${currentSchedule}`}
                    color="primary"
                    variant="outlined"
                    size="small"
                  />
                </Box>
              )}

              <Stack direction="row" spacing={2} alignItems="center" mb={3}>
                <TextField
                  label="Часы (0-23)"
                  value={scheduledHour}
                  onChange={(e) => setScheduledHour(e.target.value)}
                  type="number"
                  inputProps={{ min: 0, max: 23 }}
                  sx={{ width: 140 }}
                />
                <Typography variant="h5" color="text.secondary">:</Typography>
                <TextField
                  label="Минуты (0-59)"
                  value={scheduledMinute}
                  onChange={(e) => setScheduledMinute(e.target.value)}
                  type="number"
                  inputProps={{ min: 0, max: 59 }}
                  sx={{ width: 140 }}
                />
              </Stack>

              <Button
                variant="contained"
                startIcon={saving ? <CircularProgress size={16} color="inherit" /> : saveSuccess ? <CheckIcon /> : <ScheduleIcon />}
                onClick={handleSaveSchedule}
                disabled={saving}
                color={saveSuccess ? 'success' : 'primary'}
              >
                {saving ? 'Сохранение...' : saveSuccess ? 'Сохранено!' : 'Сохранить расписание'}
              </Button>
            </CardContent>
          </Card>
        </Grid>

        {/* Send now */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1} mb={2}>
                <SendIcon color="secondary" />
                <Typography variant="h6" fontWeight={600}>
                  Отправить сейчас
                </Typography>
              </Stack>

              <Typography variant="body2" color="text.secondary" mb={3}>
                Немедленная отправка отчёта по доставкам за сегодня в Telegram-группу.
                Отчёт содержит статистику по каждому курьеру и общее число доставок.
              </Typography>

              <Divider sx={{ mb: 3 }} />

              <Button
                variant="contained"
                color="secondary"
                size="large"
                startIcon={sending ? <CircularProgress size={16} color="inherit" /> : sendSuccess ? <CheckIcon /> : <SendIcon />}
                onClick={handleSendNow}
                disabled={sending}
                sx={{ color: 'white' }}
              >
                {sending ? 'Отправка...' : sendSuccess ? 'Отправлено!' : 'Отправить отчёт сейчас'}
              </Button>
            </CardContent>
          </Card>
        </Grid>

        {/* Error/success */}
        {error && (
          <Grid item xs={12}>
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          </Grid>
        )}

        {/* Info card */}
        <Grid item xs={12}>
          <Card sx={{ bgcolor: 'primary.50', border: '1px solid', borderColor: 'primary.200' }}>
            <CardContent>
              <Typography variant="subtitle2" fontWeight={600} mb={1} color="primary.main">
                Что входит в отчёт
              </Typography>
              <Typography variant="body2" color="text.secondary">
                • Список каждого курьера и количество выполненных заказов за день<br />
                • Общее количество заказов за день<br />
                • Отправка в Telegram-группу автоматически
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default TelegramReport;
