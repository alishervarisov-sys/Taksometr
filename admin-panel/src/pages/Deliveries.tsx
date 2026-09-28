import React, { useEffect, useRef, useState } from 'react';
import {
  Box, Typography, Card, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, TextField, InputAdornment, Dialog,
  DialogTitle, DialogContent, DialogActions, Button, Grid, Divider,
  MenuItem, ToggleButtonGroup, ToggleButton, Stack, Alert, CircularProgress
} from '@mui/material';
import {
  ClientPhoneAutocomplete, AddressAutocomplete, fetchClientRecentAddresses,
  AddressSuggestion, PhoneSuggestion,
} from '../components/OrderAutocomplete';
import { Edit, Search } from '@mui/icons-material';
import { collection, getDocs, query, orderBy, limit, doc, getDoc, where, onSnapshot, startAfter, QueryDocumentSnapshot, DocumentData, QueryConstraint } from 'firebase/firestore';
import { GoogleMap, useJsApiLoader, PolylineF, MarkerF } from '@react-google-maps/api';
import { db, GOOGLE_MAPS_API_KEY, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';

interface Delivery {
  id: string;
  courierId: string;
  courierName: string;
  clientPhone: string;
  status: string;
  distanceMeters: number;
  cost: number;
  liveCost?: number;
  commission: number;
  waitingMinutes: number;
  waitingCost: number;
  startTime: number;
  endTime: number | null;
  createdAt: number;
  route: Array<{ latitude: number; longitude: number }>;
  orderKind?: string;
  deliveryType?: string;
  fixedPrice?: number | null;
  adminOrderStage?: string;
  comment?: string;
  courierPhone?: string;
  pickup?: { address?: string; latitude: number; longitude: number };
  destination?: { address?: string; latitude: number; longitude: number };
  currentSpeedKmh?: number;
  maxSpeedKmh?: number;
  acceptanceLimitMinutes?: number;
  acceptanceDurationMs?: number | null;
}

interface CourierOption {
  id: string;
  name: string;
}

interface CourierLocation {
  latitude: number;
  longitude: number;
  timestamp?: number;
}

type Period = 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'custom';
type ReportType = 'commission' | 'earnings';

interface DeliveriesProps {
  adminId: string;
}

interface OrderFormState {
  clientPhone: string;
  comment: string;
  courierId: string;
  deliveryType: string;
  fixedPrice: string;
  pickupAddress: string;
  pickupLat: string;
  pickupLng: string;
  destinationAddress: string;
  destinationLat: string;
  destinationLng: string;
  acceptanceLimitMinutes: string;
}

interface SavedAddressPoint {
  latitude: number;
  longitude: number;
  updatedAt: number;
}

const SAVED_ADDRESS_POINTS_KEY = 'zaki_admin_saved_address_points';
const MAX_SAVED_ADDRESS_POINTS = 300;

const normalizeAddressKey = (address: string) => address.trim().toLowerCase().replace(/\s+/g, ' ');

function getSavedAddressPoint(address: string): SavedAddressPoint | null {
  const key = normalizeAddressKey(address);
  if (!key) return null;
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_ADDRESS_POINTS_KEY) || '{}') as Record<string, SavedAddressPoint>;
    const point = saved[key];
    return point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude) ? point : null;
  } catch {
    return null;
  }
}

function saveAddressPoint(address: string, latitude: number, longitude: number) {
  const key = normalizeAddressKey(address);
  if (!key || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_ADDRESS_POINTS_KEY) || '{}') as Record<string, SavedAddressPoint>;
    saved[key] = { latitude, longitude, updatedAt: Date.now() };
    const entries = Object.entries(saved);
    if (entries.length > MAX_SAVED_ADDRESS_POINTS) {
      entries
        .sort(([, a], [, b]) => a.updatedAt - b.updatedAt)
        .slice(0, entries.length - MAX_SAVED_ADDRESS_POINTS)
        .forEach(([oldKey]) => delete saved[oldKey]);
    }
    localStorage.setItem(SAVED_ADDRESS_POINTS_KEY, JSON.stringify(saved));
  } catch {
    // The order can still be created if the browser blocks local storage.
  }
}

const Deliveries: React.FC<DeliveriesProps> = ({ adminId }) => {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [liveCourierLocation, setLiveCourierLocation] = useState<CourierLocation | null>(null);
  const [couriers, setCouriers] = useState<CourierOption[]>([]);
  const [selectedCourier, setSelectedCourier] = useState('all');
  // Default 'today': the deliveries table opens with today's orders only.
  // The toggle also filters the live table immediately (not just the report).
  const [period, setPeriod] = useState<Period>('today');
  // Custom date range ("от" — "до") for the 'custom' period, as yyyy-MM-dd strings.
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [reportType, setReportType] = useState<ReportType>('earnings');
  const [reportResult, setReportResult] = useState<{ total: number; count: number } | null>(null);
  // Deliveries fetched from Firestore for the calculated report period. When set,
  // the table shows this snapshot instead of the live (limit 200) subscription.
  const [reportDeliveries, setReportDeliveries] = useState<Delivery[] | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [problemDeliveries, setProblemDeliveries] = useState<Delivery[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Delivery | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editMapPickerMode, setEditMapPickerMode] = useState<'pickup' | 'destination' | null>(null);
  const [editForm, setEditForm] = useState<OrderFormState>({
    clientPhone: '', comment: '', courierId: '', deliveryType: 'default', fixedPrice: '',
    pickupAddress: '', pickupLat: '', pickupLng: '', destinationAddress: '', destinationLat: '', destinationLng: '', acceptanceLimitMinutes: '10',
  });
  const [changingStatusId, setChangingStatusId] = useState<string | null>(null);
  const [changingStageId, setChangingStageId] = useState<string | null>(null);
  // Manual assignment / reassignment of an order to a specific courier.
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignMode, setAssignMode] = useState<'assign' | 'reassign'>('assign');
  const [assignTarget, setAssignTarget] = useState<Delivery | null>(null);
  const [assignCourierId, setAssignCourierId] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const [mapPickerMode, setMapPickerMode] = useState<'pickup' | 'destination' | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number }>(() => {
    try {
      const saved = localStorage.getItem('zaki_admin_map_center');
      if (saved) return JSON.parse(saved);
    } catch {}
    return { lat: 38.5598, lng: 68.7740 }; // Dushanbe fallback
  });
  // Fixed-price delivery types configured in tariffs/default.fixedTypes.
  // Mirrors exactly what a courier sees when starting the meter.
  const [fixedTypes, setFixedTypes] = useState<Record<string, number>>({});
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
  });
  // Saved addresses of the client picked from autocomplete (phone → addresses).
  const [clientAddresses, setClientAddresses] = useState<AddressSuggestion[]>([]);
  const [loadingClientAddresses, setLoadingClientAddresses] = useState(false);
  // Guards against a stale address/coordinates pair: 'autocomplete' means the
  // current lat/lng came from a selected address; editing the address text
  // afterwards invalidates them. 'map' means the point was picked on the map.
  const coordSourceRef = useRef<{ pickup: 'autocomplete' | 'map' | null; destination: 'autocomplete' | 'map' | null }>({ pickup: null, destination: null });
  const selectedAddressRef = useRef<{ pickup: string | null; destination: string | null }>({ pickup: null, destination: null });
  const editCoordSourceRef = useRef<{ pickup: 'autocomplete' | 'map' | 'existing' | null; destination: 'autocomplete' | 'map' | 'existing' | null }>({ pickup: null, destination: null });
  const editSelectedAddressRef = useRef<{ pickup: string | null; destination: string | null }>({ pickup: null, destination: null });

  // Delivery type options, built the same way as the courier app: two metered
  // options always available, plus each fixed type whose price is configured (> 0).
  const formatSomoni = (v: number) => {
    const s = Math.floor(v); const d = Math.round((v - s) * 100);
    return d > 0 ? `${s}.${String(d).padStart(2, '0')} сомони` : `${s} сомони`;
  };
  const FIXED_TYPE_LABELS: Record<string, string> = {
    coal: 'Уголь',
    gas15: 'Газ до 15л',
    gas30: 'Газ до 30л',
    gas30plus: 'Газ более 30л',
    errands: 'Различные поручения',
    heavyCargo: 'Тяжелые грузы',
  };
  const FIXED_TYPE_ORDER = ['coal', 'gas15', 'gas30', 'gas30plus', 'errands', 'heavyCargo'];
  const deliveryTypeOptions: Array<{ value: string; label: string; hint: string }> = [
    { value: 'default', label: 'По счётчику (обычная)', hint: 'Оплата по километражу' },
    { value: 'heavyCargoMeter', label: 'Тяжёлые грузы (по счётчику)', hint: 'Оплата по километражу (тариф тяжёлых грузов)' },
    ...FIXED_TYPE_ORDER
      .filter((key) => (fixedTypes[key] ?? 0) > 0)
      .map((key) => ({
        value: key,
        label: FIXED_TYPE_LABELS[key] || key,
        hint: `Фиксированная цена: ${formatSomoni(fixedTypes[key])}`,
      })),
  ];

  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
  });

  useEffect(() => {
    // Real-time subscription: status changes (from admin panel, courier app,
    // or backend) propagate here asynchronously without manual reload.
    const q = query(collection(db, 'deliveries'), orderBy('createdAt', 'desc'), limit(200));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Delivery[];
      setDeliveries(data);
    });
    loadCouriers();
    loadFixedTypes();
    return () => unsubscribe();
  }, []);

  // Keep the open detail dialog in sync with live updates.
  useEffect(() => {
    setSelectedDelivery(prev => {
      if (!prev) return prev;
      const updated = deliveries.find(d => d.id === prev.id);
      return updated ? { ...prev, ...updated } : prev;
    });
  }, [deliveries]);

  // While viewing an active order, keep the courier marker in sync with the
  // location the courier app writes to users/{courierId}.lastLocation.
  useEffect(() => {
    if (!detailOpen || selectedDelivery?.status !== 'IN_PROGRESS' || !selectedDelivery.courierId) {
      setLiveCourierLocation(null);
      return;
    }

    return onSnapshot(doc(db, 'users', selectedDelivery.courierId), (snapshot) => {
      const location = snapshot.data()?.lastLocation;
      if (
        typeof location?.latitude === 'number' &&
        typeof location?.longitude === 'number'
      ) {
        setLiveCourierLocation({
          latitude: location.latitude,
          longitude: location.longitude,
          timestamp: typeof location.timestamp === 'number' ? location.timestamp : undefined,
        });
      } else {
        setLiveCourierLocation(null);
      }
    }, (error) => {
      console.error('[Deliveries] Не удалось получить текущую геопозицию курьера', error);
      setLiveCourierLocation(null);
    });
  }, [detailOpen, selectedDelivery?.courierId, selectedDelivery?.status]);

  const loadCouriers = async () => {
    const q = query(collection(db, 'users'), where('role', '==', 'COURIER'));
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map(d => ({ id: d.id, name: d.data().name || '' }));
    setCouriers(data);
  };

  // Load the configured fixed-price delivery types (tariffs/default.fixedTypes),
  // the same source the courier app reads for its delivery-type picker.
  const loadFixedTypes = async () => {
    try {
      const snap = await getDoc(doc(db, 'tariffs', 'default'));
      const data = snap.exists() ? (snap.data().fixedTypes || {}) : {};
      setFixedTypes(data as Record<string, number>);
    } catch {
      setFixedTypes({});
    }
  };

  const loadDeliveries = async () => {
    const q = query(collection(db, 'deliveries'), orderBy('createdAt', 'desc'), limit(200));
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Delivery[];
    setDeliveries(data);
  };

  const findProblemDeliveries = async () => {
    setIsSearching(true);
    try {
      const q = query(collection(db, 'deliveries'), where('status', '==', 'IN_PROGRESS'), limit(100));
      const snapshot = await getDocs(q);
      const inProgressDeliveries = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Delivery[];
      inProgressDeliveries.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      const now = Date.now();
      const problems = inProgressDeliveries.filter(d => {
        if (d.startTime && (now - d.startTime) > 3600000) return true;
        if (!d.route || d.route.length === 0) return true;
        if (!d.courierId || !d.courierName) return true;
        return false;
      });

      setProblemDeliveries(problems);
      alert(problems.length === 0 ? '✅ Проблемные доставки не найдены!' : `⚠️ Найдено проблемных доставок: ${problems.length}`);
    } catch (error) {
      console.error('Ошибка поиска проблемных доставок:', error);
      alert('Ошибка при поиске: ' + (error as Error).message);
    } finally {
      setIsSearching(false);
    }
  };

  const getDateRange = (p: Period): { start: number; end: number } => {
    const now = new Date();
    // End of the current local day (23:59:59.999), so orders near the day
    // boundary are not lost due to timezone/client clock differences.
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - 1;

    switch (p) {
      case 'today': {
        // Start of the current local day (00:00:00.000).
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        return { start, end: endOfToday };
      }
      case 'yesterday': {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - 1;
        return { start, end };
      }
      case 'week': {
        // Last 7 days (rolling), aligned to the start of that day.
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
        return { start, end: endOfToday };
      }
      case 'month': {
        // Calendar month: from the 1st of the current month to today inclusive.
        const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        return { start, end: endOfToday };
      }
      case 'year': {
        // Calendar year: from January 1st of the current year.
        const start = new Date(now.getFullYear(), 0, 1).getTime();
        return { start, end: endOfToday };
      }
      case 'custom': {
        // Explicit "от — до" range picked by the user. Each boundary is
        // inclusive: from 00:00:00.000 of the start date to 23:59:59.999
        // of the end date (local time).
        const fromDate = customFrom ? new Date(customFrom + 'T00:00:00') : null;
        const toDate = customTo ? new Date(customTo + 'T23:59:59.999') : null;
        return {
          start: fromDate ? fromDate.getTime() : 0,
          end: toDate ? toDate.getTime() : Number.MAX_SAFE_INTEGER,
        };
      }
      default:
        return { start: 0, end: Number.MAX_SAFE_INTEGER };
    }
  };

  // Fetch ALL deliveries within [start, end] from Firestore using cursor
  // pagination (no single huge limit). Status/courier filters are applied
  // client-side afterwards, so no composite Firestore indexes are required.
  const fetchDeliveriesInRange = async (start: number, end: number): Promise<Delivery[]> => {
    const PAGE_SIZE = 500;
    const MAX_PAGES = 40; // safety cap: 40 * 500 = 20000 docs
    const result: Delivery[] = [];
    let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const constraints: QueryConstraint[] = [
        where('createdAt', '>=', start),
        where('createdAt', '<=', end),
        orderBy('createdAt', 'desc'),
        limit(PAGE_SIZE),
      ];
      if (cursor) constraints.push(startAfter(cursor));
      const q = query(collection(db, 'deliveries'), ...constraints);
      const snapshot = await getDocs(q);
      result.push(...snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Delivery[]);
      if (snapshot.docs.length < PAGE_SIZE) return result;
      cursor = snapshot.docs[snapshot.docs.length - 1];
    }
    alert(`Загружено максимум ${MAX_PAGES * PAGE_SIZE} доставок. Итоги и таблица могут быть неполными — уточните период.`);
    return result;
  };

  const handleCalculate = async () => {
    if (period === 'custom') {
      if (!customFrom || !customTo) {
        alert('Выберите обе даты диапазона: «от» и «до»');
        return;
      }
      if (new Date(customFrom) > new Date(customTo)) {
        alert('Дата «от» не может быть позже даты «до»');
        return;
      }
    }
    setIsCalculating(true);
    try {
      const { start, end } = getDateRange(period);
      const rangeDeliveries = await fetchDeliveriesInRange(start, end);

      const filtered = rangeDeliveries.filter(d => {
        if (d.status !== 'COMPLETED') return false;
        if (selectedCourier !== 'all' && d.courierId !== selectedCourier) return false;
        return true;
      });

      const total = filtered.reduce((sum, d) => sum + (reportType === 'commission' ? (d.commission || 0) : (d.cost || 0)), 0);
      setReportResult({ total, count: filtered.length });
      // The table now shows exactly the selected period (search and courier
      // filters are applied on top of this list below).
      setReportDeliveries(rangeDeliveries);
    } catch (error) {
      console.error('Ошибка расчёта отчёта:', error);
      alert('Ошибка расчёта отчёта: ' + (error as Error).message);
    } finally {
      setIsCalculating(false);
    }
  };

  // Exit the report view and return to the live deliveries list.
  const handleResetReport = () => {
    setReportResult(null);
    setReportDeliveries(null);
  };

  // Unified status switch: works for any current status and can toggle
  // COMPLETED <-> CANCELLED at any time. Commission is handled server-side.
  const handleChangeStatus = async (delivery: Delivery, newStatus: 'COMPLETED' | 'CANCELLED') => {
    const actionWord = newStatus === 'COMPLETED' ? 'Завершить' : 'Отменить';
    const confirmMessage = `${actionWord} доставку?\n\nКурьер: ${delivery.courierName || '—'}\nКлиент: ${delivery.clientPhone || '—'}`;
    if (!window.confirm(confirmMessage)) return;

    try {
      setChangingStatusId(delivery.id);
      const setStatusFn = httpsCallable(functions, 'adminSetDeliveryStatus');
      await setStatusFn({ adminId, deliveryId: delivery.id, status: newStatus });
      // The onSnapshot listener updates the list automatically (async everywhere).
    } catch (error: any) {
      alert('Ошибка изменения статуса: ' + (error.message || 'Неизвестная ошибка'));
    } finally {
      setChangingStatusId(null);
    }
  };

  // Intermediate marketplace stages an admin can set on behalf of a courier
  // who has lost internet connectivity. COMPLETE / CANCEL are handled by the
  // status buttons (adminSetDeliveryStatus).
  const MARKETPLACE_STAGES: Array<{ value: string; label: string }> = [
    { value: 'ACCEPTED', label: 'Принят' },
    { value: 'ARRIVED_PICKUP', label: 'У точки забора' },
    { value: 'PICKED_UP', label: 'Товар забран' },
    { value: 'ON_THE_WAY', label: 'В пути к клиенту' },
    { value: 'ARRIVED_DESTINATION', label: 'У клиента' },
  ];

  const stageLabel = (stage?: string) =>
    MARKETPLACE_STAGES.find(s => s.value === stage)?.label || stage || '—';

  // Admin sets the marketplace order stage when the courier is offline.
  const handleChangeStage = async (delivery: Delivery, stage: string) => {
    if (stage === delivery.adminOrderStage) return;
    try {
      setChangingStageId(delivery.id);
      const setStageFn = httpsCallable(functions, 'adminUpdateMarketplaceStage');
      await setStageFn({ adminId, deliveryId: delivery.id, stage });
      // onSnapshot keeps the list and open dialog in sync automatically.
    } catch (error: any) {
      alert('Ошибка изменения этапа: ' + (error.message || 'Неизвестная ошибка'));
    } finally {
      setChangingStageId(null);
    }
  };

  // Open the assign/reassign dialog for a delivery.
  const openAssignDialog = (delivery: Delivery, mode: 'assign' | 'reassign') => {
    setAssignTarget(delivery);
    setAssignMode(mode);
    setAssignCourierId(mode === 'reassign' ? '' : (delivery.courierId || ''));
    setAssignOpen(true);
  };

  // Assign a free order to a courier, or move an order to another courier.
  const handleAssignSubmit = async () => {
    if (!assignTarget || !assignCourierId) {
      alert('Выберите курьера');
      return;
    }
    try {
      setAssignBusy(true);
      if (assignMode === 'assign') {
        const fn = httpsCallable(functions, 'adminAssignOrderToCourier');
        await fn({ adminId, deliveryId: assignTarget.id, courierId: assignCourierId });
      } else {
        const fn = httpsCallable(functions, 'adminReassignOrder');
        await fn({ adminId, deliveryId: assignTarget.id, newCourierId: assignCourierId });
      }
      setAssignOpen(false);
      setAssignTarget(null);
      setAssignCourierId('');
      // onSnapshot refreshes the list automatically.
    } catch (error: any) {
      alert('Ошибка назначения: ' + (error.message || 'Неизвестная ошибка'));
    } finally {
      setAssignBusy(false);
    }
  };

  // Return an order to the free (marketplace) pool so any courier can take it.
  const handleReleaseToMarketplace = async (delivery: Delivery) => {
    if (!window.confirm(
      `Вернуть заказ в свободные?\n\nЗаказ будет снят с курьера ${delivery.courierName || '—'} и станет доступен всем курьерам.`
    )) return;
    try {
      setReleasingId(delivery.id);
      const fn = httpsCallable(functions, 'adminReleaseOrderToMarketplace');
      await fn({ adminId, deliveryId: delivery.id });
    } catch (error: any) {
      alert('Ошибка возврата заказа: ' + (error.message || 'Неизвестная ошибка'));
    } finally {
      setReleasingId(null);
    }
  };

  const handleFixProblemDelivery = async (delivery: Delivery) => {
    if (!window.confirm(`Отменить проблемную доставку?\n\nКурьер: ${delivery.courierName || '—'}\nКлиент: ${delivery.clientPhone || '—'}`)) return;
    try {
      setChangingStatusId(delivery.id);
      const setStatusFn = httpsCallable(functions, 'adminSetDeliveryStatus');
      await setStatusFn({ adminId, deliveryId: delivery.id, status: 'CANCELLED' });
      setProblemDeliveries(prev => prev.filter(d => d.id !== delivery.id));
    } catch (error) {
      alert('Ошибка: ' + (error as Error).message);
    } finally {
      setChangingStatusId(null);
    }
  };

  const handleRowClick = async (delivery: Delivery) => {
    if (!delivery.route || delivery.route.length === 0) {
      try {
        const docRef = doc(db, 'deliveries', delivery.id);
        const docSnap = await getDoc(docRef);
        setSelectedDelivery(docSnap.exists() ? ({ id: docSnap.id, ...docSnap.data() } as Delivery) : delivery);
      } catch {
        setSelectedDelivery(delivery);
      }
    } else {
      setSelectedDelivery(delivery);
    }
    setDetailOpen(true);
  };

  // In report mode the table renders the period snapshot fetched from Firestore;
  // otherwise it renders the live (latest 200) subscription filtered by the
  // selected period (default: today). Search and courier filters are applied
  // on top of either source and never reset the period.
  const sourceDeliveries = reportDeliveries ?? deliveries;
  const liveRange = reportDeliveries ? null : getDateRange(period);
  const filteredDeliveries = sourceDeliveries.filter(d => {
    if (liveRange && ((d.createdAt || 0) < liveRange.start || (d.createdAt || 0) > liveRange.end)) return false;
    const matchesSearch = d.clientPhone?.includes(searchQuery) || d.courierName?.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (selectedCourier !== 'all' && d.courierId !== selectedCourier) return false;
    return true;
  });

  const handleMapPick = (lat: number, lng: number) => {
    if (!mapPickerMode) return;
    const center = { lat, lng };
    setMapCenter(center);
    localStorage.setItem('zaki_admin_map_center', JSON.stringify(center));
    if (mapPickerMode === 'pickup') {
      saveAddressPoint(createForm.pickupAddress, lat, lng);
      setCreateForm(prev => ({ ...prev, pickupLat: String(lat), pickupLng: String(lng) }));
      coordSourceRef.current.pickup = 'map';
    }
    if (mapPickerMode === 'destination') {
      saveAddressPoint(createForm.destinationAddress, lat, lng);
      setCreateForm(prev => ({ ...prev, destinationLat: String(lat), destinationLng: String(lng) }));
      coordSourceRef.current.destination = 'map';
    }
  };

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
    setCreateForm(prev => {
      const next = field === 'pickup' ? { ...prev, pickupAddress: text } : { ...prev, destinationAddress: text };
      const selected = selectedAddressRef.current[field];
      if (coordSourceRef.current[field] === 'autocomplete' && selected != null && text.trim() !== selected.trim()) {
        coordSourceRef.current[field] = null;
        selectedAddressRef.current[field] = null;
        if (field === 'pickup') { next.pickupLat = ''; next.pickupLng = ''; }
        else { next.destinationLat = ''; next.destinationLng = ''; }
      }
      return next;
    });
  };

  const handleClientPhoneInput = (phone: string) => {
    setCreateForm(prev => ({ ...prev, clientPhone: phone }));
    setClientAddresses([]);
  };

  // Phone → client's saved addresses (from their order history).
  const handleClientSelect = async (s: PhoneSuggestion) => {
    setCreateForm(prev => ({ ...prev, clientPhone: s.phone }));
    setClientAddresses([]);
    setLoadingClientAddresses(true);
    try {
      setClientAddresses(await fetchClientRecentAddresses(s.phone));
    } catch {
      setClientAddresses([]);
    } finally {
      setLoadingClientAddresses(false);
    }
  };

  const resetCreateForm = () => {
    setCreateForm({ clientPhone: '', comment: '', courierId: '', deliveryType: 'default', pickupAddress: '', pickupLat: '', pickupLng: '', destinationAddress: '', destinationLat: '', destinationLng: '', acceptanceLimitMinutes: '10' });
    setClientAddresses([]);
    coordSourceRef.current = { pickup: null, destination: null };
    selectedAddressRef.current = { pickup: null, destination: null };
  };

  const closeCreateDialog = () => {
    setCreateOpen(false);
    resetCreateForm();
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
      setCreateOpen(false);
      resetCreateForm();
      loadDeliveries();
    } catch (error: any) {
      alert('Ошибка создания заказа: ' + (error.message || 'Неизвестная ошибка'));
    } finally {
      setIsCreatingOrder(false);
    }
  };

  const openEditDialog = (delivery: Delivery) => {
    if (delivery.orderKind !== 'MARKETPLACE' || !['PENDING', 'IN_PROGRESS'].includes(delivery.status)) return;
    const pickupAddress = delivery.pickup?.address || '';
    const destinationAddress = delivery.destination?.address || '';
    setEditTarget(delivery);
    setEditForm({
      clientPhone: delivery.clientPhone || '',
      comment: delivery.comment || '',
      courierId: delivery.courierId || '',
      deliveryType: delivery.deliveryType || 'default',
      fixedPrice: delivery.fixedPrice != null ? String(delivery.fixedPrice) : '',
      pickupAddress,
      pickupLat: delivery.pickup?.latitude != null ? String(delivery.pickup.latitude) : '',
      pickupLng: delivery.pickup?.longitude != null ? String(delivery.pickup.longitude) : '',
      destinationAddress,
      destinationLat: delivery.destination?.latitude != null ? String(delivery.destination.latitude) : '',
      destinationLng: delivery.destination?.longitude != null ? String(delivery.destination.longitude) : '',
      acceptanceLimitMinutes: String(delivery.acceptanceLimitMinutes ?? 10),
    });
    editCoordSourceRef.current = {
      pickup: delivery.pickup ? 'existing' : null,
      destination: delivery.destination ? 'existing' : null,
    };
    editSelectedAddressRef.current = { pickup: pickupAddress, destination: destinationAddress };
    const point = delivery.pickup || delivery.destination;
    if (point) setMapCenter({ lat: point.latitude, lng: point.longitude });
    setEditMapPickerMode(null);
    setEditOpen(true);
  };

  const closeEditDialog = () => {
    if (isSavingEdit) return;
    setEditOpen(false);
    setEditTarget(null);
    setEditMapPickerMode(null);
  };

  const applyEditAddressSuggestion = (field: 'pickup' | 'destination', s: AddressSuggestion) => {
    const savedPoint = getSavedAddressPoint(s.address);
    const point = savedPoint || s;
    setEditForm(prev => field === 'pickup'
      ? { ...prev, pickupAddress: s.address, pickupLat: String(point.latitude), pickupLng: String(point.longitude) }
      : { ...prev, destinationAddress: s.address, destinationLat: String(point.latitude), destinationLng: String(point.longitude) });
    editCoordSourceRef.current[field] = 'autocomplete';
    editSelectedAddressRef.current[field] = s.address;
    const center = { lat: point.latitude, lng: point.longitude };
    setMapCenter(center);
    localStorage.setItem('zaki_admin_map_center', JSON.stringify(center));
  };

  const handleEditAddressInput = (field: 'pickup' | 'destination', text: string) => {
    setEditForm(prev => {
      const next = field === 'pickup' ? { ...prev, pickupAddress: text } : { ...prev, destinationAddress: text };
      const selected = editSelectedAddressRef.current[field];
      if (selected != null && text.trim() !== selected.trim()) {
        editCoordSourceRef.current[field] = null;
        editSelectedAddressRef.current[field] = null;
        if (field === 'pickup') { next.pickupLat = ''; next.pickupLng = ''; }
        else { next.destinationLat = ''; next.destinationLng = ''; }
      }
      return next;
    });
  };

  const handleEditMapPick = (lat: number, lng: number) => {
    if (!editMapPickerMode) return;
    const center = { lat, lng };
    setMapCenter(center);
    localStorage.setItem('zaki_admin_map_center', JSON.stringify(center));
    saveAddressPoint(editMapPickerMode === 'pickup' ? editForm.pickupAddress : editForm.destinationAddress, lat, lng);
    setEditForm(prev => editMapPickerMode === 'pickup'
      ? { ...prev, pickupLat: String(lat), pickupLng: String(lng) }
      : { ...prev, destinationLat: String(lat), destinationLng: String(lng) });
    editCoordSourceRef.current[editMapPickerMode] = 'map';
  };

  const handleEditDeliveryType = (value: string) => {
    const configured = fixedTypes[value];
    setEditForm(prev => ({
      ...prev,
      deliveryType: value,
      fixedPrice: value === 'adminFixedPrice'
        ? prev.fixedPrice
        : (value === 'default' || value === 'heavyCargoMeter')
          ? ''
          : (configured > 0 ? String(configured) : prev.fixedPrice),
    }));
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    if (!editForm.clientPhone.trim() || !editForm.pickupLat || !editForm.pickupLng) {
      alert('Заполните телефон клиента и точку «Откуда»');
      return;
    }
    const pickupLat = Number(editForm.pickupLat);
    const pickupLng = Number(editForm.pickupLng);
    const hasDestination = !!editForm.destinationLat && !!editForm.destinationLng;
    const destinationLat = hasDestination ? Number(editForm.destinationLat) : null;
    const destinationLng = hasDestination ? Number(editForm.destinationLng) : null;
    const fixedPrice = editForm.fixedPrice.trim() ? Number(editForm.fixedPrice) : null;
    const acceptanceLimitMinutes = Number(editForm.acceptanceLimitMinutes);
    if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng) ||
        (hasDestination && (!Number.isFinite(destinationLat) || !Number.isFinite(destinationLng)))) {
      alert('Проверьте координаты адресов');
      return;
    }
    if (fixedPrice != null && (!Number.isFinite(fixedPrice) || fixedPrice <= 0)) {
      alert('Стоимость должна быть больше нуля');
      return;
    }
    if (editForm.deliveryType === 'adminFixedPrice' && fixedPrice == null) {
      alert('Укажите фиксированную стоимость');
      return;
    }
    if (!Number.isInteger(acceptanceLimitMinutes) || acceptanceLimitMinutes < 1 || acceptanceLimitMinutes > 1440) {
      alert('Время на принятие должно быть целым числом от 1 до 1440 минут');
      return;
    }

    try {
      setIsSavingEdit(true);
      const updateFn = httpsCallable(functions, 'adminUpdateMarketplaceDelivery');
      await updateFn({
        adminId,
        deliveryId: editTarget.id,
        clientPhone: editForm.clientPhone.trim(),
        comment: editForm.comment.trim(),
        courierId: editForm.courierId || null,
        deliveryType: editForm.deliveryType,
        fixedPrice,
        acceptanceLimitMinutes,
        pickup: {
          address: editForm.pickupAddress.trim(),
          latitude: pickupLat,
          longitude: pickupLng,
        },
        destination: hasDestination ? {
          address: editForm.destinationAddress.trim(),
          latitude: destinationLat,
          longitude: destinationLng,
        } : null,
      });
      setEditOpen(false);
      setEditTarget(null);
      setEditMapPickerMode(null);
    } catch (error: any) {
      alert('Ошибка сохранения заказа: ' + (error.message || 'Неизвестная ошибка'));
    } finally {
      setIsSavingEdit(false);
    }
  };

  const getStatusChip = (status: string) => {
    switch (status) {
      case 'PENDING': return <Chip label="Ожидает курьера" color="warning" size="small" />;
      case 'COMPLETED': return <Chip label="Завершена" color="success" size="small" />;
      case 'IN_PROGRESS': return <Chip label="В процессе" color="info" size="small" />;
      case 'CANCELLED': return <Chip label="Отменена" color="error" size="small" />;
      default: return <Chip label={status} size="small" />;
    }
  };

  const formatDate = (ts: number) => ts ? new Date(ts).toLocaleString('ru-RU') : '—';
  const formatDistance = (m: number) => !m ? '0 м' : m < 1000 ? `${Math.round(m)} м` : `${(m / 1000).toFixed(1)} км`;
  const formatCost = (cost: number) => {
    const s = Math.floor(cost); const d = Math.round((cost - s) * 100);
    return d > 0 ? `${s.toLocaleString()}.${String(d).padStart(2, '0')} сомони` : `${s.toLocaleString()} сомони`;
  };
  const deliveryTypeLabel = (type?: string) => {
    if (type === 'adminFixedPrice') return 'Фиксированная цена администратора';
    return deliveryTypeOptions.find(option => option.value === (type || 'default'))?.label || type || 'По счётчику';
  };
  const formatDuration = (start: number, end: number | null) => {
    if (!start) return '—';
    const mins = Math.floor(((end || Date.now()) - start) / 60000);
    return mins >= 60 ? `${Math.floor(mins / 60)} ч ${mins % 60} мин` : `${mins} мин`;
  };
  const formatDurationMs = (durationMs: number) => {
    const totalSeconds = Math.floor(Math.max(0, durationMs) / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };
  const formatSpeed = (distanceMeters: number, startTime: number, endTime: number | null) => {
    if (!distanceMeters || !startTime || !endTime) return '—';
    const durationMs = endTime - startTime;
    if (durationMs <= 0) return '—';
    const speedKmh = (distanceMeters / 1000) / (durationMs / 3600000);
    return `${speedKmh.toFixed(1)} км/ч`;
  };
  const getMapCenter = (route: Array<{ latitude: number; longitude: number }>) => {
    if (!route || route.length === 0) return { lat: 38.5598, lng: 68.7740 };
    const mid = route[Math.floor(route.length / 2)];
    return { lat: mid.latitude, lng: mid.longitude };
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Доставки</Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="contained" onClick={() => setCreateOpen(true)}>Создать заказ</Button>
        </Stack>
      </Box>

      {problemDeliveries.length > 0 && (
        <Card sx={{ mb: 3, p: 2, bgcolor: '#ffebee', borderLeft: 4, borderColor: 'error.main' }}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5, color: 'error.main' }}>
            ⚠️ Найдено проблемных доставок: {problemDeliveries.length}
          </Typography>
          <TableContainer sx={{ bgcolor: 'white', borderRadius: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Курьер</TableCell><TableCell>Клиент</TableCell><TableCell>Начало</TableCell><TableCell>Длится</TableCell><TableCell>Проблема</TableCell><TableCell>Действие</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {problemDeliveries.map((delivery) => {
                  const now = Date.now();
                  let problemText = '';
                  if (delivery.startTime && (now - delivery.startTime) > 3600000) problemText = 'Висит > 1 часа';
                  else if (!delivery.route || delivery.route.length === 0) problemText = 'Нет маршрута';
                  else if (!delivery.courierId) problemText = 'Нет курьера';
                  return (
                    <TableRow key={delivery.id} hover>
                      <TableCell>{delivery.courierName || '—'}</TableCell>
                      <TableCell>{delivery.clientPhone || '—'}</TableCell>
                      <TableCell>{formatDate(delivery.startTime)}</TableCell>
                      <TableCell><Chip label={formatDuration(delivery.startTime, null)} size="small" color="error" /></TableCell>
                      <TableCell><Chip label={problemText} size="small" color="warning" /></TableCell>
                      <TableCell><Button size="small" variant="contained" color="error" onClick={() => handleFixProblemDelivery(delivery)}>Исправить</Button></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}

      <Card sx={{ mb: 3, p: 2, bgcolor: '#fff3e0', borderLeft: 4, borderColor: 'warning.main' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center" justifyContent="space-between">
          <Box>
            <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5, color: 'warning.dark' }}>🔍 Поиск проблемных доставок</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>Нажмите кнопку для автоматического поиска доставок которые не завершаются</Typography>
          </Box>
          <Button variant="contained" color="warning" size="large" onClick={findProblemDeliveries} disabled={isSearching} sx={{ minWidth: 200 }}>
            {isSearching ? 'Поиск...' : 'Обнаружить проблемы'}
          </Button>
        </Stack>
      </Card>

      <Card sx={{ mb: 3, p: 2 }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>Отчёт и фильтр списка</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>Период фильтрует таблицу доставок сразу. По умолчанию показываются доставки за сегодня.</Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
          <TextField select size="small" label="Курьер" value={selectedCourier} onChange={(e) => setSelectedCourier(e.target.value)} sx={{ minWidth: 180 }}>
            <MenuItem value="all">Все курьеры</MenuItem>
            {couriers.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </TextField>
          <ToggleButtonGroup value={period} exclusive size="small" onChange={(_, v) => v && setPeriod(v)}>
            <ToggleButton value="today">Сегодня</ToggleButton><ToggleButton value="yesterday">Вчера</ToggleButton><ToggleButton value="week">Неделя</ToggleButton><ToggleButton value="month">Месяц</ToggleButton><ToggleButton value="year">Год</ToggleButton><ToggleButton value="all">Все</ToggleButton><ToggleButton value="custom">От — До</ToggleButton>
          </ToggleButtonGroup>
          {period === 'custom' && (
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                size="small"
                type="date"
                label="От"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                inputProps={{ max: customTo || undefined }}
                InputLabelProps={{ shrink: true }}
                sx={{ width: 160 }}
              />
              <Typography variant="body2" color="text.secondary">—</Typography>
              <TextField
                size="small"
                type="date"
                label="До"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                inputProps={{ min: customFrom || undefined }}
                InputLabelProps={{ shrink: true }}
                sx={{ width: 160 }}
              />
            </Stack>
          )}
          <ToggleButtonGroup value={reportType} exclusive size="small" onChange={(_, v) => v && setReportType(v)}>
            <ToggleButton value="earnings">Заработок</ToggleButton><ToggleButton value="commission">Комиссия</ToggleButton>
          </ToggleButtonGroup>
          <Button variant="contained" size="small" onClick={handleCalculate} disabled={isCalculating}>
            {isCalculating ? 'Расчёт...' : 'Рассчитать'}
          </Button>
          {reportDeliveries && (
            <Button variant="outlined" size="small" onClick={handleResetReport} disabled={isCalculating}>Сбросить</Button>
          )}
          {reportResult && <Alert severity="info" sx={{ py: 0 }}>{reportType === 'commission' ? 'Комиссия' : 'Заработок'}: <strong>{formatCost(reportResult.total)}</strong> ({reportResult.count} доставок)</Alert>}
        </Stack>
      </Card>

      <TextField fullWidth placeholder="Поиск по номеру телефона или имени курьера" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} sx={{ mb: 2 }} InputProps={{ startAdornment: <InputAdornment position="start"><Search /></InputAdornment> }} />

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Дата</TableCell><TableCell>Курьер</TableCell><TableCell>Клиент</TableCell><TableCell>Тип</TableCell><TableCell>Расстояние</TableCell><TableCell>Скорость</TableCell><TableCell>Длительность</TableCell><TableCell>Стоимость</TableCell><TableCell>Статус</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredDeliveries.map((delivery) => (
                <TableRow key={delivery.id} hover sx={{ cursor: 'pointer' }} onClick={() => handleRowClick(delivery)}>
                  <TableCell>{formatDate(delivery.createdAt)}</TableCell>
                  <TableCell>{delivery.courierName}</TableCell>
                  <TableCell>{delivery.clientPhone}</TableCell>
                  <TableCell>{delivery.orderKind === 'MARKETPLACE' ? 'Админ заказ' : 'Обычный'}</TableCell>
                  <TableCell>{formatDistance(delivery.distanceMeters)}</TableCell>
                  <TableCell>{formatSpeed(delivery.distanceMeters, delivery.startTime, delivery.endTime)}</TableCell>
                  <TableCell>{delivery.status === 'COMPLETED' && delivery.startTime && delivery.endTime ? formatDuration(delivery.startTime, delivery.endTime) : '—'}</TableCell>
                  <TableCell>{delivery.fixedPrice != null && delivery.fixedPrice > 0
                    ? `${formatCost(delivery.fixedPrice)} (фикс.)`
                    : (delivery.status === 'IN_PROGRESS' && !(delivery.cost > 0))
                      ? `${formatCost(delivery.liveCost || 0)} (счётчик)`
                      : formatCost(delivery.cost || 0)}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {getStatusChip(delivery.status)}
                      {delivery.orderKind === 'MARKETPLACE' && (delivery.status === 'PENDING' || delivery.status === 'IN_PROGRESS') && (
                        <Button size="small" color="primary" variant="outlined" startIcon={<Edit />} onClick={(e) => { e.stopPropagation(); openEditDialog(delivery); }}>Изменить</Button>
                      )}
                      {delivery.status === 'COMPLETED' && (
                        <Button size="small" color="error" variant="outlined" disabled={changingStatusId === delivery.id} onClick={(e) => { e.stopPropagation(); handleChangeStatus(delivery, 'CANCELLED'); }}>Отменить</Button>
                      )}
                      {delivery.status === 'CANCELLED' && (
                        <Button size="small" color="success" variant="contained" disabled={changingStatusId === delivery.id} onClick={(e) => { e.stopPropagation(); handleChangeStatus(delivery, 'COMPLETED'); }}>Завершить</Button>
                      )}
                      {delivery.status === 'PENDING' && (
                        <Button size="small" color="primary" variant="contained" onClick={(e) => { e.stopPropagation(); openAssignDialog(delivery, 'assign'); }}>Назначить</Button>
                      )}
                      {delivery.status === 'IN_PROGRESS' && (
                        <Button size="small" color="primary" variant="outlined" onClick={(e) => { e.stopPropagation(); openAssignDialog(delivery, 'reassign'); }}>Переназначить</Button>
                      )}
                      {(delivery.status === 'IN_PROGRESS' || delivery.status === 'PENDING') && (
                        <>
                          <Button size="small" color="success" variant="contained" disabled={changingStatusId === delivery.id} onClick={(e) => { e.stopPropagation(); handleChangeStatus(delivery, 'COMPLETED'); }}>Завершить</Button>
                          <Button size="small" color="error" variant="outlined" disabled={changingStatusId === delivery.id} onClick={(e) => { e.stopPropagation(); handleChangeStatus(delivery, 'CANCELLED'); }}>Отменить</Button>
                        </>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Dialog open={assignOpen} onClose={() => setAssignOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{assignMode === 'assign' ? 'Назначить заказ курьеру' : 'Переназначить заказ'}</DialogTitle>
        <DialogContent>
          {assignTarget && (
            <Box sx={{ mb: 2, mt: 0.5 }}>
              <Typography variant="body2" color="text.secondary">Клиент: {assignTarget.clientPhone || '—'}</Typography>
              {assignTarget.pickup?.address && (
                <Typography variant="body2" color="text.secondary">Откуда: {assignTarget.pickup.address}</Typography>
              )}
              {assignMode === 'reassign' && (
                <Typography variant="body2" color="text.secondary">Сейчас у: {assignTarget.courierName || '—'}</Typography>
              )}
            </Box>
          )}
          <TextField
            select
            fullWidth
            label="Курьер"
            value={assignCourierId}
            onChange={(e) => setAssignCourierId(e.target.value)}
          >
            {couriers.map(c => (
              <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAssignOpen(false)}>Отмена</Button>
          <Button variant="contained" onClick={handleAssignSubmit} disabled={assignBusy || !assignCourierId}>
            {assignBusy ? 'Назначение...' : (assignMode === 'assign' ? 'Назначить' : 'Переназначить')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={createOpen} onClose={closeCreateDialog} maxWidth="md" fullWidth>
        <DialogTitle>Создать заказ</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12} md={6}>
              <ClientPhoneAutocomplete
                value={createForm.clientPhone}
                onInputChange={handleClientPhoneInput}
                onSelect={handleClientSelect}
                recentDeliveries={deliveries}
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
              {isLoaded && (
                <Box sx={{ height: 300, borderRadius: 2, overflow: 'hidden', border: '1px solid #ddd' }}>
                  <GoogleMap mapContainerStyle={{ width: '100%', height: '100%' }} center={mapCenter} zoom={13} options={{ streetViewControl: false, mapTypeControl: false }} onClick={(e) => { const lat = e.latLng?.lat(); const lng = e.latLng?.lng(); if (lat != null && lng != null) handleMapPick(lat, lng); }}>
                    {createForm.pickupLat && createForm.pickupLng && <MarkerF position={{ lat: Number(createForm.pickupLat), lng: Number(createForm.pickupLng) }} label="A" />}
                    {createForm.destinationLat && createForm.destinationLng && <MarkerF position={{ lat: Number(createForm.destinationLat), lng: Number(createForm.destinationLng) }} label="B" />}
                  </GoogleMap>
                </Box>
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
                recentDeliveries={deliveries}
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
                recentDeliveries={deliveries}
              />
            </Grid>
            <Grid item xs={12} md={6}><TextField fullWidth label="Широта" value={createForm.destinationLat} onChange={(e) => setCreateForm(prev => ({ ...prev, destinationLat: e.target.value }))} /></Grid>
            <Grid item xs={12} md={6}><TextField fullWidth label="Долгота" value={createForm.destinationLng} onChange={(e) => setCreateForm(prev => ({ ...prev, destinationLng: e.target.value }))} /></Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeCreateDialog}>Отмена</Button>
          <Button variant="contained" onClick={handleCreateMarketplaceOrder} disabled={isCreatingOrder}>{isCreatingOrder ? 'Создание...' : 'Создать заказ'}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={editOpen} onClose={closeEditDialog} maxWidth="md" fullWidth>
        <DialogTitle>Редактировать активный заказ</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Телефон клиента"
                value={editForm.clientPhone}
                onChange={(e) => setEditForm(prev => ({ ...prev, clientPhone: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Комментарий"
                value={editForm.comment}
                onChange={(e) => setEditForm(prev => ({ ...prev, comment: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                select
                fullWidth
                label="Курьер"
                value={editForm.courierId}
                onChange={(e) => setEditForm(prev => ({ ...prev, courierId: e.target.value }))}
                helperText={editForm.courierId ? 'Можно назначить или переназначить курьера' : 'Без курьера заказ станет свободным'}
              >
                <MenuItem value="">Свободный заказ</MenuItem>
                {couriers.map(c => <MenuItem key={c.id} value={c.id}>{c.name || c.id}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                select
                fullWidth
                label="Тип доставки"
                value={editForm.deliveryType}
                onChange={(e) => handleEditDeliveryType(e.target.value)}
              >
                {deliveryTypeOptions.map(opt => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
                {!deliveryTypeOptions.some(opt => opt.value === editForm.deliveryType) && editForm.deliveryType !== 'adminFixedPrice' && (
                  <MenuItem value={editForm.deliveryType}>{deliveryTypeLabel(editForm.deliveryType)}</MenuItem>
                )}
                <MenuItem value="adminFixedPrice">Фиксированная цена администратора</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                type="number"
                label="Фиксированная стоимость, сомони"
                value={editForm.fixedPrice}
                onChange={(e) => setEditForm(prev => ({ ...prev, fixedPrice: e.target.value }))}
                inputProps={{ min: 0, step: 0.01 }}
                helperText="Пусто — стоимость считается по счётчику; для фиксированного типа укажите цену"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                required
                type="number"
                label="Время на принятие, мин"
                value={editForm.acceptanceLimitMinutes}
                onChange={(e) => setEditForm(prev => ({ ...prev, acceptanceLimitMinutes: e.target.value }))}
                inputProps={{ min: 1, max: 1440, step: 1 }}
                helperText="Можно изменить. Зафиксированное время принятия в истории не меняется."
              />
            </Grid>
            <Grid item xs={12}>
              <Divider>Адрес забора</Divider>
            </Grid>
            <Grid item xs={12}>
              <AddressAutocomplete
                label="Адрес откуда"
                value={editForm.pickupAddress}
                onInputChange={(t) => handleEditAddressInput('pickup', t)}
                onSelect={(s) => applyEditAddressSuggestion('pickup', s)}
                recentDeliveries={deliveries}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField fullWidth label="Широта" value={editForm.pickupLat} onChange={(e) => setEditForm(prev => ({ ...prev, pickupLat: e.target.value }))} />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField fullWidth label="Долгота" value={editForm.pickupLng} onChange={(e) => setEditForm(prev => ({ ...prev, pickupLng: e.target.value }))} />
            </Grid>
            <Grid item xs={12}>
              <Divider>Адрес назначения</Divider>
            </Grid>
            <Grid item xs={12}>
              <AddressAutocomplete
                label="Адрес куда"
                value={editForm.destinationAddress}
                onInputChange={(t) => handleEditAddressInput('destination', t)}
                onSelect={(s) => applyEditAddressSuggestion('destination', s)}
                recentDeliveries={deliveries}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField fullWidth label="Широта" value={editForm.destinationLat} onChange={(e) => setEditForm(prev => ({ ...prev, destinationLat: e.target.value }))} />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField fullWidth label="Долгота" value={editForm.destinationLng} onChange={(e) => setEditForm(prev => ({ ...prev, destinationLng: e.target.value }))} />
            </Grid>
            <Grid item xs={12}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ mb: 1 }}>
                <Button variant={editMapPickerMode === 'pickup' ? 'contained' : 'outlined'} onClick={() => setEditMapPickerMode('pickup')}>Указать точку забора на карте</Button>
                <Button variant={editMapPickerMode === 'destination' ? 'contained' : 'outlined'} onClick={() => setEditMapPickerMode('destination')}>Указать точку назначения</Button>
              </Stack>
              {isLoaded && (
                <Box sx={{ height: 300, borderRadius: 2, overflow: 'hidden', border: '1px solid #ddd' }}>
                  <GoogleMap
                    mapContainerStyle={{ width: '100%', height: '100%' }}
                    center={mapCenter}
                    zoom={13}
                    options={{ streetViewControl: false, mapTypeControl: false }}
                    onClick={(e) => {
                      const lat = e.latLng?.lat(); const lng = e.latLng?.lng();
                      if (lat != null && lng != null) handleEditMapPick(lat, lng);
                    }}
                  >
                    {editForm.pickupLat && editForm.pickupLng && <MarkerF position={{ lat: Number(editForm.pickupLat), lng: Number(editForm.pickupLng) }} label="A" />}
                    {editForm.destinationLat && editForm.destinationLng && <MarkerF position={{ lat: Number(editForm.destinationLat), lng: Number(editForm.destinationLng) }} label="B" />}
                  </GoogleMap>
                </Box>
              )}
            </Grid>
            {editTarget?.status === 'IN_PROGRESS' && editTarget.pickup &&
              (String(editTarget.pickup.latitude) !== editForm.pickupLat || String(editTarget.pickup.longitude) !== editForm.pickupLng) && (
                <Grid item xs={12}>
                  <Alert severity="warning">
                    Адрес забора изменён: текущее ожидание остановится и сохранится, этап заказа вернётся к поездке на новую точку.
                  </Alert>
                </Grid>
              )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEditDialog} disabled={isSavingEdit}>Отмена</Button>
          <Button variant="contained" onClick={handleSaveEdit} disabled={isSavingEdit}>
            {isSavingEdit ? 'Сохранение...' : 'Сохранить изменения'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={detailOpen} onClose={() => setDetailOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Детали доставки
          {selectedDelivery && getStatusChip(selectedDelivery.status)}
        </DialogTitle>
        <DialogContent>
          {selectedDelivery && (
            <Box>
              {isLoaded && (selectedDelivery.route?.length > 0 || liveCourierLocation) ? (
                <Box sx={{ height: 300, borderRadius: 2, overflow: 'hidden', mb: 2 }}>
                  <GoogleMap
                    mapContainerStyle={{ width: '100%', height: '100%' }}
                    center={liveCourierLocation
                      ? { lat: liveCourierLocation.latitude, lng: liveCourierLocation.longitude }
                      : getMapCenter(selectedDelivery.route)}
                    zoom={liveCourierLocation ? 16 : 14}
                    options={{ streetViewControl: false, mapTypeControl: false }}
                  >
                    {selectedDelivery.route?.length > 0 && <>
                      <PolylineF path={selectedDelivery.route.map(p => ({ lat: p.latitude, lng: p.longitude }))} options={{ strokeColor: '#3786F6', strokeWeight: 4 }} />
                      <MarkerF position={{ lat: selectedDelivery.route[0].latitude, lng: selectedDelivery.route[0].longitude }} label="A" />
                      <MarkerF position={{ lat: selectedDelivery.route[selectedDelivery.route.length - 1].latitude, lng: selectedDelivery.route[selectedDelivery.route.length - 1].longitude }} label="B" />
                    </>}
                    {liveCourierLocation && (
                      <MarkerF
                        position={{ lat: liveCourierLocation.latitude, lng: liveCourierLocation.longitude }}
                        label="К"
                        title={`Текущая позиция: ${selectedDelivery.courierName || 'курьер'}`}
                      />
                    )}
                  </GoogleMap>
                </Box>
              ) : (
                <Box sx={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#f5f5f5', borderRadius: 2, mb: 2 }}><Typography color="text.secondary">Маршрут не доступен</Typography></Box>
              )}
              {selectedDelivery.status === 'IN_PROGRESS' && (
                <Alert severity={liveCourierLocation ? 'success' : 'info'} sx={{ mb: 2 }}>
                  {liveCourierLocation
                    ? `Курьер на карте в реальном времени. Последнее обновление: ${formatDate(liveCourierLocation.timestamp || 0)}`
                    : 'Ожидаем текущую геопозицию курьера.'}
                </Alert>
              )}
              <Grid container spacing={2}>
                <Grid item xs={6}><Typography variant="body2" color="text.secondary">Курьер</Typography><Typography fontWeight={600}>{selectedDelivery.courierName}</Typography></Grid>
                <Grid item xs={6}><Typography variant="body2" color="text.secondary">Клиент</Typography><Typography fontWeight={600}>{selectedDelivery.clientPhone}</Typography></Grid>
                <Grid item xs={6}><Typography variant="body2" color="text.secondary">Тип заказа</Typography><Typography fontWeight={600}>{selectedDelivery.orderKind === 'MARKETPLACE' ? 'Админ заказ' : 'Обычный'}</Typography></Grid>
                {selectedDelivery.orderKind === 'MARKETPLACE' && <>
                  <Grid item xs={6}><Typography variant="body2" color="text.secondary">Тариф</Typography><Typography fontWeight={600}>{deliveryTypeLabel(selectedDelivery.deliveryType)}{selectedDelivery.fixedPrice != null ? ` — ${formatCost(selectedDelivery.fixedPrice)}` : ''}</Typography></Grid>
                  <Grid item xs={6}><Typography variant="body2" color="text.secondary">Откуда</Typography><Typography fontWeight={600}>{selectedDelivery.pickup?.address || '—'}</Typography></Grid>
                  <Grid item xs={6}><Typography variant="body2" color="text.secondary">Куда</Typography><Typography fontWeight={600}>{selectedDelivery.destination?.address || '—'}</Typography></Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">Этап</Typography>
                    {selectedDelivery.status === 'IN_PROGRESS' ? (
                      <TextField
                        select
                        size="small"
                        fullWidth
                        value={MARKETPLACE_STAGES.some(s => s.value === selectedDelivery.adminOrderStage) ? selectedDelivery.adminOrderStage : ''}
                        disabled={changingStageId === selectedDelivery.id}
                        onChange={(e) => handleChangeStage(selectedDelivery, e.target.value)}
                        helperText="Можно менять, если у курьера пропал интернет"
                        sx={{ mt: 0.5 }}
                      >
                        {MARKETPLACE_STAGES.map(s => (
                          <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>
                        ))}
                      </TextField>
                    ) : (
                      <Typography fontWeight={600}>{stageLabel(selectedDelivery.adminOrderStage)}</Typography>
                    )}
                  </Grid>
                  <Grid item xs={6}><Typography variant="body2" color="text.secondary">Комментарий</Typography><Typography fontWeight={600}>{selectedDelivery.comment || '—'}</Typography></Grid>
                </>}
                <Grid item xs={12}><Divider /></Grid>
                {selectedDelivery.orderKind === 'MARKETPLACE' && (() => {
                  const limit = selectedDelivery.acceptanceLimitMinutes ?? 10;
                  const acceptanceMs = selectedDelivery.acceptanceDurationMs;
                  const elapsedMs = acceptanceMs ?? Math.max(0, Date.now() - (selectedDelivery.createdAt || Date.now()));
                  const overdue = elapsedMs >= limit * 60_000;
                  const value = `${formatDurationMs(elapsedMs)}${acceptanceMs == null ? ' (идёт)' : ' (зафиксировано)'}`;
                  return <>
                    <Grid item xs={6}><Typography variant="body2" color="text.secondary">Создан</Typography><Typography>{formatDate(selectedDelivery.createdAt)}</Typography></Grid>
                    <Grid item xs={6}><Typography variant="body2" color="text.secondary">Принятие заказа</Typography><Typography fontWeight={600} color={overdue ? 'error.main' : 'primary.main'}>{value} / лимит {limit} мин</Typography></Grid>
                    <Grid item xs={12}><Divider /></Grid>
                  </>;
                })()}
                <Grid item xs={4}><Typography variant="body2" color="text.secondary">Начало</Typography><Typography>{formatDate(selectedDelivery.startTime)}</Typography></Grid>
                <Grid item xs={4}><Typography variant="body2" color="text.secondary">Конец</Typography><Typography>{selectedDelivery.endTime ? formatDate(selectedDelivery.endTime) : 'В процессе'}</Typography></Grid>
                <Grid item xs={4}><Typography variant="body2" color="text.secondary">Длительность</Typography><Typography>{formatDuration(selectedDelivery.startTime, selectedDelivery.endTime)}</Typography></Grid>
                <Grid item xs={12}><Divider /></Grid>
                <Grid item xs={3}><Typography variant="body2" color="text.secondary">Расстояние</Typography><Typography fontWeight={600}>{formatDistance(selectedDelivery.distanceMeters)}</Typography></Grid>
                <Grid item xs={3}><Typography variant="body2" color="text.secondary">Стоимость</Typography><Typography fontWeight={600} color="green">{formatCost(selectedDelivery.fixedPrice ?? selectedDelivery.cost ?? selectedDelivery.liveCost ?? 0)}</Typography></Grid>
                <Grid item xs={3}><Typography variant="body2" color="text.secondary">Комиссия</Typography><Typography fontWeight={600} color="orange">{formatCost(selectedDelivery.commission || 0)}</Typography></Grid>
                <Grid item xs={3}><Typography variant="body2" color="text.secondary">Ожидание</Typography><Typography fontWeight={600}>{selectedDelivery.waitingMinutes ? `${Math.ceil(selectedDelivery.waitingMinutes)} мин (${formatCost(selectedDelivery.waitingCost || 0)})` : '—'}</Typography></Grid>
                <Grid item xs={3}><Typography variant="body2" color="text.secondary">Ср. скорость</Typography><Typography fontWeight={600} color="primary">{formatSpeed(selectedDelivery.distanceMeters, selectedDelivery.startTime, selectedDelivery.endTime)}</Typography></Grid>
                <Grid item xs={3}><Typography variant="body2" color="text.secondary">Макс. скорость</Typography><Typography fontWeight={600} color="error">{selectedDelivery.maxSpeedKmh != null ? `${selectedDelivery.maxSpeedKmh.toFixed(1)} км/ч` : '—'}</Typography></Grid>
                {selectedDelivery.status === 'IN_PROGRESS' && selectedDelivery.currentSpeedKmh != null && (
                  <Grid item xs={3}><Typography variant="body2" color="text.secondary">Тек. скорость</Typography><Typography fontWeight={600} color="success.main">{`${selectedDelivery.currentSpeedKmh.toFixed(1)} км/ч`}</Typography></Grid>
                )}
              </Grid>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          {selectedDelivery && selectedDelivery.status === 'COMPLETED' && (
            <Button color="error" variant="outlined" disabled={changingStatusId === selectedDelivery.id} onClick={() => handleChangeStatus(selectedDelivery, 'CANCELLED')}>Изменить на "Отменена"</Button>
          )}
          {selectedDelivery && selectedDelivery.status === 'CANCELLED' && (
            <Button color="success" variant="contained" disabled={changingStatusId === selectedDelivery.id} onClick={() => handleChangeStatus(selectedDelivery, 'COMPLETED')}>Изменить на "Завершена"</Button>
          )}
          {selectedDelivery && (selectedDelivery.status === 'IN_PROGRESS' || selectedDelivery.status === 'PENDING') && (
            <>
              {selectedDelivery.orderKind === 'MARKETPLACE' && (
                <Button color="primary" variant="contained" startIcon={<Edit />} onClick={() => openEditDialog(selectedDelivery)}>Редактировать</Button>
              )}
              <Button color="success" variant="contained" disabled={changingStatusId === selectedDelivery.id} onClick={() => handleChangeStatus(selectedDelivery, 'COMPLETED')}>Завершить</Button>
              <Button color="error" variant="outlined" disabled={changingStatusId === selectedDelivery.id} onClick={() => handleChangeStatus(selectedDelivery, 'CANCELLED')}>Отменить</Button>
            </>
          )}
          {selectedDelivery && selectedDelivery.status === 'PENDING' && (
            <Button color="primary" variant="contained" onClick={() => openAssignDialog(selectedDelivery, 'assign')}>Назначить курьеру</Button>
          )}
          {selectedDelivery && selectedDelivery.status === 'IN_PROGRESS' && (
            <>
              <Button color="primary" variant="outlined" onClick={() => openAssignDialog(selectedDelivery, 'reassign')}>Переназначить</Button>
              <Button color="warning" variant="outlined" disabled={releasingId === selectedDelivery.id} onClick={() => handleReleaseToMarketplace(selectedDelivery)}>Вернуть в свободные</Button>
            </>
          )}
          <Button onClick={() => setDetailOpen(false)}>Закрыть</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Deliveries;
