import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Couriers from './pages/Couriers';
import Tariffs from './pages/Tariffs';
import Deliveries from './pages/Deliveries';
import Clients from './pages/Clients';
import MapView from './pages/MapView';
import Tracking from './pages/Tracking';
import Statistics from './pages/Statistics';
import Analytics from './pages/Analytics';
import Commission from './pages/Commission';
import Credentials from './pages/Credentials';
import Admins from './pages/Admins';
import Winner from './pages/Winner';
import TelegramReport from './pages/TelegramReport';
import Taxi from './pages/Taxi';
import TaxiDrivers from './pages/TaxiDrivers';
import AppVersions from './pages/AppVersions';
import SmartDispatch from './pages/SmartDispatch';
import Login from './pages/Login';
import { BalanceRequestsProvider } from './components/BalanceRequests';
import { disableAdminWebPush } from './adminPush';

const theme = createTheme({
  palette: {
    primary: {
      main: '#3786F6',
      light: '#70ABFF',
      dark: '#1E64C8',
    },
    secondary: {
      main: '#E8F2FF',
    },
    background: {
      default: '#F4F8FF',
      paper: '#FFFFFF',
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
  },
  shape: {
    borderRadius: 18,
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 20,
          boxShadow: '0 2px 12px rgba(30,100,200,0.06)',
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

type CachedPage = {
  path: string;
  render: (adminId: string) => React.ReactNode;
  superAdminOnly?: boolean;
};

const cachedPages: CachedPage[] = [
  { path: '/', render: adminId => <Dashboard adminId={adminId} /> },
  { path: '/couriers', render: adminId => <Couriers adminId={adminId} /> },
  { path: '/winner', render: adminId => <Winner adminId={adminId} /> },
  { path: '/tariffs', render: adminId => <Tariffs adminId={adminId} /> },
  { path: '/deliveries', render: adminId => <Deliveries adminId={adminId} /> },
  { path: '/smart-dispatch', render: adminId => <SmartDispatch adminId={adminId} /> },
  { path: '/clients', render: adminId => <Clients adminId={adminId} /> },
  { path: '/map', render: adminId => <MapView adminId={adminId} /> },
  { path: '/tracking', render: adminId => <Tracking adminId={adminId} /> },
  { path: '/statistics', render: adminId => <Statistics adminId={adminId} /> },
  { path: '/analytics', render: adminId => <Analytics adminId={adminId} /> },
  { path: '/commission', render: adminId => <Commission adminId={adminId} /> },
  { path: '/credentials', render: adminId => <Credentials adminId={adminId} /> },
  { path: '/admins', render: () => <Admins />, superAdminOnly: true },
  { path: '/telegram-report', render: adminId => <TelegramReport adminId={adminId} /> },
  { path: '/taxi', render: adminId => <Taxi adminId={adminId} /> },
  { path: '/taxi-drivers', render: adminId => <TaxiDrivers adminId={adminId} /> },
  { path: '/app-versions', render: adminId => <AppVersions adminId={adminId} /> },
];

interface CachedAdminShellProps {
  adminId: string;
  isSuperAdmin: boolean;
  onLogout: () => void;
}

const CachedAdminShell: React.FC<CachedAdminShellProps> = ({ adminId, isSuperAdmin, onLogout }) => {
  const location = useLocation();
  const allowedPages = cachedPages.filter(page => !page.superAdminOnly || isSuperAdmin);
  const activePage = allowedPages.find(page => page.path === location.pathname) ?? allowedPages[0];
  const [visitedPaths, setVisitedPaths] = useState<Set<string>>(() => new Set([activePage.path]));

  useEffect(() => {
    setVisitedPaths(previous => {
      if (previous.has(activePage.path)) return previous;
      return new Set(previous).add(activePage.path);
    });
  }, [activePage.path]);

  // Pages are mounted only after their first visit and then kept alive. This
  // retains their UI state, Firestore listeners and IndexedDB-backed data, so
  // switching back to a visited section is immediate.
  const pagesToRender = visitedPaths.has(activePage.path)
    ? visitedPaths
    : new Set(visitedPaths).add(activePage.path);

  return (
    <BalanceRequestsProvider key={adminId} adminId={adminId}>
    <Layout onLogout={onLogout} isSuperAdmin={isSuperAdmin}>
      {Array.from(pagesToRender).map(path => {
        const page = allowedPages.find(item => item.path === path);
        if (!page) return null;
        return (
          <div key={path} style={{ display: path === activePage.path ? 'block' : 'none' }}>
            {page.render(adminId)}
          </div>
        );
      })}
    </Layout>
    </BalanceRequestsProvider>
  );
};

function App() {
  // Restore synchronously so a push deep link is not redirected to /login
  // before the cached session has been loaded.
  const [initialSession] = useState<{ id: string | null; role: 'ADMIN' | 'SUPER_ADMIN' | null }>(() => {
    const id = localStorage.getItem('adminId');
    const savedRole = localStorage.getItem('adminRole');
    const role = savedRole === 'ADMIN' || savedRole === 'SUPER_ADMIN' ? savedRole : null;
    return { id, role };
  });
  const [isAuthenticated, setIsAuthenticated] = useState(!!initialSession.id && !!initialSession.role);
  const [adminId, setAdminId] = useState<string | null>(initialSession.id);
  const [adminRole, setAdminRole] = useState<'ADMIN' | 'SUPER_ADMIN' | null>(initialSession.role);

  const handleLogin = (id: string, role: 'ADMIN' | 'SUPER_ADMIN') => {
    setIsAuthenticated(true);
    setAdminId(id);
    setAdminRole(role);
    localStorage.setItem('adminId', id);
    localStorage.setItem('adminRole', role);
  };

  const handleLogout = async () => {
    if (adminId) await disableAdminWebPush(adminId).catch(() => {});
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
              <Route path="*" element={<Navigate to="/login" replace state={{ returnTo: window.location.pathname + window.location.search }} />} />
            </>
          ) : (
            <Route path="*" element={
              <CachedAdminShell
                adminId={adminId!}
                isSuperAdmin={adminRole === 'SUPER_ADMIN'}
                onLogout={handleLogout}
              />
            } />
          )}
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
