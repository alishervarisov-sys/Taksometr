import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, Typography, TextField, Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Grid, Divider, MenuItem, Stack, CircularProgress, FormControlLabel, Switch,
} from '@mui/material';
import { GoogleMap, MarkerF } from '@react-google-maps/api';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import {
  ClientPhoneAutocomplete, AddressAutocomplete, fetchClientRecentAddresses,
  AddressSuggestion, PhoneSuggestion, RecentDelivery,
} from './OrderAutocomplete';
import { getSavedAddressPoint, saveAddressPoint } from '../utils/orderAddressPoints';

interface CreateOrderDialogProps {
  adminId: string;
  isLoaded: boolean;
  couriers: Array<{ id: string; name: string }>;
  deliveryTypeOptions: Array<{ value: string; label: string; hint: string }>;
  recentDeliveries: RecentDelivery[];
  onClose: () => void;
  onCreated: () => void;
}

const MAP_STYLE = { width: '100%', height: '100%' };
const MAP_OPTIONS = { streetViewControl: false, mapTypeControl: false };

// Text input must not update Google Maps options, click listeners or markers.
const CreateOrderMap = memo(function CreateOrderMap({ center, pickupLat, pickupLng, destinationLat, destinationLng, onPick }: {
  center: { lat: number; lng: number };
  pickupLat: string;
  pickupLng: string;
  destinationLat: string;
  destinationLng: string;
  onPick: (lat: number, lng: number) => void;
}) {
  return (
    <Box sx={{ height: 300, borderRadius: 2, overflow: 'hidden', border: '1px solid #ddd' }}>
      <GoogleMap mapContainerStyle={MAP_STYLE} center={center} zoom={13} options={MAP_OPTIONS}
        onClick={(e) => { const lat = e.latLng?.lat(); const lng = e.latLng?.lng(); if (lat != null && lng != null) onPick(lat, lng); }}>
        {pickupLat && pickupLng && <MarkerF position={{ lat: Number(pickupLat), lng: Number(pickupLng) }} label="A" />}
        {destinationLat && destinationLng && <MarkerF position={{ lat: Number(destinationLat), lng: Number(destinationLng) }} label="B" />}
      </GoogleMap>
    </Box>
  );
});

// Keep draft state here: a keystroke should never render the deliveries table.
const CreateOrderDialog: React.FC<CreateOrderDialogProps> = ({
  adminId, isLoaded, couriers, deliveryTypeOptions, recentDeliveries, onClose, onCreated,
}) => {
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [mapPickerMode, setMapPickerMode] = useState<'pickup' | 'destination' | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number }>(() => {
    try {
      const saved = localStorage.getItem('zaki_admin_map_center');
      if (saved) return JSON.parse(saved);
    } catch {}
    return { lat: 38.5598, lng: 68.7740 }; // Dushanbe fallback
  });
  const [createForm, setCreateForm] = useState({
    clientPhone: '',
    comment: '',
    courierId: '',
    deliveryType: 'default',
    pickupAddress: '',
    pickupLat: '',
    pickupLng: '',
    destinationAddress: '',
    destinationLat: '',
    destinationLng: '',
    acceptanceLimitMinutes: '10',
    requiresRecipientCode: false,
    requiresDeliveryPhoto: false,
  });
  // Saved addresses of the client picked from autocomplete (phone → addresses).
  const [clientAddresses, setClientAddresses] = useState<AddressSuggestion[]>([]);
  const [loadingClientAddresses, setLoadingClientAddresses] = useState(false);
  // Guards against a stale address/coordinates pair: 'autocomplete' means the
  // current lat/lng came from a selected address; editing the address text
  // afterwards invalidates them. 'map' means the point was picked on the map.
  const coordSourceRef = useRef<{ pickup: 'autocomplete' | 'map' | null; destination: 'autocomplete' | 'map' | null }>({ pickup: null, destination: null });
  const selectedAddressRef = useRef<{ pickup: string | null; destination: string | null }>({ pickup: null, destination: null });
  const createFormRef = useRef(createForm);
  createFormRef.current = createForm;
  const clientAddressSeqRef = useRef(0);
  useEffect(() => () => { clientAddressSeqRef.current += 1; }, []);

  const handleMapPick = useCallback((lat: number, lng: number) => {
    if (!mapPickerMode) return;
    const center = { lat, lng };
    setMapCenter(center);
    localStorage.setItem('zaki_admin_map_center', JSON.stringify(center));
    if (mapPickerMode === 'pickup') {
      saveAddressPoint(createFormRef.current.pickupAddress, lat, lng);
      setCreateForm(prev => ({ ...prev, pickupLat: String(lat), pickupLng: String(lng) }));
      coordSourceRef.current.pickup = 'map';
    }
    if (mapPickerMode === 'destination') {
      saveAddressPoint(createFormRef.current.destinationAddress, lat, lng);
      setCreateForm(prev => ({ ...prev, destinationLat: String(lat), destinationLng: String(lng) }));
      coordSourceRef.current.destination = 'map';
    }
  }, [mapPickerMode]);

  // Prefer the point that an admin corrected manually for this address. This
  // prevents an old, inaccurate historical order from moving the marker back.
  const applyAddressSuggestion = (field: 'pickup' | 'destination', s: AddressSuggestion) => {
    const savedPoint = getSavedAddressPoint(s.address);
    const point = savedPoint || s;
    setCreateForm(prev => field === 'pickup'
      ? { ...prev, pickupAddress: s.address, pickupLat: String(point.latitude), pickupLng: String(point.longitude) }
      : { ...prev, destinationAddress: s.address, destinationLat: String(point.latitude), destinationLng: String(point.longitude) });
    coordSourceRef.current[field] = 'autocomplete';
    selectedAddressRef.current[field] = s.address;
    const center = { lat: point.latitude, lng: point.longitude };
    setMapCenter(center);
    localStorage.setItem('zaki_admin_map_center', JSON.stringify(center));
  };

  // Manual typing: if the user edits an address previously filled from
  // autocomplete, the old coordinates no longer match — drop them.
  const handleAddressInputChange = (field: 'pickup' | 'destination', text: string) => {
    const selected = selectedAddressRef.current[field];
    const invalidatePoint = coordSourceRef.current[field] === 'autocomplete' &&
      selected != null && text.trim() !== selected.trim();
    if (invalidatePoint) {
      coordSourceRef.current[field] = null;
      selectedAddressRef.current[field] = null;
    }
    setCreateForm(prev => {
      const next = field === 'pickup' ? { ...prev, pickupAddress: text } : { ...prev, destinationAddress: text };
      if (invalidatePoint) {
        if (field === 'pickup') { next.pickupLat = ''; next.pickupLng = ''; }
        else { next.destinationLat = ''; next.destinationLng = ''; }
      }
      return next;
    });
  };

  const handleClientPhoneInput = (phone: string) => {
    clientAddressSeqRef.current += 1;
    setCreateForm(prev => ({ ...prev, clientPhone: phone }));
    setClientAddresses([]);
    setLoadingClientAddresses(false);
  };

  // Phone → client's saved addresses (from their order history).
  const handleClientSelect = async (s: PhoneSuggestion) => {
    const seq = ++clientAddressSeqRef.current;
    setCreateForm(prev => ({ ...prev, clientPhone: s.phone }));
    setClientAddresses([]);
    setLoadingClientAddresses(true);
    try {
      const addresses = await fetchClientRecentAddresses(s.phone);
      if (seq === clientAddressSeqRef.current) setClientAddresses(addresses);
    } catch {
      if (seq === clientAddressSeqRef.current) setClientAddresses([]);
    } finally {
      if (seq === clientAddressSeqRef.current) setLoadingClientAddresses(false);
    }
  };

  const closeCreateDialog = () => {
    if (!isCreatingOrder) onClose();
  };

  const handleCreateMarketplaceOrder = async () => {
    if (!createForm.clientPhone || !createForm.pickupLat || !createForm.pickupLng) {
      alert('Заполните телефон клиента и точку "Откуда"');
      return;
    }

    const hasDestination = !!createForm.destinationLat && !!createForm.destinationLng;
    const acceptanceLimitMinutes = Number(createForm.acceptanceLimitMinutes);
    if (!Number.isInteger(acceptanceLimitMinutes) || acceptanceLimitMinutes < 1 || acceptanceLimitMinutes > 1440) {
      alert('Время на принятие должно быть целым числом от 1 до 1440 минут');
      return;
    }

    try {
      setIsCreatingOrder(true);
      const createFn = httpsCallable(functions, 'adminCreateMarketplaceDelivery');
      const result: any = await createFn({
        adminId,
        clientPhone: createForm.clientPhone,
        comment: createForm.comment,
        // Optional: assign the order directly to a chosen courier. Empty => free order.
        courierId: createForm.courierId || null,
        // Delivery type the courier would pick when starting the meter.
        deliveryType: createForm.deliveryType || 'default',
        acceptanceLimitMinutes,
        requiresRecipientCode: createForm.requiresRecipientCode,
        requiresDeliveryPhoto: createForm.requiresDeliveryPhoto,
        pickup: {
          address: createForm.pickupAddress,
          latitude: Number(createForm.pickupLat),
          longitude: Number(createForm.pickupLng),
        },
        destination: hasDestination ? {
          address: createForm.destinationAddress,
          latitude: Number(createForm.destinationLat),
          longitude: Number(createForm.destinationLng),
        } : null,
      });
      if (result?.data?.smartDispatch) {
        alert('✅ Заказ создан. Smart Dispatch ищет подходящего курьера.');
      } else if (result?.data?.assignedCourierId) {
        alert(`✅ Заказ создан и предложен курьеру: ${result.data.assignedCourierName || ''}`);
      } else {
        alert(`✅ Заказ создан. Доступно курьеров: ${result?.data?.availableCouriers ?? 0}`);
      }
      onCreated();
    } catch (error: any) {
      alert('Ошибка создания заказа: ' + (error.message || 'Неизвестная ошибка'));
    } finally {
      setIsCreatingOrder(false);
    }
  };

  return (
    <Dialog open onClose={closeCreateDialog} maxWidth="md" fullWidth>
      <DialogTitle>Создать заказ</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid item xs={12} md={6}>
            <ClientPhoneAutocomplete
              value={createForm.clientPhone}
              onInputChange={handleClientPhoneInput}
              onSelect={handleClientSelect}
              recentDeliveries={recentDeliveries}
            />
          </Grid>
          <Grid item xs={12} md={6}><TextField fullWidth label="Комментарий" value={createForm.comment} onChange={(e) => setCreateForm(prev => ({ ...prev, comment: e.target.value }))} /></Grid>
          {(loadingClientAddresses || clientAddresses.length > 0) && (
            <Grid item xs={12}>
              <Box sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Последние адреса клиента:</Typography>
                {loadingClientAddresses ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CircularProgress size={18} />
                    <Typography variant="body2" color="text.secondary">Загрузка адресов...</Typography>
                  </Box>
                ) : (
                  <Stack spacing={0.5}>
                    {clientAddresses.map(a => (
                      <Stack key={a.address} direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }}>
                        <Typography variant="body2" sx={{ flex: 1 }}>{a.address}</Typography>
                        <Stack direction="row" spacing={1}>
                          <Button size="small" variant="outlined" onClick={() => applyAddressSuggestion('pickup', a)}>Откуда</Button>
                          <Button size="small" variant="outlined" onClick={() => applyAddressSuggestion('destination', a)}>Куда</Button>
                        </Stack>
                      </Stack>
                    ))}
                  </Stack>
                )}
              </Box>
            </Grid>
          )}
          <Grid item xs={12}>
            <TextField
              select
              fullWidth
              label="Курьер (необязательно)"
              value={createForm.courierId}
              onChange={(e) => setCreateForm(prev => ({ ...prev, courierId: e.target.value }))}
              helperText={createForm.courierId ? 'Заказ увидит только выбранный курьер и должен принять его' : 'Не выбрано — заказ увидят все курьеры'}
            >
              <MenuItem value="">Не назначать (свободный заказ)</MenuItem>
              {couriers.map(c => (
                <MenuItem key={c.id} value={c.id}>{c.name || c.id}</MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12}>
            <TextField
              select
              fullWidth
              label="Тип доставки"
              value={createForm.deliveryType}
              onChange={(e) => setCreateForm(prev => ({ ...prev, deliveryType: e.target.value }))}
              helperText="Тот же тип, что курьер выбирает при включении счётчика"
            >
              {deliveryTypeOptions.map(opt => (
                <MenuItem key={opt.value} value={opt.value}>
                  <Box>
                    <Typography component="span" sx={{ fontWeight: 600 }}>{opt.label}</Typography>
                    <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>— {opt.hint}</Typography>
                  </Box>
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              required
              type="number"
              label="Время на принятие, мин"
              value={createForm.acceptanceLimitMinutes}
              onChange={(e) => setCreateForm(prev => ({ ...prev, acceptanceLimitMinutes: e.target.value }))}
              inputProps={{ min: 1, max: 1440, step: 1 }}
              helperText="По умолчанию 10 минут; по истечении таймер курьера станет красным"
            />
          </Grid>
          <Grid item xs={12}>
            <Typography fontWeight={600}>Подтверждение вручения</Typography>
            <Stack>
              <FormControlLabel label="Код от получателя" control={<Switch checked={createForm.requiresRecipientCode} onChange={e => setCreateForm(prev => ({ ...prev, requiresRecipientCode: e.target.checked }))} />} />
              <FormControlLabel label="Фото вручения" control={<Switch checked={createForm.requiresDeliveryPhoto} onChange={e => setCreateForm(prev => ({ ...prev, requiresDeliveryPhoto: e.target.checked }))} />} />
            </Stack>
            <Typography variant="body2" color="text.secondary">Код придёт получателю в SMS после принятия заказа. Курьер выполнит выбранные подтверждения перед завершением. Можно включить оба.</Typography>
          </Grid>
          <Grid item xs={12}>
            {isLoaded && (
              <CreateOrderMap center={mapCenter}
                pickupLat={createForm.pickupLat} pickupLng={createForm.pickupLng}
                destinationLat={createForm.destinationLat} destinationLng={createForm.destinationLng}
                onPick={handleMapPick} />
            )}
          </Grid>
          <Grid item xs={12}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
              <Button variant={mapPickerMode === 'pickup' ? 'contained' : 'outlined'} onClick={() => setMapPickerMode('pickup')}>Выбрать точку "Откуда"</Button>
              <Button variant={mapPickerMode === 'destination' ? 'contained' : 'outlined'} onClick={() => setMapPickerMode('destination')}>Выбрать точку "Куда"</Button>
            </Stack>
          </Grid>
          <Grid item xs={12}><Divider>Откуда (обязательно)</Divider></Grid>
          <Grid item xs={12}>
            <AddressAutocomplete
              label="Адрес откуда"
              value={createForm.pickupAddress}
              onInputChange={(t) => handleAddressInputChange('pickup', t)}
              onSelect={(s) => applyAddressSuggestion('pickup', s)}
              recentDeliveries={recentDeliveries}
            />
          </Grid>
          <Grid item xs={12} md={6}><TextField fullWidth label="Широта" value={createForm.pickupLat} onChange={(e) => setCreateForm(prev => ({ ...prev, pickupLat: e.target.value }))} /></Grid>
          <Grid item xs={12} md={6}><TextField fullWidth label="Долгота" value={createForm.pickupLng} onChange={(e) => setCreateForm(prev => ({ ...prev, pickupLng: e.target.value }))} /></Grid>
          <Grid item xs={12}><Divider>Куда (необязательно)</Divider></Grid>
          <Grid item xs={12}>
            <AddressAutocomplete
              label="Адрес куда"
              value={createForm.destinationAddress}
              onInputChange={(t) => handleAddressInputChange('destination', t)}
              onSelect={(s) => applyAddressSuggestion('destination', s)}
              recentDeliveries={recentDeliveries}
            />
          </Grid>
          <Grid item xs={12} md={6}><TextField fullWidth label="Широта" value={createForm.destinationLat} onChange={(e) => setCreateForm(prev => ({ ...prev, destinationLat: e.target.value }))} /></Grid>
          <Grid item xs={12} md={6}><TextField fullWidth label="Долгота" value={createForm.destinationLng} onChange={(e) => setCreateForm(prev => ({ ...prev, destinationLng: e.target.value }))} /></Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={closeCreateDialog} disabled={isCreatingOrder}>Отмена</Button>
        <Button variant="contained" onClick={handleCreateMarketplaceOrder} disabled={isCreatingOrder}>{isCreatingOrder ? 'Создание...' : 'Создать заказ'}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default CreateOrderDialog;
