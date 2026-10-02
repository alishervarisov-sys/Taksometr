import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AdminBalanceAlerts } from './BalanceRequests';
import {
  Box, Drawer, AppBar, Toolbar, Typography, List, ListItem,
  ListItemButton, ListItemIcon, ListItemText, IconButton, Divider
} from '@mui/material';
import {
  Dashboard as DashboardIcon,
  People as PeopleIcon,
  LocalShipping as DeliveryIcon,
  AttachMoney as TariffIcon,
  Map as MapIcon,
  Timeline as TimelineIcon,
  BarChart as StatsIcon,
  Insights as AnalyticsIcon,
  Menu as MenuIcon,
  Logout as LogoutIcon,
  AccountBalanceWallet as WalletIcon,
  VpnKey as KeyIcon,
  AdminPanelSettings as AdminIcon,
  AccountTree as TreeIcon,
  Telegram as TelegramIcon,
  LocalTaxi as TaxiIcon,
  Groups as ClientsIcon,
  EmojiEvents as TrophyIcon,
  SystemUpdate as SystemUpdateIcon,
  AutoAwesome as SmartDispatchIcon,
} from '@mui/icons-material';

const drawerWidth = 260;

interface LayoutProps {
  onLogout: () => void;
  isSuperAdmin: boolean;
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ onLogout, isSuperAdmin, children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const menuItems = [
    { text: 'Dashboard', icon: <DashboardIcon />, path: '/' },
    { text: 'Курьеры', icon: <PeopleIcon />, path: '/couriers' },
    { text: 'Победитель месяца', icon: <TrophyIcon sx={{ color: '#FFC107' }} />, path: '/winner' },
    { text: 'Доставки', icon: <DeliveryIcon />, path: '/deliveries' },
    { text: 'Smart Dispatch', icon: <SmartDispatchIcon />, path: '/smart-dispatch' },
    { text: 'Клиенты', icon: <ClientsIcon />, path: '/clients' },
    { text: 'Тарифы', icon: <TariffIcon />, path: '/tariffs' },
    { text: 'Комиссия', icon: <WalletIcon />, path: '/commission' },
    { text: 'Логины', icon: <KeyIcon />, path: '/credentials' },
    ...(isSuperAdmin ? [{ text: 'Админы', icon: <AdminIcon />, path: '/admins' }] : []),
    { text: 'Карта', icon: <MapIcon />, path: '/map' },
    { text: 'Трекинг', icon: <TimelineIcon />, path: '/tracking' },
    { text: 'Статистика', icon: <StatsIcon />, path: '/statistics' },
    { text: 'Аналитика', icon: <AnalyticsIcon />, path: '/analytics' },
    { text: 'Telegram Отчёт', icon: <TelegramIcon />, path: '/telegram-report' },
    { text: 'TAXI', icon: <TaxiIcon sx={{ color: '#3786F6' }} />, path: '/taxi', taxiItem: true },
    { text: 'Таксисты', icon: <PeopleIcon sx={{ color: '#3786F6' }} />, path: '/taxi-drivers', taxiItem: true },
    { text: 'Версии', icon: <SystemUpdateIcon />, path: '/app-versions' },
  ];

  const drawer = (
    <Box>
      <Toolbar>
        <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.main' }}>
          ZaKi Admin
        </Typography>
      </Toolbar>
      <Divider />
      <List>
        {menuItems.map((item) => (
          <ListItem key={item.text} disablePadding>
            <ListItemButton
              selected={location.pathname === item.path}
              onClick={() => {
                navigate(item.path);
                setMobileOpen(false);
              }}
              sx={{
                mx: 1,
                borderRadius: 2,
                ...(item.taxiItem && {
                  '& .MuiListItemText-primary': { fontWeight: 700, color: '#3786F6' },
                }),
                '&.Mui-selected': {
                  backgroundColor: 'primary.main',
                  color: 'white',
                  '& .MuiListItemIcon-root': { color: 'white' },
                  '& .MuiListItemText-primary': { color: 'white', fontWeight: 700 },
                  '&:hover': { backgroundColor: 'primary.dark' },
                },
              }}
            >
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText primary={item.text} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
      <Divider />
      <List>
        <ListItem disablePadding>
          <ListItemButton onClick={onLogout} sx={{ mx: 1, borderRadius: 2 }}>
            <ListItemIcon><LogoutIcon /></ListItemIcon>
            <ListItemText primary="Выход" />
          </ListItemButton>
        </ListItem>
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex' }}>
      <AppBar
        position="fixed"
        sx={{
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          ml: { sm: `${drawerWidth}px` },
          backgroundColor: 'white',
          color: 'text.primary',
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        }}
      >
        <Toolbar>
          <IconButton
            edge="start"
            onClick={() => setMobileOpen(!mobileOpen)}
            sx={{ mr: 2, display: { sm: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap sx={{ fontWeight: 600 }}>
            {menuItems.find(i => i.path === location.pathname)?.text || 'ZaKi Admin'}
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <AdminBalanceAlerts />
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          sx={{ display: { xs: 'block', sm: 'none' }, '& .MuiDrawer-paper': { width: drawerWidth } }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{ display: { xs: 'none', sm: 'block' }, '& .MuiDrawer-paper': { width: drawerWidth } }}
          open
        >
          {drawer}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          p: 3,
          width: { xs: '100%', sm: `calc(100% - ${drawerWidth}px)` },
          mt: 8,
          minHeight: '100vh',
        }}
      >
        {children}
      </Box>
    </Box>
  );
};

export default Layout;
