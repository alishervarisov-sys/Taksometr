import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Card, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Button, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, Chip, IconButton, Switch, FormControlLabel,
  Alert, Grid, Paper, Divider
} from '@mui/material';
import { Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { collection, getDocs, query, where, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';

interface Admin {
  id: string;
  login: string;
  passwordPlain: string;
  name: string;
  email?: string;
  permissions: {
    couriers: boolean;
    deliveries: boolean;
    tariffs: boolean;
    commission: boolean;
    credentials: boolean;
    map: boolean;
    statistics: boolean;
  };
  createdAt: number;
}

const defaultPermissions = {
  couriers: true,
  deliveries: true,
  tariffs: true,
  commission: true,
  credentials: true,
  map: true,
  statistics: true,
};

const Admins: React.FC = () => {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<Admin | null>(null);
  const [formData, setFormData] = useState({
    login: '',
    password: '',
    name: '',
    email: '',
    permissions: { ...defaultPermissions },
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadAdmins();
  }, []);

  const loadAdmins = async () => {
    const q = query(collection(db, 'users'), where('role', '==', 'ADMIN'));
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map(d => ({
      id: d.id,
      ...d.data(),
      permissions: d.data().permissions || defaultPermissions,
    })) as Admin[];
    setAdmins(data);
  };

  const handleOpenDialog = (admin?: Admin) => {
    if (admin) {
      setEditingAdmin(admin);
      setFormData({
        login: admin.login,
        password: admin.passwordPlain || '',
        name: admin.name,
        email: admin.email || '',
        permissions: admin.permissions || defaultPermissions,
      });
    } else {
      setEditingAdmin(null);
      setFormData({
        login: '',
        password: '',
        name: '',
        email: '',
        permissions: { ...defaultPermissions },
      });
    }
    setDialogOpen(true);
    setError('');
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingAdmin(null);
    setError('');
  };

  const hashPassword = async (password: string): Promise<string> => {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleSave = async () => {
    if (!formData.login || !formData.password || !formData.name) {
      setError('Заполните обязательные поля: логин, пароль, имя');
      return;
    }

    try {
      const passwordHash = await hashPassword(formData.password);

      if (editingAdmin) {
        // Update existing admin
        const adminRef = doc(db, 'users', editingAdmin.id);
        await updateDoc(adminRef, {
          login: formData.login,
          passwordHash: passwordHash,
          passwordPlain: formData.password,
          name: formData.name,
          email: formData.email,
          permissions: formData.permissions,
        });
        setSuccess('Администратор обновлён');
      } else {
        // Create new admin
        // Check if login exists
        const existingQ = query(
          collection(db, 'users'),
          where('login', '==', formData.login)
        );
        const existingSnapshot = await getDocs(existingQ);
        if (!existingSnapshot.empty) {
          setError('Логин уже занят');
          return;
        }

        await addDoc(collection(db, 'users'), {
          login: formData.login,
          passwordHash: passwordHash,
          passwordPlain: formData.password,
          name: formData.name,
          email: formData.email,
          role: 'ADMIN',
          permissions: formData.permissions,
          createdAt: Date.now(),
          isOnline: false,
          isBlocked: false,
        });
        setSuccess('Администратор создан');
      }

      handleCloseDialog();
      loadAdmins();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError('Ошибка: ' + err.message);
    }
  };

  const handleDelete = async (adminId: string) => {
    if (!window.confirm('Удалить этого администратора?')) return;

    try {
      await deleteDoc(doc(db, 'users', adminId));
      setSuccess('Администратор удалён');
      loadAdmins();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError('Ошибка удаления: ' + err.message);
    }
  };

  const handlePermissionChange = (key: keyof typeof defaultPermissions) => {
    setFormData({
      ...formData,
      permissions: {
        ...formData.permissions,
        [key]: !formData.permissions[key],
      },
    });
  };

  const getPermissionsChips = (permissions: typeof defaultPermissions) => {
    const enabled = Object.entries(permissions)
      .filter(([_, value]) => value)
      .map(([key]) => key);
    
    if (enabled.length === Object.keys(defaultPermissions).length) {
      return <Chip label="Все права" color="success" size="small" />;
    }
    
    return (
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
        {enabled.map(key => (
          <Chip key={key} label={getPermissionLabel(key)} size="small" />
        ))}
      </Box>
    );
  };

  const getPermissionLabel = (key: string): string => {
    const labels: { [key: string]: string } = {
      couriers: 'Курьеры',
      deliveries: 'Доставки',
      tariffs: 'Тарифы',
      commission: 'Комиссия',
      credentials: 'Логины',
      map: 'Карта',
      statistics: 'Статистика',
    };
    return labels[key] || key;
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Управление администраторами
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpenDialog()}>
          Добавить админа
        </Button>
      </Box>

      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Имя</TableCell>
                <TableCell>Логин</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Права доступа</TableCell>
                <TableCell>Дата создания</TableCell>
                <TableCell align="right">Действия</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {admins.map((admin) => (
                <TableRow key={admin.id} hover>
                  <TableCell>{admin.name}</TableCell>
                  <TableCell>{admin.login}</TableCell>
                  <TableCell>{admin.email || '—'}</TableCell>
                  <TableCell>{getPermissionsChips(admin.permissions)}</TableCell>
                  <TableCell>
                    {new Date(admin.createdAt).toLocaleDateString('ru-RU')}
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" color="primary" onClick={() => handleOpenDialog(admin)}>
                      <EditIcon />
                    </IconButton>
                    <IconButton size="small" color="error" onClick={() => handleDelete(admin.id)}>
                      <DeleteIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {admins.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">
                      Нет администраторов
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <DialogTitle>
          {editingAdmin ? 'Редактировать администратора' : 'Новый администратор'}
        </DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Имя *"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Логин *"
                value={formData.login}
                onChange={(e) => setFormData({ ...formData, login: e.target.value })}
                disabled={!!editingAdmin}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Пароль *"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                helperText={editingAdmin ? 'Оставьте пустым, чтобы не менять' : ''}
              />
            </Grid>

            <Grid item xs={12}>
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
                Права доступа
              </Typography>
            </Grid>

            <Grid item xs={12}>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Grid container spacing={2}>
                  {Object.entries(defaultPermissions).map(([key, _]) => (
                    <Grid item xs={12} sm={6} md={4} key={key}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={formData.permissions[key as keyof typeof defaultPermissions]}
                            onChange={() => handlePermissionChange(key as keyof typeof defaultPermissions)}
                          />
                        }
                        label={getPermissionLabel(key)}
                      />
                    </Grid>
                  ))}
                </Grid>
              </Paper>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Отмена</Button>
          <Button onClick={handleSave} variant="contained">
            {editingAdmin ? 'Сохранить' : 'Создать'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Admins;
