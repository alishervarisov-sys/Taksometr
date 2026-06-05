import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Card, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, Button, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, IconButton, MenuItem, Alert, Stack, List,
  ListItem, ListItemText, ListItemSecondaryAction, Divider, Paper
} from '@mui/material';
import { Add, Delete, DragIndicator, PlayArrow, CheckCircle, Cancel } from '@mui/icons-material';
import { collection, getDocs, query, orderBy, doc, setDoc, updateDoc, where, getDoc } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';

interface DeliveryChainItem {
  id: string;
  clientPhone: string;
  orderNumber: string;
  sequenceOrder: number;
  status: string;
  deliveryType: string;
  fixedPrice?: number;
}

interface DeliveryChain {
  id: string;
  courierId: string;
  courierName: string;
  status: string; // DRAFT, IN_PROGRESS, COMPLETED, CANCELLED
  items: DeliveryChainItem[];
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

interface Courier {
  id: string;
  name: string;
}

interface DeliveryChainsProps {
  adminId: string;
}

const DeliveryChains: React.FC<DeliveryChainsProps> = ({ adminId }) => {
  const [chains, setChains] = useState<DeliveryChain[]>([]);
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [fixedTypes, setFixedTypes] = useState<Record<string, number>>({});
  
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedChain, setSelectedChain] = useState<DeliveryChain | null>(null);
  
  const [newChain, setNewChain] = useState<{
    courierId: string;
    items: Array<{
      clientPhone: string;
      orderNumber: string;
      deliveryType: string;
    }>;
  }>({
    courierId: '',
    items: []
  });

  const [newItem, setNewItem] = useState({
    clientPhone: '',
    orderNumber: '',
    deliveryType: 'default'
  });

  useEffect(() => {
    loadChains();
    loadCouriers();
    loadTariffs();
  }, []);

  const loadChains = async () => {
    const q = query(
      collection(db, 'delivery_chains'),
      orderBy('createdAt', 'desc')
    );
    const snapshot = await getDocs(q);
    const data = await Promise.all(
      snapshot.docs.map(async (chainDoc) => {
        const chainData = chainDoc.data();
        
        // Загружаем items для каждой цепочки
        const itemsQuery = query(
          collection(db, 'chain_delivery_items'),
          where('chainId', '==', chainDoc.id),
          orderBy('sequenceOrder', 'asc')
        );
        const itemsSnapshot = await getDocs(itemsQuery);
        const items = itemsSnapshot.docs.map(d => ({
          id: d.id,
          ...d.data()
        })) as DeliveryChainItem[];

        return {
          id: chainDoc.id,
          ...chainData,
          items
        } as DeliveryChain;
      })
    );
    setChains(data);
  };

  const loadCouriers = async () => {
    const q = query(collection(db, 'users'), where('role', '==', 'COURIER'));
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map(d => ({
      id: d.id,
      name: d.data().name || ''
    }));
    setCouriers(data);
  };

  const loadTariffs = async () => {
    const docRef = doc(db, 'tariffs', 'default');
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      setFixedTypes(data.fixedTypes || {});
    }
  };

  const handleAddItem = () => {
    if (!newItem.clientPhone || !newItem.orderNumber) {
      alert('Заполните все поля');
      return;
    }
    setNewChain({
      ...newChain,
      items: [...newChain.items, { ...newItem }]
    });
    setNewItem({ clientPhone: '', orderNumber: '', deliveryType: 'default' });
  };

  const handleRemoveItem = (index: number) => {
    setNewChain({
      ...newChain,
      items: newChain.items.filter((_, i) => i !== index)
    });
  };

  const handleCreateChain = async () => {
    if (!newChain.courierId) {
      alert('Выберите курьера');
      return;
    }
    if (newChain.items.length === 0) {
      alert('Добавьте хотя бы один заказ');
      return;
    }

    try {
      const createChainFn = httpsCallable(functions, 'adminCreateDeliveryChain');
      await createChainFn({
        adminId: adminId,
        courierId: newChain.courierId,
        items: newChain.items
      });

      alert('✅ Цепочка создана и запущена!');
      setCreateDialogOpen(false);
      setNewChain({ courierId: '', items: [] });
      loadChains();
    } catch (error: any) {
      console.error('Ошибка создания цепочки:', error);
      alert('Ошибка: ' + (error.message || 'Не удалось создать цепочку'));
    }
  };

  const handleCancelChain = async (chainId: string) => {
    if (!window.confirm('Отменить эту цепочку?')) return;
    
    try {
      const cancelChainFn = httpsCallable(functions, 'adminCancelDeliveryChain');
      await cancelChainFn({
        adminId: adminId,
        chainId: chainId
      });
      
      alert('✅ Цепочка отменена');
      loadChains();
    } catch (error: any) {
      console.error('Ошибка отмены цепочки:', error);
      alert('Ошибка: ' + (error.message || 'Не удалось отменить цепочку'));
    }
  };

  const getStatusChip = (status: string) => {
    switch (status) {
      case 'DRAFT': return <Chip label="Черновик" color="default" size="small" />;
      case 'IN_PROGRESS': return <Chip label="Выполняется" color="info" size="small" />;
      case 'COMPLETED': return <Chip label="Завершена" color="success" size="small" />;
      case 'CANCELLED': return <Chip label="Отменена" color="error" size="small" />;
      default: return <Chip label={status} size="small" />;
    }
  };

  const getItemStatusChip = (status: string) => {
    switch (status) {
      case 'PENDING': return <Chip label="Ожидает" color="default" size="small" />;
      case 'IN_PROGRESS': return <Chip label="В процессе" color="info" size="small" />;
      case 'COMPLETED': return <Chip label="Завершено" color="success" size="small" />;
      case 'CANCELLED': return <Chip label="Отменено" color="error" size="small" />;
      default: return <Chip label={status} size="small" />;
    }
  };

  const formatDate = (ts: number) => ts ? new Date(ts).toLocaleString('ru-RU') : '—';

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Деревья заказов</Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setCreateDialogOpen(true)}
        >
          Создать дерево заказов
        </Button>
      </Box>

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Дата создания</TableCell>
                <TableCell>Курьер</TableCell>
                <TableCell>Заказов</TableCell>
                <TableCell>Завершено</TableCell>
                <TableCell>Статус</TableCell>
                <TableCell>Действия</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {chains.map((chain) => {
                const completed = chain.items.filter(i => i.status === 'COMPLETED').length;
                return (
                  <TableRow key={chain.id} hover>
                    <TableCell>{formatDate(chain.createdAt)}</TableCell>
                    <TableCell>{chain.courierName}</TableCell>
                    <TableCell>{chain.items.length}</TableCell>
                    <TableCell>{completed} / {chain.items.length}</TableCell>
                    <TableCell>{getStatusChip(chain.status)}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1}>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => {
                            setSelectedChain(chain);
                            setDetailDialogOpen(true);
                          }}
                        >
                          Детали
                        </Button>
                        {chain.status === 'IN_PROGRESS' && (
                          <Button
                            size="small"
                            color="error"
                            variant="outlined"
                            onClick={() => handleCancelChain(chain.id)}
                          >
                            Отменить
                          </Button>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
              {chains.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    <Typography color="text.secondary" sx={{ py: 4 }}>
                      Нет деревьев заказов
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Диалог создания */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Создать дерево заказов</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <TextField
              select
              fullWidth
              label="Курьер"
              value={newChain.courierId}
              onChange={(e) => setNewChain({ ...newChain, courierId: e.target.value })}
              sx={{ mb: 3 }}
            >
              <MenuItem value="">Выберите курьера</MenuItem>
              {couriers.map((c) => (
                <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
              ))}
            </TextField>

            <Divider sx={{ my: 2 }}>
              <Typography variant="subtitle2" color="text.secondary">Заказы</Typography>
            </Divider>

            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 2 }}>Добавить заказ</Typography>
              <Stack spacing={2}>
                <TextField
                  select
                  fullWidth
                  label="Тип доставки"
                  value={newItem.deliveryType}
                  onChange={(e) => setNewItem({ ...newItem, deliveryType: e.target.value })}
                  size="small"
                >
                  <MenuItem value="default">Стандартная (по счетчику)</MenuItem>
                  {Object.entries(fixedTypes).map(([type, price]) => (
                    <MenuItem key={type} value={type}>
                      {type} — {price} сомони
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  fullWidth
                  label="Телефон клиента"
                  value={newItem.clientPhone}
                  onChange={(e) => setNewItem({ ...newItem, clientPhone: e.target.value })}
                  size="small"
                />
                <TextField
                  fullWidth
                  label="Номер заказа"
                  value={newItem.orderNumber}
                  onChange={(e) => setNewItem({ ...newItem, orderNumber: e.target.value })}
                  size="small"
                />
                <Button variant="contained" startIcon={<Add />} onClick={handleAddItem}>
                  Добавить
                </Button>
              </Stack>
            </Paper>

            {newChain.items.length > 0 && (
              <List>
                {newChain.items.map((item, index) => (
                  <ListItem key={index} divider>
                    <Box sx={{ mr: 2, fontWeight: 'bold', color: 'primary.main' }}>
                      {index + 1}
                    </Box>
                    <ListItemText
                      primary={`Заказ №${item.orderNumber}`}
                      secondary={
                        <>
                          Телефон: {item.clientPhone}<br />
                          Тип: {item.deliveryType === 'default' ? 'По счетчику' : `${item.deliveryType} (${fixedTypes[item.deliveryType] || 0} сомони)`}
                        </>
                      }
                    />
                    <ListItemSecondaryAction>
                      <IconButton edge="end" onClick={() => handleRemoveItem(index)}>
                        <Delete />
                      </IconButton>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
            )}

            {newChain.items.length === 0 && (
              <Alert severity="info">Добавьте заказы в цепочку</Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Отмена</Button>
          <Button
            variant="contained"
            startIcon={<PlayArrow />}
            onClick={handleCreateChain}
            disabled={!newChain.courierId || newChain.items.length === 0}
          >
            Создать и назначить курьеру
          </Button>
        </DialogActions>
      </Dialog>

      {/* Диалог деталей */}
      <Dialog open={detailDialogOpen} onClose={() => setDetailDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            Детали цепочки
            {selectedChain && getStatusChip(selectedChain.status)}
          </Box>
        </DialogTitle>
        <DialogContent>
          {selectedChain && (
            <Box>
              <Typography variant="body2" color="text.secondary">Курьер</Typography>
              <Typography variant="h6" sx={{ mb: 2 }}>{selectedChain.courierName}</Typography>

              <Typography variant="body2" color="text.secondary">Создано</Typography>
              <Typography sx={{ mb: 2 }}>{formatDate(selectedChain.createdAt)}</Typography>

              {selectedChain.startedAt && (
                <>
                  <Typography variant="body2" color="text.secondary">Запущено</Typography>
                  <Typography sx={{ mb: 2 }}>{formatDate(selectedChain.startedAt)}</Typography>
                </>
              )}

              <Divider sx={{ my: 2 }} />

              <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                Заказы ({selectedChain.items.length})
              </Typography>

              <List>
                {selectedChain.items.map((item, index) => (
                  <ListItem key={item.id} divider>
                    <Box sx={{ 
                      mr: 2, 
                      width: 32, 
                      height: 32, 
                      borderRadius: '50%',
                      bgcolor: 'primary.main',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 'bold'
                    }}>
                      {item.sequenceOrder}
                    </Box>
                    <ListItemText
                      primary={`Заказ №${item.orderNumber}`}
                      secondary={
                        <>
                          Телефон: {item.clientPhone}<br />
                          Тип: {item.deliveryType === 'default' ? 'По счетчику' : item.deliveryType}
                          {item.fixedPrice && ` (${item.fixedPrice} сомони)`}
                        </>
                      }
                    />
                    <ListItemSecondaryAction>
                      {getItemStatusChip(item.status)}
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailDialogOpen(false)}>Закрыть</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default DeliveryChains;
