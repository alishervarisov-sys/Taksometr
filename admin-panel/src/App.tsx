import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Couriers from './pages/Couriers';
import Tariffs from './pages/Tariffs';
import Deliveries from './pages/Deliveries';
import MapView from './pages/MapView';
import Statistics from './pages/Statistics';
import Commission from './pages/Commission';
import Credentials from './pages/Credentials';
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

  useEffect(() => {
    const savedAdminId = localStorage.getItem('adminId');
    if (savedAdminId) {
      setIsAuthenticated(true);
      setAdminId(savedAdminId);
    }
  }, []);

  const handleLogin = (id: string) => {
    setIsAuthenticated(true);
    setAdminId(id);
    localStorage.setItem('adminId', id);
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setAdminId(null);
    localStorage.removeItem('adminId');
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
            <Route path="/" element={<Layout onLogout={handleLogout} />}>
              <Route index element={<Dashboard adminId={adminId!} />} />
              <Route path="couriers" element={<Couriers adminId={adminId!} />} />
              <Route path="tariffs" element={<Tariffs adminId={adminId!} />} />
              <Route path="deliveries" element={<Deliveries />} />
              <Route path="map" element={<MapView adminId={adminId!} />} />
              <Route path="statistics" element={<Statistics adminId={adminId!} />} />
              <Route path="commission" element={<Commission adminId={adminId!} />} />
              <Route path="credentials" element={<Credentials adminId={adminId!} />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Route>
          )}
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
