import React, { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
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
  BarChart as StatsIcon,
  Menu as MenuIcon,
  Logout as LogoutIcon,
  AccountBalanceWallet as WalletIcon
} from '@mui/icons-material';

const drawerWidth = 260;

interface LayoutProps {
  onLogout: () => void;
}

const menuItems = [
  { text: 'Dashboard', icon: <DashboardIcon />, path: '/' },
  { text: 'Курьеры', icon: <PeopleIcon />, path: '/couriers' },
  { text: 'Доставки', icon: <DeliveryIcon />, path: '/deliveries' },
  { text: 'Тарифы', icon: <TariffIcon />, path: '/tariffs' },
  { text: 'Комиссия', icon: <WalletIcon />, path: '/commission' },
  { text: 'Карта', icon: <MapIcon />, path: '/map' },
  { text: 'Статистика', icon: <StatsIcon />, path: '/statistics' },
];

const Layout: React.FC<LayoutProps> = ({ onLogout }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

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
                '&.Mui-selected': {
                  backgroundColor: 'primary.main',
                  color: 'white',
                  '& .MuiListItemIcon-root': { color: 'white' },
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
          p: 3,
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          mt: 8,
          minHeight: '100vh',
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
};

export default Layout;
