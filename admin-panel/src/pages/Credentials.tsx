import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Card, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, IconButton, TextField, Button, Dialog,
  DialogTitle, DialogContent, DialogActions, Alert, Chip, InputAdornment
} from '@mui/material';
import { Edit, Visibility, VisibilityOff } from '@mui/icons-material';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';

interface CredentialsProps {
  adminId: string;
}

interface Courier {
  id: string;
  name: string;
  login: string;
  phone: string;
  isBlocked: boolean;
}

const Credentials: React.FC<CredentialsProps> = ({ adminId }) => {
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedCourier, setSelectedCourier] = useState<Courier | null>(null);
  const [newLogin, setNewLogin] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    loadCouriers();
  }, []);

  const loadCouriers = async () => {
    const q = query(collection(db, 'users'), where('role', '==', 'COURIER'));
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map(d => ({
      id: d.id,
      name: d.data().name || '',
      login: d.data().login || '',
      phone: d.data().phone || '',
      isBlocked: d.data().isBlocked || false,
    }));
    setCouriers(data);
  };

  const handleEdit = (courier: Courier) => {
    setSelectedCourier(courier);
    setNewLogin(courier.login);
    setNewPassword('');
    setShowPassword(false);
    setError('');
    setEditOpen(true);
  };

  const handleSave = async () => {
    if (!selectedCourier) return;
    setLoading(true);
    setError('');
    try {
      const fn = httpsCallable(functions, 'updateCourierCredentials');
      await fn({
        adminId,
        courierId: selectedCourier.id,
        login: newLogin !== selectedCourier.login ? newLogin : undefined,
        password: newPassword || undefined,
      });
      setSuccess(`Данные курьера "${selectedCourier.name}" обновлены`);
      setEditOpen(false);
      loadCouriers();
    } catch (err: any) {
      setError(err.message || 'Ошибка обновления');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 3 }}>
        Логины и пароли курьеров
      </Typography>

      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Имя</TableCell>
                <TableCell>Логин</TableCell>
                <TableCell>Пароль</TableCell>
                <TableCell>Телефон</TableCell>
                <TableCell>Статус</TableCell>
                <TableCell>Действие</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {couriers.map((courier) => (
                <TableRow key={courier.id}>
                  <TableCell sx={{ fontWeight: 600 }}>{courier.name}</TableCell>
                  <TableCell>
                    <Chip label={courier.login} variant="outlined" size="small" />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      ••••••••
                    </Typography>
                  </TableCell>
                  <TableCell>{courier.phone}</TableCell>
                  <TableCell>
                    {courier.isBlocked ? (
                      <Chip label="Заблокирован" color="error" size="small" />
                    ) : (
                      <Chip label="Активен" color="success" size="small" />
                    )}
                  </TableCell>
                  <TableCell>
                    <IconButton
                      color="primary"
                      onClick={() => handleEdit(courier)}
                      title="Изменить логин/пароль"
                    >
                      <Edit />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Edit dialog */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Изменить данные: {selectedCourier?.name}</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Логин"
            value={newLogin}
            onChange={(e) => setNewLogin(e.target.value)}
            margin="normal"
          />
          <TextField
            fullWidth
            label="Новый пароль (оставьте пустым чтобы не менять)"
            type={showPassword ? 'text' : 'password'}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            margin="normal"
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? <VisibilityOff /> : <Visibility />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
          {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>Отмена</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={loading || (!newPassword && newLogin === selectedCourier?.login)}
          >
            Сохранить
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Credentials;
