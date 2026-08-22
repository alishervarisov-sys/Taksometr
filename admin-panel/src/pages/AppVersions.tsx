import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Card, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Button, TextField, Switch, FormControlLabel,
  Alert, Chip, Grid, CircularProgress, Divider
} from '@mui/material';
import { SystemUpdate, Save, Refresh } from '@mui/icons-material';
import { doc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';

interface AppVersionsProps {
  adminId: string;
}

interface AppVersionConfig {
  minVersionCode: number;
  minVersionName: string;
  enabled: boolean;
  message: string;
  updateUrl: string;
}

interface Courier {
  id: string;
  name: string;
  surname: string;
  login: string;
  phone: string;
  appVersionCode?: number;
  appVersionName?: string;
  appVersionUpdatedAt?: number;
}

const AppVersions: React.FC<AppVersionsProps> = ({ adminId }) => {
  const [config, setConfig] = useState<AppVersionConfig>({
    minVersionCode: 1,
    minVersionName: '',
    enabled: false,
    message: '',
    updateUrl: '',
  });
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [onlyOutdated, setOnlyOutdated] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const configSnap = await getDoc(doc(db, 'settings', 'appVersion'));
      if (configSnap.exists()) {
        const d = configSnap.data();
        setConfig({
          minVersionCode: d.minVersionCode ?? 1,
          minVersionName: d.minVersionName ?? '',
          enabled: d.enabled ?? false,
          message: d.message ?? '',
          updateUrl: d.updateUrl ?? '',
        });
      }

      const q = query(collection(db, 'users'), where('role', '==', 'COURIER'));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Courier[];
      setCouriers(data);
    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSave = async () => {
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const setMinAppVersionFn = httpsCallable(functions, 'setMinAppVersion');
      await setMinAppVersionFn({
        adminId,
        minVersionCode: Number(config.minVersionCode),
        minVersionName: config.minVersionName,
        enabled: config.enabled,
        message: config.message,
        updateUrl: config.updateUrl,
      });
      setSuccess('Минимальная версия сохранена');
      loadData();
    } catch (err: any) {
      setError(err.message || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const isOutdated = (courier: Courier): boolean => {
    if (courier.appVersionCode === undefined || courier.appVersionCode === null) return true;
    return courier.appVersionCode < config.minVersionCode;
  };

  const filtered = onlyOutdated ? couriers.filter(isOutdated) : couriers;
  const outdatedCount = couriers.filter(isOutdated).length;
  const updatedCount = couriers.length - outdatedCount;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Версии приложения</Typography>
        <Button variant="outlined" startIcon={<Refresh />} onClick={loadData}>
          Обновить
        </Button>
      </Box>

      <Card sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <SystemUpdate color="primary" /> Минимальная версия
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={6} sm={3}>
            <TextField
              fullWidth
              label="Мин. versionCode"
              type="number"
              value={config.minVersionCode}
              onChange={(e) => setConfig({ ...config, minVersionCode: Number(e.target.value) })}
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField
              fullWidth
              label="Мин. versionName"
              value={config.minVersionName}
              onChange={(e) => setConfig({ ...config, minVersionName: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Ссылка на APK / обновление"
              value={config.updateUrl}
              onChange={(e) => setConfig({ ...config, updateUrl: e.target.value })}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Сообщение в приложении"
              value={config.message}
              onChange={(e) => setConfig({ ...config, message: e.target.value })}
            />
          </Grid>
          <Grid item xs={12}>
            <FormControlLabel
              control={
                <Switch
                  checked={config.enabled}
                  onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                />
              }
              label={config.enabled ? 'Блокировка включена' : 'Блокировка выключена'}
            />
          </Grid>
        </Grid>

        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mt: 2 }}>{success}</Alert>}

        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="contained" startIcon={<Save />} onClick={handleSave} disabled={saving}>
            {saving ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </Box>
      </Card>

      <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center' }}>
        <Chip label={`Обновлено: ${updatedCount}`} color="success" />
        <Chip label={`Устарело: ${outdatedCount}`} color="error" />
        <Box sx={{ flexGrow: 1 }} />
        <FormControlLabel
          control={
            <Switch
              checked={onlyOutdated}
              onChange={(e) => setOnlyOutdated(e.target.checked)}
            />
          }
          label="Только устаревшие"
        />
      </Box>

      <Card>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Курьер</TableCell>
                  <TableCell>Логин</TableCell>
                  <TableCell>Телефон</TableCell>
                  <TableCell>Версия</TableCell>
                  <TableCell>Обновлена</TableCell>
                  <TableCell>Статус</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((courier) => {
                  const outdated = isOutdated(courier);
                  return (
                    <TableRow key={courier.id}>
                      <TableCell>{courier.name} {courier.surname}</TableCell>
                      <TableCell>{courier.login}</TableCell>
                      <TableCell>{courier.phone}</TableCell>
                      <TableCell>
                        {courier.appVersionName
                          ? `${courier.appVersionName} (${courier.appVersionCode})`
                          : '—'}
                      </TableCell>
                      <TableCell>
                        {courier.appVersionUpdatedAt
                          ? new Date(courier.appVersionUpdatedAt).toLocaleString('ru-RU')
                          : '—'}
                      </TableCell>
                      <TableCell>
                        {outdated ? (
                          <Chip label="Устарел" color="error" size="small" />
                        ) : (
                          <Chip label="Обновлён" color="success" size="small" />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Typography align="center" color="text.secondary" sx={{ py: 3 }}>
                        Нет курьеров
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>
    </Box>
  );
};

export default AppVersions;
