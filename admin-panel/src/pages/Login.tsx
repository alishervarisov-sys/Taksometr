import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box, Card, CardContent, TextField, Button, Typography, Alert, CircularProgress
} from '@mui/material';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

interface LoginProps {
  onLogin: (adminId: string, role: 'ADMIN' | 'SUPER_ADMIN') => void;
}

const SUPER_ADMIN_EMAIL = 'alishervarisov@gmail.com';
const SUPER_ADMIN_PASSWORD = 'abubakr1986';

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const finishLogin = (id: string, role: 'ADMIN' | 'SUPER_ADMIN') => {
    const returnTo = location.state?.returnTo;
    onLogin(id, role);
    navigate(typeof returnTo === 'string' && /^\/commission(?:\?|$)/.test(returnTo) ? returnTo : '/', { replace: true });
  };
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Check for super admin first (email-based)
      if (login === SUPER_ADMIN_EMAIL && password === SUPER_ADMIN_PASSWORD) {
        // Super admin login
        finishLogin('SUPER_ADMIN', 'SUPER_ADMIN');
        setLoading(false);
        return;
      }

      // Hash password for regular admins
      const encoder = new TextEncoder();
      const data = encoder.encode(password);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      const q = query(
        collection(db, 'users'),
        where('login', '==', login),
        where('passwordHash', '==', hashHex),
        where('role', '==', 'ADMIN')
      );

      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        setError('Неверный логин или пароль, или нет прав администратора');
        setLoading(false);
        return;
      }

      const adminDoc = snapshot.docs[0];
      finishLogin(adminDoc.id, 'ADMIN');
    } catch (err: any) {
      setError('Ошибка входа: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #F4F8FF 0%, #EAF4FF 100%)',
      }}
    >
      <Card sx={{ maxWidth: 400, width: '100%', mx: 2, borderRadius: 4 }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h4" align="center" sx={{ fontWeight: 700, color: 'primary.main', mb: 1 }}>
            ZaKi Admin
          </Typography>
          <Typography variant="body2" align="center" color="text.secondary" sx={{ mb: 3 }}>
            Панель управления
          </Typography>

          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth
              label="Логин"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              margin="normal"
              required
            />
            <TextField
              fullWidth
              label="Пароль"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              margin="normal"
              required
            />

            {error && (
              <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>
            )}

            <Button
              type="submit"
              fullWidth
              variant="contained"
              size="large"
              disabled={loading}
              sx={{ mt: 3, py: 1.5 }}
            >
              {loading ? <CircularProgress size={24} /> : 'Войти'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
};

export default Login;
