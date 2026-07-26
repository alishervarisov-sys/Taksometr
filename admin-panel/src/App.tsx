import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Couriers from './pages/Couriers';
import Tariffs from './pages/Tariffs';
import Deliveries from './pages/Deliveries';
import Clients from './pages/Clients';
import MapView from './pages/MapView';
import Statistics from './pages/Statistics';
import Analytics from './pages/Analytics';
import Commission from './pages/Commission';
import Credentials from './pages/Credentials';
import Admins from './pages/Admins';
import Winner from './pages/Winner';
import TelegramReport from './pages/TelegramReport';
import Taxi from './pages/Taxi';
import TaxiDrivers from './pages/TaxiDrivers';
import Login from './pages/Login';

const theme = createTheme({
  palette: {
    primary: {
      main: '#1B5E20',
      light: '#4C8C4A',
      dark: '#003300',
    },
    secondary: {
      main: '#FFC107',
    },
    background: {
      default: '#F5F5F5',
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          textTransform: 'none',
          fontWeight: 600,
        },
      },
    },
  },
});

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminId, setAdminId] = useState<string | null>(null);
  const [adminRole, setAdminRole] = useState<'ADMIN' | 'SUPER_ADMIN' | null>(null);

  useEffect(() => {
    const savedAdminId = localStorage.getItem('adminId');
    const savedRole = localStorage.getItem('adminRole') as 'ADMIN' | 'SUPER_ADMIN' | null;
    if (savedAdminId && savedRole) {
      setIsAuthenticated(true);
      setAdminId(savedAdminId);
      setAdminRole(savedRole);
    }
  }, []);

  const handleLogin = (id: string, role: 'ADMIN' | 'SUPER_ADMIN') => {
    setIsAuthenticated(true);
    setAdminId(id);
    setAdminRole(role);
    localStorage.setItem('adminId', id);
    localStorage.setItem('adminRole', role);
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setAdminId(null);
    setAdminRole(null);
    localStorage.removeItem('adminId');
    localStorage.removeItem('adminRole');
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          {!isAuthenticated ? (
            <>
              <Route path="/login" element={<Login onLogin={handleLogin} />} />
              <Route path="*" element={<Navigate to="/login" />} />
            </>
          ) : (
            <Route path="/" element={<Layout onLogout={handleLogout} isSuperAdmin={adminRole === 'SUPER_ADMIN'} />}>
              <Route index element={<Dashboard adminId={adminId!} />} />
              <Route path="couriers" element={<Couriers adminId={adminId!} />} />
              <Route path="winner" element={<Winner adminId={adminId!} />} />
              <Route path="tariffs" element={<Tariffs adminId={adminId!} />} />
              <Route path="deliveries" element={<Deliveries adminId={adminId!} />} />
              <Route path="clients" element={<Clients adminId={adminId!} />} />
              {/* Delivery chains removed */}
              <Route path="map" element={<MapView adminId={adminId!} />} />
              <Route path="statistics" element={<Statistics adminId={adminId!} />} />
              <Route path="analytics" element={<Analytics adminId={adminId!} />} />
              <Route path="commission" element={<Commission adminId={adminId!} />} />
              <Route path="credentials" element={<Credentials adminId={adminId!} />} />
              {adminRole === 'SUPER_ADMIN' && (
                <Route path="admins" element={<Admins />} />
              )}
              <Route path="telegram-report" element={<TelegramReport adminId={adminId!} />} />
              <Route path="taxi" element={<Taxi adminId={adminId!} />} />
              <Route path="taxi-drivers" element={<TaxiDrivers adminId={adminId!} />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Route>
          )}
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
