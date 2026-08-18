import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Autocomplete, TextField, Box, Typography, CircularProgress,
} from '@mui/material';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../firebase';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AddressSuggestion {
  address: string;
  latitude: number;
  longitude: number;
  usage: number;
  lastUsedAt?: number;
}

export interface PhoneSuggestion {
  phone: string;
  name?: string;
  orders: number;
  lastUsedAt?: number;
  lastAddress?: string;
}

export interface RecentDelivery {
  clientPhone?: string;
  createdAt?: number;
  pickup?: { address?: string; latitude?: number; longitude?: number };
  destination?: { address?: string; latitude?: number; longitude?: number };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 400;
const MIN_PHONE_DIGITS = 2;
const MIN_ADDRESS_CHARS = 2;
const MAX_PHONE_RESULTS = 8;
const MAX_ADDRESS_RESULTS = 8;
const RANGE_END = '\uf8ff';

const digitsOf = (s: string) => (s || '').replace(/\D/g, '');
const normAddr = (s: string) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, delay: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return useCallback((...args: A) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => fnRef.current(...args), delay);
  }, [delay]);
}

// Candidates covering common phone storage formats: 901234567 / 992901234567 / +992901234567
function phonePrefixCandidates(digits: string): string[] {
  const cands = new Set<string>([digits]);
  if (!digits.startsWith('992')) {
    cands.add('992' + digits);
    cands.add('+992' + digits);
  }
  return Array.from(cands);
}

function addDeliveryToAddressMap(data: RecentDelivery, map: Map<string, AddressSuggestion>) {
  for (const p of [data.pickup, data.destination]) {
    const a = p?.address;
    if (!a || typeof p?.latitude !== 'number' || typeof p?.longitude !== 'number') continue;
    const key = normAddr(a);
    if (!key) continue;
    const ex = map.get(key);
    if (ex) {
      ex.usage += 1;
      ex.lastUsedAt = Math.max(ex.lastUsedAt || 0, data.createdAt || 0);
    } else {
      map.set(key, { address: a, latitude: p.latitude, longitude: p.longitude, usage: 1, lastUsedAt: data.createdAt || 0 });
    }
  }
}

// Address ranking per spec: exact → startsWith → contains → word match,
// then usage count and recency.
function addressRank(normalized: string, q: string): number {
  if (normalized === q) return 0;
  if (normalized.startsWith(q)) return 1;
  if (normalized.includes(q)) return 2;
  const words = q.split(' ').filter(Boolean);
  if (words.length > 1 && words.every((w) => normalized.includes(w))) return 3;
  return 4; // no match
}

// ─── Search: phone ───────────────────────────────────────────────────────────

async function fetchPhoneSuggestions(input: string, recent: RecentDelivery[]): Promise<PhoneSuggestion[]> {
  const digits = digitsOf(input);
  if (digits.length < MIN_PHONE_DIGITS) return [];

  const candidates = phonePrefixCandidates(digits);

  const [delResults, usrResults] = await Promise.all([
    // Prefix search over deliveries (server-side, automatic single-field index)
    Promise.allSettled(candidates.map((c) =>
      getDocs(query(collection(db, 'deliveries'),
        where('clientPhone', '>=', c), where('clientPhone', '<', c + RANGE_END), limit(15)))
    )),
    // Client names from users collection
    Promise.allSettled(candidates.map((c) =>
      getDocs(query(collection(db, 'users'),
        where('phone', '>=', c), where('phone', '<', c + RANGE_END), limit(10)))
    )),
  ]);

  const names = new Map<string, string>();
  usrResults.forEach((r) => {
    if (r.status !== 'fulfilled') return;
    r.value.docs.forEach((d) => {
      const data = d.data() as { phone?: string; name?: string; role?: string };
      if (!data.phone || data.role === 'COURIER' || data.role === 'ADMIN') return;
      const k = digitsOf(data.phone);
      if (k && data.name && !names.has(k)) names.set(k, data.name);
    });
  });

  const agg = new Map<string, PhoneSuggestion>();
  const addDelivery = (data: RecentDelivery) => {
    const p = String(data.clientPhone || '');
    if (!p) return;
    const k = digitsOf(p);
    if (!k) return;
    const ex = agg.get(k) || { phone: p, name: names.get(k), orders: 0, lastUsedAt: 0 };
    ex.orders += 1;
    ex.lastUsedAt = Math.max(ex.lastUsedAt || 0, data.createdAt || 0);
    if (p.startsWith('+')) ex.phone = p;
    if (!ex.name) ex.name = names.get(k);
    if (!ex.lastAddress) {
      const a = data.pickup?.address || data.destination?.address;
      if (a) ex.lastAddress = a;
    }
    agg.set(k, ex);
  };

  delResults.forEach((r) => {
    if (r.status !== 'fulfilled') return;
    r.value.docs.forEach((d) => addDelivery(d.data() as RecentDelivery));
  });
  // Supplementary partial matching over already-loaded recent deliveries
  recent.forEach((d) => {
    if (digitsOf(String(d.clientPhone || '')).includes(digits)) addDelivery(d);
  });
  // Registered clients with no deliveries yet
  usrResults.forEach((r) => {
    if (r.status !== 'fulfilled') return;
    r.value.docs.forEach((d) => {
      const data = d.data() as { phone?: string; name?: string; role?: string };
      if (!data.phone || data.role === 'COURIER' || data.role === 'ADMIN') return;
      const k = digitsOf(data.phone);
      if (!k || agg.has(k)) return;
      agg.set(k, { phone: data.phone, name: data.name, orders: 0, lastUsedAt: 0 });
    });
  });

  const rank = (s: PhoneSuggestion): number => {
    const dp = digitsOf(s.phone);
    if (dp === digits) return 0;
    if (dp.startsWith(digits)) return 1;
    return 2;
  };

  return Array.from(agg.values())
    .filter((s) => digitsOf(s.phone).includes(digits))
    .sort((a, b) => rank(a) - rank(b) || b.orders - a.orders || (b.lastUsedAt || 0) - (a.lastUsedAt || 0))
    .slice(0, MAX_PHONE_RESULTS);
}

// ─── Search: address ─────────────────────────────────────────────────────────

async function fetchAddressSuggestions(input: string, recent: RecentDelivery[]): Promise<AddressSuggestion[]> {
  const prefix = input.trim();
  if (prefix.length < MIN_ADDRESS_CHARS) return [];
  const q = normAddr(prefix);

  const map = new Map<string, AddressSuggestion>();

  // Prefix search over own base (server-side, automatic single-field indexes on
  // the pickup.address / destination.address subfields)
  const results = await Promise.allSettled([
    getDocs(query(collection(db, 'deliveries'),
      where('pickup.address', '>=', prefix), where('pickup.address', '<', prefix + RANGE_END), limit(10))),
    getDocs(query(collection(db, 'deliveries'),
      where('destination.address', '>=', prefix), where('destination.address', '<', prefix + RANGE_END), limit(10))),
  ]);
  results.forEach((r) => {
    if (r.status !== 'fulfilled') return;
    r.value.docs.forEach((d) => addDeliveryToAddressMap(d.data() as RecentDelivery, map));
  });

  // Supplementary partial / word matching over already-loaded recent deliveries
  recent.forEach((d) => {
    for (const p of [d.pickup, d.destination]) {
      const a = p?.address;
      if (!a) continue;
      const n = normAddr(a);
      if (n.includes(q)) addDeliveryToAddressMap(d, map);
    }
  });

  return Array.from(map.values())
    .map((s) => ({ s, rank: addressRank(normAddr(s.address), q) }))
    .filter(({ rank }) => rank <= 3)
    .sort((a, b) => a.rank - b.rank || b.s.usage - a.s.usage || (b.s.lastUsedAt || 0) - (a.s.lastUsedAt || 0))
    .map(({ s }) => s)
    .slice(0, MAX_ADDRESS_RESULTS);
}

// ─── Client's recent saved addresses (phone → addresses) ────────────────────

export async function fetchClientRecentAddresses(phone: string, max = 6): Promise<AddressSuggestion[]> {
  if (!phone) return [];
  const snap = await getDocs(query(collection(db, 'deliveries'), where('clientPhone', '==', phone), limit(40)));
  const items = snap.docs
    .map((d) => d.data() as RecentDelivery)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const map = new Map<string, AddressSuggestion>();
  items.forEach((d) => addDeliveryToAddressMap(d, map));
  return Array.from(map.values())
    .sort((a, b) => b.usage - a.usage || (b.lastUsedAt || 0) - (a.lastUsedAt || 0))
    .slice(0, max);
}

// ─── UI: phone autocomplete field ────────────────────────────────────────────

interface ClientPhoneAutocompleteProps {
  label?: string;
  value: string;
  onInputChange: (phone: string) => void;
  onSelect: (suggestion: PhoneSuggestion) => void;
  recentDeliveries: RecentDelivery[];
}

export const ClientPhoneAutocomplete: React.FC<ClientPhoneAutocompleteProps> = ({
  label = 'Телефон клиента', value, onInputChange, onSelect, recentDeliveries,
}) => {
  const [options, setOptions] = useState<PhoneSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const [open, setOpen] = useState(false);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!value.trim()) { setOptions([]); setSearchDone(false); setLoading(false); }
  }, [value]);

  const runSearch = useDebouncedCallback(async (text: string) => {
    if (digitsOf(text).length < MIN_PHONE_DIGITS) {
      setOptions([]); setSearchDone(false); setLoading(false);
      return;
    }
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const res = await fetchPhoneSuggestions(text, recentDeliveries);
      if (seq !== seqRef.current) return;
      setOptions(res);
    } catch {
      if (seq === seqRef.current) setOptions([]);
    } finally {
      if (seq === seqRef.current) { setLoading(false); setSearchDone(true); }
    }
  }, DEBOUNCE_MS);

  return (
    <Autocomplete
      freeSolo
      includeInputInList
      forcePopupIcon={false}
      options={options}
      getOptionLabel={(o) => (typeof o === 'string' ? o : o.phone)}
      filterOptions={(x) => x}
      inputValue={value}
      open={open && (options.length > 0 || (searchDone && !loading))}
      onOpen={() => { if (digitsOf(value).length >= MIN_PHONE_DIGITS) setOpen(true); }}
      onClose={() => setOpen(false)}
      onInputChange={(_, newInput, reason) => {
        if (reason !== 'input') return;
        onInputChange(newInput);
        setOpen(true);
        if (digitsOf(newInput).length < MIN_PHONE_DIGITS) {
          setOptions([]); setSearchDone(false); setLoading(false);
        } else {
          setLoading(true); setSearchDone(false);
        }
        runSearch(newInput);
      }}
      onChange={(_, v) => {
        if (v && typeof v !== 'string') { setOpen(false); onSelect(v); }
      }}
      noOptionsText="Ничего не найдено"
      renderInput={(params) => (
        <TextField
          {...params}
          fullWidth
          label={label}
          placeholder="+992 __ ___ __ __"
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <React.Fragment>
                {loading ? <CircularProgress size={18} /> : null}
                {params.InputProps.endAdornment}
              </React.Fragment>
            ),
          }}
        />
      )}
      renderOption={(props, option) => {
        const { key, ...liProps } = props as any;
        return (
          <Box component="li" {...liProps} key={key}>
            <Box sx={{ width: '100%' }}>
              <Typography sx={{ fontWeight: 600 }}>{option.phone}</Typography>
              {option.name && <Typography variant="body2" color="text.secondary">{option.name}</Typography>}
              {option.lastAddress && (
                <Typography variant="caption" color="text.secondary" display="block" noWrap>
                  {option.lastAddress}
                </Typography>
              )}
            </Box>
          </Box>
        );
      }}
    />
  );
};

// ─── UI: address autocomplete field ──────────────────────────────────────────

interface AddressAutocompleteProps {
  label?: string;
  value: string;
  onInputChange: (address: string) => void;
  onSelect: (suggestion: AddressSuggestion) => void;
  recentDeliveries: RecentDelivery[];
}

export const AddressAutocomplete: React.FC<AddressAutocompleteProps> = ({
  label, value, onInputChange, onSelect, recentDeliveries,
}) => {
  const [options, setOptions] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const [open, setOpen] = useState(false);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!value.trim()) { setOptions([]); setSearchDone(false); setLoading(false); }
  }, [value]);

  const runSearch = useDebouncedCallback(async (text: string) => {
    if (text.trim().length < MIN_ADDRESS_CHARS) {
      setOptions([]); setSearchDone(false); setLoading(false);
      return;
    }
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const res = await fetchAddressSuggestions(text, recentDeliveries);
      if (seq !== seqRef.current) return;
      setOptions(res);
    } catch {
      if (seq === seqRef.current) setOptions([]);
    } finally {
      if (seq === seqRef.current) { setLoading(false); setSearchDone(true); }
    }
  }, DEBOUNCE_MS);

  return (
    <Autocomplete
      freeSolo
      includeInputInList
      forcePopupIcon={false}
      options={options}
      getOptionLabel={(o) => (typeof o === 'string' ? o : o.address)}
      filterOptions={(x) => x}
      inputValue={value}
      open={open && (options.length > 0 || (searchDone && !loading))}
      onOpen={() => { if (value.trim().length >= MIN_ADDRESS_CHARS) setOpen(true); }}
      onClose={() => setOpen(false)}
      onInputChange={(_, newInput, reason) => {
        if (reason !== 'input') return;
        onInputChange(newInput);
        setOpen(true);
        if (newInput.trim().length < MIN_ADDRESS_CHARS) {
          setOptions([]); setSearchDone(false); setLoading(false);
        } else {
          setLoading(true); setSearchDone(false);
        }
        runSearch(newInput);
      }}
      onChange={(_, v) => {
        if (v && typeof v !== 'string') { setOpen(false); onSelect(v); }
      }}
      noOptionsText="Ничего не найдено"
      renderInput={(params) => (
        <TextField
          {...params}
          fullWidth
          label={label}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <React.Fragment>
                {loading ? <CircularProgress size={18} /> : null}
                {params.InputProps.endAdornment}
              </React.Fragment>
            ),
          }}
        />
      )}
      renderOption={(props, option) => {
        const { key, ...liProps } = props as any;
        return (
          <Box component="li" {...liProps} key={key}>
            <Box sx={{ width: '100%' }}>
              <Typography sx={{ fontWeight: 600 }}>{option.address}</Typography>
              <Typography variant="caption" color="text.secondary">
                {option.usage > 1 ? `Использован ${option.usage} раз` : 'Из базы заказов'}
              </Typography>
            </Box>
          </Box>
        );
      }}
    />
  );
};
