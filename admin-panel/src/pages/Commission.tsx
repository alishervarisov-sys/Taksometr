import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Typography, Card, CardContent, TextField, Button, Alert, Grid,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Dialog, DialogTitle, DialogContent, DialogActions, Chip, IconButton,
  InputAdornment, Tooltip, Autocomplete, Select, MenuItem, InputLabel,
  FormControl, Stack, LinearProgress, Switch, FormControlLabel, Divider,
} from '@mui/material';
import {
  Add, Save, Edit, FilterList, FilterAltOff, Stairs, Delete,
} from '@mui/icons-material';
import {
  doc, getDoc, collection, query, where, getDocs, orderBy, limit, startAfter,
  QueryConstraint, QueryDocumentSnapshot, DocumentData,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useSearchParams } from 'react-router-dom';
import { db, functions } from '../firebase';

interface CommissionProps {
  adminId: string;
}

interface Courier {
  id: string;
  name: string;
  phone: string;
  balance: number;
  commissionPercent?: number;
  commissionLadderEnabled?: boolean;
  ladderCount?: number;
  ladderDate?: string;
}

interface LadderTierDraft {
  threshold: string;
  percent: string;
}

interface Transaction {
  id: string;
  courierId: string;
  courierName: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string;
  createdAt: number;
  paymentStatus?: PaymentStatus;
  paymentStatusUpdatedAt?: number;
}

type PaymentStatus = 'PAID' | 'DEBT';

type PeriodKey = 'all' | 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'custom';

interface Filters {
  courierId: string;
  period: PeriodKey;
  start: string;
  end: string;
  type: string;
}

interface TransactionStats {
  count: number;
  income: number;
  expense: number;
  commission: number;
  topUp: number;
  refund: number;
  balance: number;
}

const EMPTY_FILTERS: Filters = { courierId: '', period: 'all', start: '', end: '', type: '' };

const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: 'all', label: 'Весь период' },
  { key: 'today', label: 'Сегодня' },
  { key: 'yesterday', label: 'Вчера' },
  { key: 'last7', label: 'Последние 7 дней' },
  { key: 'last30', label: 'Последние 30 дней' },
  { key: 'thisMonth', label: 'Этот месяц' },
  { key: 'lastMonth', label: 'Прошлый месяц' },
  { key: 'thisYear', label: 'Этот год' },
  { key: 'custom', label: 'Произвольный период' },
];

const PERIOD_LABELS: Record<PeriodKey, string> = PERIODS.reduce((acc, p) => {
  acc[p.key] = p.label;
  return acc;
}, {} as Record<PeriodKey, string>);

const TYPE_OPTIONS: Array<{ key: string; label: string }> = [
  { key: '', label: 'Все операции' },
  { key: 'COMMISSION', label: 'Комиссия' },
  { key: 'TOP_UP', label: 'Пополнение' },
  { key: 'DEBT', label: 'Долги' },
  { key: 'PAID', label: 'Оплаченные' },
  { key: 'COMMISSION_REFUND', label: 'Возврат комиссии' },
];

const TYPE_META: Record<string, { label: string; color: 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' }> = {
  COMMISSION: { label: 'Комиссия', color: 'warning' },
  TOP_UP: { label: 'Пополнение', color: 'success' },
  DEBT: { label: 'Долги', color: 'error' },
  PAID: { label: 'Оплаченные', color: 'success' },
  COMMISSION_REFUND: { label: 'Возврат комиссии', color: 'info' },
};

const PAGE_SIZE = 50;

function filtersFromParams(params: URLSearchParams): Filters {
  const period = (params.get('period') || '') as PeriodKey;
  return {
    courierId: params.get('courierId') || '',
    period: PERIOD_LABELS[period] ? period : 'all',
    start: params.get('start') || '',
    end: params.get('end') || '',
    type: params.get('type') || '',
  };
}

function filtersToParams(f: Filters): Record<string, string> {
  const p: Record<string, string> = {};
  if (f.courierId) p.courierId = f.courierId;
  if (f.period !== 'all') p.period = f.period;
  if (f.period === 'custom') {
    if (f.start) p.start = f.start;
    if (f.end) p.end = f.end;
  }
  if (f.type) p.type = f.type;
  return p;
}

const Commission: React.FC<CommissionProps> = ({ adminId }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [globalCommission, setGlobalCommission] = useState('10');
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  // Per-courier commission editing
  const [editingCourierId, setEditingCourierId] = useState<string | null>(null);
  const [editCommissionValue, setEditCommissionValue] = useState('');
  const [savingCommission, setSavingCommission] = useState<string | null>(null);

  // Top-up dialog
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [selectedCourier, setSelectedCourier] = useState<Courier | null>(null);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [topUpNote, setTopUpNote] = useState('');
  const [topUpPaymentStatus, setTopUpPaymentStatus] = useState<PaymentStatus>('PAID');
  const [topUpLoading, setTopUpLoading] = useState(false);
  const [paymentStatusLoading, setPaymentStatusLoading] = useState<string | null>(null);

  // Progressive commission ladder dialog
  const [ladderOpen, setLadderOpen] = useState(false);
  const [ladderCourier, setLadderCourier] = useState<Courier | null>(null);
  const [ladderEnabled, setLadderEnabled] = useState(true);
  const [ladderBase, setLadderBase] = useState('');
  const [ladderTiers, setLadderTiers] = useState<LadderTierDraft[]>([]);
  const [ladderLoading, setLadderLoading] = useState(false);
  const [ladderSaving, setLadderSaving] = useState(false);

  // Applied filters (active queries) — initialised from the URL so a page
  // reload keeps the current view.
  const [applied, setApplied] = useState<Filters>(() => filtersFromParams(searchParams));

  // Draft filter form (committed with "Применить")
  const [draftCourier, setDraftCourier] = useState<Courier | null>(null);
  const [draftPeriod, setDraftPeriod] = useState<PeriodKey>(applied.period);
  const [draftCustomStart, setDraftCustomStart] = useState(applied.start);
  const [draftCustomEnd, setDraftCustomEnd] = useState(applied.end);
  const [draftType, setDraftType] = useState(applied.type);

  // Transactions + pagination
  const [txLoading, setTxLoading] = useState(false);
  const [txLoadingMore, setTxLoadingMore] = useState(false);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const requestSeq = useRef(0);

  // Filtered statistics
  const [stats, setStats] = useState<TransactionStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  useEffect(() => {
    loadCommission();
    loadCouriers();
    loadFirstPage(applied);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolve the applied courier from the URL into the draft once couriers load.
  const courierDraftInitialized = useRef(false);
  useEffect(() => {
    if (couriers.length === 0 || courierDraftInitialized.current) return;
    courierDraftInitialized.current = true;
    if (applied.courierId) {
      const courier = couriers.find(c => c.id === applied.courierId);
      if (courier) setDraftCourier(courier);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [couriers]);

  const loadCommission = async () => {
    try {
      const docSnap = await getDoc(doc(db, 'settings', 'commission'));
      if (docSnap.exists()) {
        setGlobalCommission(String(docSnap.data().percent ?? 10));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadCouriers = async () => {
    const q = query(collection(db, 'users'), where('role', '==', 'COURIER'));
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map(d => ({
      id: d.id,
      name: d.data().name || '',
      phone: d.data().phone || '',
      balance: d.data().balance || 0,
      commissionPercent: d.data().commissionPercent,
      commissionLadderEnabled: d.data().commissionLadderEnabled === true,
      ladderCount: d.data().ladderCount || 0,
      ladderDate: d.data().ladderDate || '',
    }));
    setCouriers(data);
  };

  // Today's date in Tajikistan (UTC+5) as "YYYY-MM-DD" — same boundary
  // the backend uses to reset the daily ladder counter.
  const tjToday = () =>
    new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const courierCountToday = (c: Courier) =>
    c.ladderDate === tjToday() ? (c.ladderCount || 0) : 0;

  // ─── Progressive commission ladder ────────────────────────────────────────
  const openLadder = async (courier: Courier) => {
    setLadderCourier(courier);
    setLadderOpen(true);
    setLadderLoading(true);
    setError('');
    try {
      const snap = await getDocs(collection(db, 'users', courier.id, 'commissionTiers'));
      const tiers = snap.docs
        .map(d => d.data())
        .sort((a: any, b: any) => (a.threshold || 0) - (b.threshold || 0))
        .map((t: any) => ({ threshold: String(t.threshold ?? ''), percent: String(t.percent ?? '') }));
      setLadderTiers(tiers);
      setLadderEnabled(courier.commissionLadderEnabled === true || tiers.length > 0);
      setLadderBase(String(courier.commissionPercent ?? globalCommission));
    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки лестницы комиссии');
    } finally {
      setLadderLoading(false);
    }
  };

  const updateLadderTier = (index: number, field: 'threshold' | 'percent', value: string) => {
    setLadderTiers(prev => prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)));
  };

  const handleSaveLadder = async () => {
    if (!ladderCourier) return;

    const tiers = ladderTiers
      .map(t => ({ threshold: Number(t.threshold), percent: Number(t.percent) }))
      .filter(t => Number.isFinite(t.threshold) && Number.isFinite(t.percent));

    if (ladderEnabled) {
      if (tiers.length === 0) {
        setError('Добавьте хотя бы один шаг лестницы');
        return;
      }
      const thresholds = tiers.map(t => t.threshold);
      if (thresholds.some(t => !Number.isInteger(t) || t <= 0)) {
        setError('Пороги должны быть целыми числами больше 0');
        return;
      }
      if (new Set(thresholds).size !== thresholds.length) {
        setError('Пороги не должны повторяться');
        return;
      }
      if (tiers.some(t => t.percent < 0 || t.percent > 100)) {
        setError('Проценты должны быть от 0 до 100');
        return;
      }
      const base = Number(ladderBase);
      if (!Number.isFinite(base) || base < 0 || base > 100) {
        setError('Стартовая комиссия должна быть от 0 до 100');
        return;
      }
    }

    setLadderSaving(true);
    setError('');
    try {
      const fn = httpsCallable(functions, 'updateCourierCommissionTiers');
      await fn({
        adminId,
        courierId: ladderCourier.id,
        enabled: ladderEnabled,
        basePercent: Number(ladderBase),
        tiers,
      });
      setSuccess(`Лестница комиссии сохранена для «${ladderCourier.name}»`);
      setLadderOpen(false);
      loadCouriers();
    } catch (err: any) {
      setError(err.message || 'Ошибка сохранения лестницы');
    } finally {
      setLadderSaving(false);
    }
  };

  // ─── Filter helpers ────────────────────────────────────────────────────────
  // All ranges are built in the admin's local timezone so boundary operations
  // at the start/end of a day are not dropped.
  const getDateRange = (f: Filters): { start?: number; end?: number } => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();
    const dayStart = new Date(y, m, d).getTime();

    switch (f.period) {
      case 'today':
        return { start: dayStart };
      case 'yesterday':
        return { start: new Date(y, m, d - 1).getTime(), end: dayStart - 1 };
      case 'last7':
        return { start: new Date(y, m, d - 6).getTime() };
      case 'last30':
        return { start: new Date(y, m, d - 29).getTime() };
      case 'thisMonth':
        return { start: new Date(y, m, 1).getTime() };
      case 'lastMonth':
        return { start: new Date(y, m - 1, 1).getTime(), end: new Date(y, m, 1).getTime() - 1 };
      case 'thisYear':
        return { start: new Date(y, 0, 1).getTime() };
      case 'custom': {
        if (!f.start || !f.end) return {};
        const s = new Date(`${f.start}T00:00:00`);
        const e = new Date(`${f.end}T23:59:59.999`);
        if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return {};
        return { start: s.getTime(), end: e.getTime() };
      }
      default:
        return {};
    }
  };

  const buildConstraints = (f: Filters): QueryConstraint[] => {
    const cs: QueryConstraint[] = [];
    if (f.courierId) cs.push(where('courierId', '==', f.courierId));
    if (f.type && f.type !== 'DEBT' && f.type !== 'PAID') {
      cs.push(where('type', '==', f.type));
    }
    const range = getDateRange(f);
    if (range.start != null) cs.push(where('createdAt', '>=', range.start));
    if (range.end != null) cs.push(where('createdAt', '<=', range.end));
    cs.push(orderBy('createdAt', 'desc'));
    return cs;
  };

  const matchesFiltersLocally = (tx: Transaction, f: Filters) => {
    if (f.courierId && tx.courierId !== f.courierId) return false;
    if (f.type === 'DEBT' && tx.paymentStatus !== 'DEBT') return false;
    if (f.type === 'PAID' && tx.paymentStatus !== 'PAID') return false;
    if (f.type && f.type !== 'DEBT' && f.type !== 'PAID' && tx.type !== f.type) return false;
    const range = getDateRange(f);
    if (range.start != null && tx.createdAt < range.start) return false;
    if (range.end != null && tx.createdAt > range.end) return false;
    return true;
  };

  const calculateStats = (items: Transaction[]): TransactionStats => {
    let income = 0;
    let expense = 0;
    let commission = 0;
    let topUp = 0;
    let refund = 0;
    items.forEach(item => {
      const amount = Number(item.amount) || 0;
      if (amount > 0) income += amount;
      else expense += Math.abs(amount);
      if (item.type === 'COMMISSION') commission += Math.abs(amount);
      if (item.type === 'TOP_UP') topUp += amount;
      if (item.type === 'COMMISSION_REFUND') refund += amount;
    });
    return {
      count: items.length,
      income,
      expense,
      commission,
      topUp,
      refund,
      balance: income - expense,
    };
  };

  const loadPaymentStatusTransactions = async (f: Filters, seq: number) => {
    const paymentStatus = f.type as PaymentStatus;
    setStatsLoading(true);
    try {
      // Deliberately query only by payment status and apply courier/date filters
      // locally. This keeps these filters independent from composite indexes.
      const snapshot = await getDocs(query(
        collection(db, 'transactions'),
        where('paymentStatus', '==', paymentStatus),
      ));
      if (seq !== requestSeq.current) return;
      const data = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() }) as Transaction)
        .filter(tx => matchesFiltersLocally(tx, f))
        .sort((a, b) => b.createdAt - a.createdAt);
      setTransactions(data);
      setStats(calculateStats(data));
      setLastDoc(null);
      setHasMore(false);
    } catch (err: any) {
      console.error('Error loading payment status transactions:', err);
      if (seq !== requestSeq.current) return;
      setTransactions([]);
      setStats(null);
      setError('Не удалось загрузить операции по статусу оплаты. Попробуйте ещё раз.');
    } finally {
      if (seq === requestSeq.current) {
        setTxLoading(false);
        setStatsLoading(false);
      }
    }
  };

  const loadFirstPage = async (f: Filters) => {
    const seq = ++requestSeq.current;
    setTxLoading(true);
    setLastDoc(null);
    setHasMore(false);
    setError('');

    if (f.type === 'DEBT' || f.type === 'PAID') {
      await loadPaymentStatusTransactions(f, seq);
      return;
    }

    try {
      const q = query(
        collection(db, 'transactions'),
        ...buildConstraints(f),
        limit(PAGE_SIZE),
      );
      const snapshot = await getDocs(q);
      if (seq !== requestSeq.current) return;
      const data = snapshot.docs.map(d => ({
        id: d.id,
        ...d.data(),
      })) as Transaction[];
      setTransactions(data);
      setLastDoc(snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null);
      setHasMore(snapshot.docs.length === PAGE_SIZE);
    } catch (err: any) {
      console.error('Error loading transactions:', err);
      // If a composite index is still being prepared, fall back to a local
      // filter so every option remains usable instead of showing stale rows.
      try {
        setStatsLoading(true);
        const fallbackSnapshot = await getDocs(collection(db, 'transactions'));
        if (seq !== requestSeq.current) return;
        const fallbackData = fallbackSnapshot.docs
          .map(d => ({ id: d.id, ...d.data() }) as Transaction)
          .filter(tx => matchesFiltersLocally(tx, f))
          .sort((a, b) => b.createdAt - a.createdAt);
        setTransactions(fallbackData);
        setStats(calculateStats(fallbackData));
        setLastDoc(null);
        setHasMore(false);
        setError('');
        return;
      } catch (fallbackErr) {
        console.error('Fallback transaction filter failed:', fallbackErr);
        if (seq === requestSeq.current) {
          setTransactions([]);
          setStats(null);
          setError('Не удалось применить фильтр. Попробуйте ещё раз.');
        }
      } finally {
        if (seq === requestSeq.current) setStatsLoading(false);
      }
    } finally {
      if (seq === requestSeq.current) setTxLoading(false);
    }
    loadStats(f, seq);
  };

  const loadMore = async () => {
    if (!lastDoc) return;
    const seq = requestSeq.current;
    setTxLoadingMore(true);
    try {
      const q = query(
        collection(db, 'transactions'),
        ...buildConstraints(applied),
        startAfter(lastDoc),
        limit(PAGE_SIZE),
      );
      const snapshot = await getDocs(q);
      if (seq !== requestSeq.current) return;
      const data = snapshot.docs.map(d => ({
        id: d.id,
        ...d.data(),
      })) as Transaction[];
      setTransactions(prev => [...prev, ...data]);
      setLastDoc(snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null);
      setHasMore(snapshot.docs.length === PAGE_SIZE);
    } catch (err) {
      console.error('Error loading more transactions:', err);
    } finally {
      if (seq === requestSeq.current) setTxLoadingMore(false);
    }
  };

  const loadStats = async (f: Filters, seq: number) => {
    setStatsLoading(true);
    try {
      const q = query(collection(db, 'transactions'), ...buildConstraints(f));
      const snapshot = await getDocs(q);
      if (seq !== requestSeq.current) return;
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Transaction[];
      setStats(calculateStats(data));
    } catch (err: any) {
      console.error('Error loading statistics:', err);
      if (seq === requestSeq.current) setStats(null);
    } finally {
      if (seq === requestSeq.current) setStatsLoading(false);
    }
  };

  // ─── Filter actions ────────────────────────────────────────────────────────
  const applyFilters = () => {
    const next: Filters = {
      courierId: draftCourier?.id || '',
      period: draftPeriod,
      start: draftPeriod === 'custom' ? draftCustomStart : '',
      end: draftPeriod === 'custom' ? draftCustomEnd : '',
      type: draftType,
    };
    setApplied(next);
    setSearchParams(filtersToParams(next), { replace: true });
    loadFirstPage(next);
  };

  const resetFilters = () => {
    setDraftCourier(null);
    setDraftPeriod('all');
    setDraftCustomStart('');
    setDraftCustomEnd('');
    setDraftType('');
    setApplied(EMPTY_FILTERS);
    setSearchParams({}, { replace: true });
    loadFirstPage(EMPTY_FILTERS);
  };

  const removeCourierFilter = () => {
    const next = { ...applied, courierId: '' };
    setDraftCourier(null);
    setApplied(next);
    setSearchParams(filtersToParams(next), { replace: true });
    loadFirstPage(next);
  };

  const removePeriodFilter = () => {
    const next: Filters = { ...applied, period: 'all', start: '', end: '' };
    setDraftPeriod('all');
    setDraftCustomStart('');
    setDraftCustomEnd('');
    setApplied(next);
    setSearchParams(filtersToParams(next), { replace: true });
    loadFirstPage(next);
  };

  const removeTypeFilter = () => {
    const next = { ...applied, type: '' };
    setDraftType('');
    setApplied(next);
    setSearchParams(filtersToParams(next), { replace: true });
    loadFirstPage(next);
  };

  const activeFilterCount = () => {
    let n = 0;
    if (applied.courierId) n += 1;
    if (applied.period !== 'all') n += 1;
    if (applied.type) n += 1;
    return n;
  };

  const formatShortDate = (s: string) => {
    const d = new Date(`${s}T00:00:00`);
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  const periodChipLabel = () => {
    if (applied.period === 'custom' && applied.start && applied.end) {
      return `Период: ${formatShortDate(applied.start)} — ${formatShortDate(applied.end)}`;
    }
    if (applied.period !== 'all') return `Период: ${PERIOD_LABELS[applied.period]}`;
    return null;
  };

  const appliedCourier = useMemo(
    () => couriers.find(c => c.id === applied.courierId),
    [couriers, applied.courierId],
  );

  // ─── Handlers (unchanged behaviour) ────────────────────────────────────────
  const handleSaveGlobalCommission = async () => {
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const fn = httpsCallable(functions, 'updateCommission');
      await fn({ adminId, percent: Number(globalCommission) });
      setSuccess('Глобальная комиссия обновлена');
    } catch (err: any) {
      setError(err.message || 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCourierCommission = async (courierId: string) => {
    setSavingCommission(courierId);
    setError('');
    try {
      const fn = httpsCallable(functions, 'updateCourierCommission');
      await fn({ adminId, courierId, percent: Number(editCommissionValue) });
      // Update local state
      setCouriers(prev => prev.map(c =>
        c.id === courierId ? { ...c, commissionPercent: Number(editCommissionValue) } : c
      ));
      setEditingCourierId(null);
      setSuccess(`Комиссия курьера обновлена: ${editCommissionValue}%`);
    } catch (err: any) {
      setError(err.message || 'Ошибка обновления комиссии');
    } finally {
      setSavingCommission(null);
    }
  };

  const handleTopUp = async () => {
    if (!selectedCourier || !topUpAmount) return;
    setTopUpLoading(true);
    setError('');
    try {
      const fn = httpsCallable(functions, 'topUpBalance');
      const result = await fn({
        adminId,
        courierId: selectedCourier.id,
        amount: Number(topUpAmount),
        note: topUpNote || 'Пополнение баланса',
        paymentStatus: topUpPaymentStatus,
      });
      const data = result.data as any;
      setSuccess(
        topUpPaymentStatus === 'PAID'
          ? `Баланс пополнен и оплата отмечена. Новый баланс: ${data.newBalance} сомони`
          : `Баланс пополнен в долг. Новый баланс: ${data.newBalance} сомони`,
      );
      setTopUpOpen(false);
      setTopUpAmount('');
      setTopUpNote('');
      setTopUpPaymentStatus('PAID');
      loadCouriers();
      loadFirstPage(applied);
    } catch (err: any) {
      setError(err.message || 'Ошибка пополнения');
    } finally {
      setTopUpLoading(false);
    }
  };

  const handlePaymentStatusChange = async (tx: Transaction, paymentStatus: PaymentStatus) => {
    if (tx.type !== 'TOP_UP' || tx.paymentStatus === paymentStatus) return;
    setPaymentStatusLoading(tx.id);
    setError('');
    try {
      const fn = httpsCallable(functions, 'updateTopUpPaymentStatus');
      await fn({ adminId, transactionId: tx.id, paymentStatus });
      setTransactions(prev => prev.map(item => (
        item.id === tx.id
          ? { ...item, paymentStatus, paymentStatusUpdatedAt: Date.now() }
          : item
      )));
      setSuccess(
        paymentStatus === 'PAID'
          ? `Пополнение курьера «${tx.courierName}» отмечено как оплаченное`
          : `Пополнение курьера «${tx.courierName}» отмечено как долг`,
      );
    } catch (err: any) {
      setError(err.message || 'Ошибка изменения статуса оплаты');
    } finally {
      setPaymentStatusLoading(null);
    }
  };

  const formatDate = (ts: number) => new Date(ts).toLocaleString('ru-RU');

  const formatCost = (cost: number) => {
    const abs = Math.abs(cost);
    const somoni = Math.floor(abs);
    const diram = Math.round((abs - somoni) * 100);
    const sign = cost < 0 ? '-' : '';
    if (diram > 0) return `${sign}${somoni.toLocaleString()}.${String(diram).padStart(2, '0')} сомони`;
    return `${sign}${somoni.toLocaleString()} сомони`;
  };

  const courierOptions = useMemo<Array<Courier | null>>(() => [null, ...couriers], [couriers]);

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 3 }}>Комиссия и баланс</Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      <Grid container spacing={3}>
        {/* Global commission settings */}
        <Grid item xs={12}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>Глобальная комиссия</Typography>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'flex-start' }}>
                <TextField
                  label="Комиссия по умолчанию (%)"
                  type="number"
                  value={globalCommission}
                  onChange={(e) => setGlobalCommission(e.target.value)}
                  size="small"
                  helperText="Применяется к курьерам без индивидуальной комиссии"
                  sx={{ width: { xs: '100%', md: 420 } }}
                />
                <Button
                  variant="contained"
                  onClick={handleSaveGlobalCommission}
                  disabled={loading}
                  sx={{ minWidth: 160, height: 40 }}
                >
                  Сохранить
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Courier balances + individual commission */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>Курьеры — комиссия и баланс</Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Курьер</TableCell>
                      <TableCell>Телефон</TableCell>
                      <TableCell>Комиссия (%)</TableCell>
                      <TableCell>Баланс</TableCell>
                      <TableCell>Действие</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {couriers.map((courier) => (
                      <TableRow key={courier.id}>
                        <TableCell>{courier.name}</TableCell>
                        <TableCell>{courier.phone}</TableCell>
                        <TableCell>
                          {editingCourierId === courier.id ? (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <TextField
                                size="small"
                                type="number"
                                value={editCommissionValue}
                                onChange={(e) => setEditCommissionValue(e.target.value)}
                                sx={{ width: 80 }}
                                InputProps={{
                                  endAdornment: <InputAdornment position="end">%</InputAdornment>,
                                }}
                              />
                              <IconButton
                                size="small"
                                color="primary"
                                onClick={() => handleSaveCourierCommission(courier.id)}
                                disabled={savingCommission === courier.id}
                              >
                                <Save fontSize="small" />
                              </IconButton>
                            </Box>
                          ) : (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Chip
                                label={
                                  courier.commissionPercent !== undefined && courier.commissionPercent !== null
                                    ? `${courier.commissionPercent}%`
                                    : `${globalCommission}% (общая)`
                                }
                                color={
                                  courier.commissionPercent !== undefined && courier.commissionPercent !== null
                                    ? 'primary'
                                    : 'default'
                                }
                                size="small"
                                variant={
                                  courier.commissionPercent !== undefined && courier.commissionPercent !== null
                                    ? 'filled'
                                    : 'outlined'
                                }
                              />
                              <Tooltip title="Изменить комиссию">
                                <IconButton
                                  size="small"
                                  onClick={() => {
                                    setEditingCourierId(courier.id);
                                    setEditCommissionValue(
                                      String(courier.commissionPercent ?? globalCommission)
                                    );
                                  }}
                                >
                                  <Edit fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip
                                title={
                                  courier.commissionLadderEnabled
                                    ? `Прогрессивная комиссия (сегодня: ${courierCountToday(courier)} доставок)`
                                    : 'Настроить прогрессивную комиссию'
                                }
                              >
                                <IconButton
                                  size="small"
                                  color={courier.commissionLadderEnabled ? 'success' : 'default'}
                                  onClick={() => openLadder(courier)}
                                >
                                  <Stairs fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              {courier.commissionLadderEnabled && (
                                <Chip
                                  label={`${courierCountToday(courier)} сегодня`}
                                  size="small"
                                  variant="outlined"
                                  color="success"
                                />
                              )}
                            </Box>
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={formatCost(courier.balance)}
                            color={courier.balance >= 0 ? 'success' : 'error'}
                            size="small"
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<Add />}
                            onClick={() => {
                              setSelectedCourier(courier);
                              setTopUpPaymentStatus('PAID');
                              setTopUpOpen(true);
                            }}
                          >
                            Пополнить
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        {/* Transaction history with filters */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
                <Typography variant="h6">История операций</Typography>
                {activeFilterCount() > 0 && (
                  <Button
                    size="small"
                    variant="text"
                    startIcon={<FilterAltOff />}
                    onClick={resetFilters}
                  >
                    Сбросить все
                  </Button>
                )}
              </Box>

              {/* Filter panel */}
              <Stack
                direction="row"
                spacing={2}
                flexWrap="wrap"
                useFlexGap
                alignItems="center"
                sx={{ mb: 2 }}
              >
                <Autocomplete
                  options={courierOptions}
                  value={draftCourier}
                  onChange={(_, value) => setDraftCourier(value as Courier | null)}
                  getOptionLabel={(o) => (o ? o.name : 'Все курьеры')}
                  isOptionEqualToValue={(o, v) => (o && v ? o.id === v.id : o === v)}
                  filterOptions={(options, state) => {
                    const q = state.inputValue.trim().toLowerCase();
                    if (!q) return options;
                    return options.filter(o =>
                      !o
                      || o.name.toLowerCase().includes(q)
                      || (o.phone || '').toLowerCase().includes(q)
                    );
                  }}
                  renderInput={(params) => (
                    <TextField {...params} label="Курьер" size="small" sx={{ minWidth: 200 }} />
                  )}
                  sx={{ width: { xs: '100%', sm: 260 } }}
                />

                <FormControl size="small" sx={{ width: { xs: '100%', sm: 210 } }}>
                  <InputLabel id="period-filter-label">Период</InputLabel>
                  <Select
                    labelId="period-filter-label"
                    label="Период"
                    value={draftPeriod}
                    onChange={(e) => setDraftPeriod(e.target.value as PeriodKey)}
                  >
                    {PERIODS.map(p => (
                      <MenuItem key={p.key} value={p.key}>{p.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl size="small" sx={{ width: { xs: '100%', sm: 200 } }}>
                  <InputLabel id="type-filter-label">Тип операции</InputLabel>
                  <Select
                    labelId="type-filter-label"
                    label="Тип операции"
                    value={draftType}
                    onChange={(e) => setDraftType(e.target.value)}
                  >
                    {TYPE_OPTIONS.map(t => (
                      <MenuItem key={t.key || 'all'} value={t.key}>{t.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <Button
                  variant="contained"
                  startIcon={<FilterList />}
                  onClick={applyFilters}
                  sx={{ width: { xs: '100%', sm: 'auto' } }}
                >
                  Применить
                </Button>
                <Button
                  variant="outlined"
                  onClick={resetFilters}
                  sx={{ width: { xs: '100%', sm: 'auto' } }}
                >
                  Сбросить
                </Button>
                <Chip
                  label={statsLoading ? 'Найдено: …' : `Найдено: ${stats?.count ?? 0}`}
                  color="primary"
                  variant="outlined"
                  sx={{ fontWeight: 700, width: { xs: '100%', sm: 'auto' } }}
                />
              </Stack>

              {/* Custom period date fields */}
              {draftPeriod === 'custom' && (
                <Stack
                  direction="row"
                  spacing={2}
                  flexWrap="wrap"
                  useFlexGap
                  alignItems="center"
                  sx={{ mb: 2 }}
                >
                  <TextField
                    type="date"
                    label="Дата от"
                    size="small"
                    InputLabelProps={{ shrink: true }}
                    value={draftCustomStart}
                    onChange={(e) => setDraftCustomStart(e.target.value)}
                  />
                  <TextField
                    type="date"
                    label="Дата до"
                    size="small"
                    InputLabelProps={{ shrink: true }}
                    value={draftCustomEnd}
                    onChange={(e) => setDraftCustomEnd(e.target.value)}
                  />
                </Stack>
              )}

              {/* Active filter chips */}
              {activeFilterCount() > 0 && (
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
                  {appliedCourier && (
                    <Chip
                      size="small"
                      color="primary"
                      onDelete={removeCourierFilter}
                      label={`Курьер: ${appliedCourier.name}`}
                    />
                  )}
                  {periodChipLabel() && (
                    <Chip size="small" color="primary" onDelete={removePeriodFilter} label={periodChipLabel()} />
                  )}
                  {applied.type && TYPE_META[applied.type] && (
                    <Chip
                      size="small"
                      color="primary"
                      onDelete={removeTypeFilter}
                      label={`Тип: ${TYPE_META[applied.type].label}`}
                    />
                  )}
                </Stack>
              )}

              {txLoading ? (
                <LinearProgress sx={{ my: 3 }} />
              ) : transactions.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 6 }}>
                  <Typography variant="h6" sx={{ mb: 1 }}>Операции не найдены</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    По выбранным фильтрам операций нет.
                  </Typography>
                  <Button
                    variant="outlined"
                    startIcon={<FilterAltOff />}
                    onClick={resetFilters}
                  >
                    Сбросить фильтры
                  </Button>
                </Box>
              ) : (
                <>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Дата</TableCell>
                          <TableCell>Курьер</TableCell>
                          <TableCell>Тип</TableCell>
                          <TableCell>Сумма</TableCell>
                          <TableCell>Баланс после</TableCell>
                          <TableCell>Статус оплаты</TableCell>
                          <TableCell>Описание</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {transactions.map((tx) => (
                          <TableRow key={tx.id}>
                            <TableCell>{formatDate(tx.createdAt)}</TableCell>
                            <TableCell>{tx.courierName}</TableCell>
                            <TableCell>
                              <Chip
                                label={TYPE_META[tx.type]?.label || tx.type}
                                color={TYPE_META[tx.type]?.color || 'default'}
                                size="small"
                              />
                            </TableCell>
                            <TableCell sx={{ color: tx.amount >= 0 ? 'green' : 'red', fontWeight: 600 }}>
                              {tx.amount >= 0 ? '+' : ''}{formatCost(tx.amount)}
                            </TableCell>
                            <TableCell>{formatCost(tx.balanceAfter)}</TableCell>
                            <TableCell>
                              {tx.type === 'TOP_UP' ? (
                                <FormControl size="small" sx={{ minWidth: 135 }}>
                                  <Select
                                    value={tx.paymentStatus || ''}
                                    displayEmpty
                                    disabled={paymentStatusLoading === tx.id}
                                    onChange={(e) => handlePaymentStatusChange(tx, e.target.value as PaymentStatus)}
                                    sx={{
                                      height: 32,
                                      color: tx.paymentStatus === 'PAID' ? 'success.main' : tx.paymentStatus === 'DEBT' ? 'error.main' : 'text.secondary',
                                      fontWeight: 600,
                                    }}
                                  >
                                    <MenuItem value="" disabled>Не указан</MenuItem>
                                    <MenuItem value="PAID">Оплачено</MenuItem>
                                    <MenuItem value="DEBT">Долг</MenuItem>
                                  </Select>
                                </FormControl>
                              ) : (
                                <Typography color="text.secondary">—</Typography>
                              )}
                            </TableCell>
                            <TableCell>{tx.description}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  {hasMore && (
                    <Box sx={{ textAlign: 'center', mt: 2 }}>
                      <Button variant="outlined" onClick={loadMore} disabled={txLoadingMore}>
                        {txLoadingMore ? 'Загрузка…' : 'Загрузить ещё'}
                      </Button>
                    </Box>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Top-up dialog */}
      <Dialog open={topUpOpen} onClose={() => setTopUpOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Пополнить баланс: {selectedCourier?.name}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Текущий баланс: {formatCost(selectedCourier?.balance || 0)}
          </Typography>
          <TextField
            fullWidth
            label="Сумма пополнения (сомони)"
            type="number"
            value={topUpAmount}
            onChange={(e) => setTopUpAmount(e.target.value)}
            margin="normal"
          />
          <FormControl fullWidth margin="normal">
            <InputLabel id="top-up-payment-status-label">Статус оплаты</InputLabel>
            <Select
              labelId="top-up-payment-status-label"
              label="Статус оплаты"
              value={topUpPaymentStatus}
              onChange={(e) => setTopUpPaymentStatus(e.target.value as PaymentStatus)}
            >
              <MenuItem value="PAID">Оплачено</MenuItem>
              <MenuItem value="DEBT">Долг — курьер оплатит позже</MenuItem>
            </Select>
          </FormControl>
          {topUpPaymentStatus === 'DEBT' && (
            <Alert severity="warning" sx={{ mt: 1 }}>
              Баланс будет пополнен сейчас, а в истории операция останется со статусом «Долг», пока админ не отметит оплату.
            </Alert>
          )}
          <TextField
            fullWidth
            label="Примечание (необязательно)"
            value={topUpNote}
            onChange={(e) => setTopUpNote(e.target.value)}
            margin="normal"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTopUpOpen(false)}>Отмена</Button>
          <Button variant="contained" onClick={handleTopUp} disabled={topUpLoading || !topUpAmount}>
            Пополнить
          </Button>
        </DialogActions>
      </Dialog>

      {/* Progressive commission ladder dialog */}
      <Dialog open={ladderOpen} onClose={() => setLadderOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Прогрессивная комиссия: {ladderCourier?.name}</DialogTitle>
        <DialogContent>
          {ladderLoading ? (
            <LinearProgress sx={{ my: 3 }} />
          ) : (
            <>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2, mt: 1 }} flexWrap="wrap" useFlexGap>
                <Chip
                  label={
                    ladderCourier?.commissionPercent !== undefined && ladderCourier?.commissionPercent !== null
                      ? `Текущая комиссия: ${ladderCourier.commissionPercent}%`
                      : `Текущая комиссия: ${globalCommission}% (общая)`
                  }
                  color="primary"
                  size="small"
                />
                {ladderCourier?.commissionLadderEnabled && (
                  <Chip label={`Доставок сегодня: ${courierCountToday(ladderCourier)}`} color="success" size="small" variant="outlined" />
                )}
              </Stack>

              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Чем больше доставок курьер выполняет за день, тем ниже комиссия.
                Каждый день счётчик обнуляется, и утром комиссия возвращается к стартовой.
              </Typography>

              <FormControlLabel
                control={
                  <Switch
                    checked={ladderEnabled}
                    onChange={(e) => setLadderEnabled(e.target.checked)}
                  />
                }
                label="Лестница включена"
                sx={{ mb: 1 }}
              />

              <TextField
                fullWidth
                label="Стартовая комиссия с начала дня (%)"
                type="number"
                value={ladderBase}
                onChange={(e) => setLadderBase(e.target.value)}
                margin="normal"
                disabled={!ladderEnabled}
                InputProps={{
                  endAdornment: <InputAdornment position="end">%</InputAdornment>,
                }}
                helperText="Комиссия действует с первой доставки дня до первого порога"
              />

              <Divider sx={{ my: 2 }} />

              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Шаги лестницы
              </Typography>

              {ladderTiers.map((tier, index) => (
                <Stack key={index} direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                  <TextField
                    size="small"
                    type="number"
                    label="Доставок"
                    value={tier.threshold}
                    onChange={(e) => updateLadderTier(index, 'threshold', e.target.value)}
                    disabled={!ladderEnabled}
                    sx={{ width: 130 }}
                  />
                  <Typography variant="body2" color="text.secondary">→ комиссия</Typography>
                  <TextField
                    size="small"
                    type="number"
                    label="%"
                    value={tier.percent}
                    onChange={(e) => updateLadderTier(index, 'percent', e.target.value)}
                    disabled={!ladderEnabled}
                    sx={{ width: 110 }}
                    InputProps={{
                      endAdornment: <InputAdornment position="end">%</InputAdornment>,
                    }}
                  />
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => setLadderTiers(prev => prev.filter((_, i) => i !== index))}
                    disabled={!ladderEnabled}
                  >
                    <Delete fontSize="small" />
                  </IconButton>
                </Stack>
              ))}

              <Button
                size="small"
                startIcon={<Add />}
                onClick={() => setLadderTiers(prev => [...prev, { threshold: '', percent: '' }])}
                disabled={!ladderEnabled}
                sx={{ mt: 1 }}
              >
                Добавить шаг
              </Button>

              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                Внимание: ручное изменение комиссии в таблице выше ставит лестницу на паузу.
                Сохранение здесь применяет новую лестницу к сегодняшнему счётчику сразу.
              </Typography>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLadderOpen(false)}>Отмена</Button>
          <Button variant="contained" onClick={handleSaveLadder} disabled={ladderLoading || ladderSaving}>
            {ladderSaving ? 'Сохранение…' : 'Сохранить'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Commission;
