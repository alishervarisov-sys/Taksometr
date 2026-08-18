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

const DEBOUNCE_MS = 350;
const MIN_PHONE_DIGITS = 3;
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
//
// Phones are stored as free-form strings (courier app sends raw input), so the
// same number may appear as "901234567", "992901234567" or "+992901234567".
// A prefix search must potentially try each variant, but we remember which
// variant actually matches this database and try it first — the common case
// is a single wave of 2 parallel queries instead of 6.

type PhoneVariant = 'plain' | '992' | '+992';
let preferredPhoneVariant: PhoneVariant | null = null;

function phoneVariantsFor(digits: string): Array<{ value: string; variant: PhoneVariant }> {
  const variants: Array<{ value: string; variant: PhoneVariant }> = digits.startsWith('992')
    ? [
        { value: digits, variant: '992' },
        { value: '+' + digits, variant: '+992' },
      ]
    : [
        { value: digits, variant: 'plain' },
        { value: '992' + digits, variant: '992' },
        { value: '+992' + digits, variant: '+992' },
      ];
  if (preferredPhoneVariant) {
    variants.sort((a, b) => Number(b.variant === preferredPhoneVariant) - Number(a.variant === preferredPhoneVariant));
  }
  return variants;
}

// One prefix variant: range query over deliveries + users (parallel, indexed).
async function queryPhoneVariant(prefix: string, digits: string): Promise<{ suggestions: Map<string, PhoneSuggestion>; hits: number }> {
  const [delRes, usrRes] = await Promise.allSettled([
    getDocs(query(collection(db, 'deliveries'),
      where('clientPhone', '>=', prefix), where('clientPhone', '<', prefix + RANGE_END), limit(10))),
    getDocs(query(collection(db, 'users'),
      where('phone', '>=', prefix), where('phone', '<', prefix + RANGE_END), limit(10))),
  ]);

  const names = new Map<string, string>();
  const userPhones: Array<{ phone: string; name?: string }> = [];
  if (usrRes.status === 'fulfilled') {
    usrRes.value.docs.forEach((d) => {
      const data = d.data() as { phone?: string; name?: string; role?: string };
      if (!data.phone || data.role === 'COURIER' || data.role === 'ADMIN') return;
      const k = digitsOf(data.phone);
      if (!k || !k.includes(digits)) return;
      if (data.name) names.set(k, data.name);
      userPhones.push({ phone: data.phone, name: data.name });
    });
  }

  const map = new Map<string, PhoneSuggestion>();
  let hits = 0;
  if (delRes.status === 'fulfilled') {
    delRes.value.docs.forEach((d) => {
      const data = d.data() as RecentDelivery;
      const p = String(data.clientPhone || '');
      const k = digitsOf(p);
      if (!k || !k.includes(digits)) return;
      hits += 1;
      const ex = map.get(k) || { phone: p, name: names.get(k), orders: 0, lastUsedAt: 0 };
      ex.orders += 1;
      ex.lastUsedAt = Math.max(ex.lastUsedAt || 0, data.createdAt || 0);
      if (p.startsWith('+')) ex.phone = p;
      if (!ex.name) ex.name = names.get(k);
      if (!ex.lastAddress) {
        const a = data.pickup?.address || data.destination?.address;
        if (a) ex.lastAddress = a;
      }
      map.set(k, ex);
    });
  }
  // Registered clients with no deliveries yet
  userPhones.forEach(({ phone, name }) => {
    const k = digitsOf(phone);
    if (!k || map.has(k)) return;
    hits += 1;
    map.set(k, { phone, name, orders: 0, lastUsedAt: 0 });
  });
  return { suggestions: map, hits };
}

// Small frontend cache + in-flight deduplication: backspacing to a previously
// searched prefix or re-typing it never re-queries Firebase.
const phoneCache = new Map<string, PhoneSuggestion[]>();
const phoneInflight = new Map<string, Promise<PhoneSuggestion[]>>();
const MAX_PHONE_CACHE = 60;

function mergePhoneAgg(target: Map<string, PhoneSuggestion>, source: Map<string, PhoneSuggestion>) {
  source.forEach((s, k) => {
    const ex = target.get(k);
    if (ex) {
      ex.orders += s.orders;
      ex.lastUsedAt = Math.max(ex.lastUsedAt || 0, s.lastUsedAt || 0);
      if (!ex.name && s.name) ex.name = s.name;
      if (!ex.lastAddress && s.lastAddress) ex.lastAddress = s.lastAddress;
    } else {
      target.set(k, s);
    }
  });
}

async function fetchPhoneSuggestions(input: string, recent: RecentDelivery[]): Promise<PhoneSuggestion[]> {
  const digits = digitsOf(input);
  if (digits.length < MIN_PHONE_DIGITS) return [];

  const cached = phoneCache.get(digits);
  if (cached) return cached;
  const running = phoneInflight.get(digits);
  if (running) return running;

  const task = (async (): Promise<PhoneSuggestion[]> => {
    const variants = phoneVariantsFor(digits);
    const agg = new Map<string, PhoneSuggestion>();
    let matchedVariant: PhoneVariant | null = null;

    // First wave: only the preferred format (single round trip).
    const first = await queryPhoneVariant(variants[0].value, digits);
    if (first.hits > 0) {
      matchedVariant = variants[0].variant;
      mergePhoneAgg(agg, first.suggestions);
    } else if (variants.length > 1) {
      // Second wave (rare): the preferred format missed — try the rest.
      const rest = await Promise.all(variants.slice(1).map((v) => queryPhoneVariant(v.value, digits)));
      rest.forEach((r, i) => {
        if (r.hits > 0) {
          if (!matchedVariant) matchedVariant = variants[i + 1].variant;
          mergePhoneAgg(agg, r.suggestions);
        }
      });
    }
    if (matchedVariant) preferredPhoneVariant = matchedVariant;

    // Supplementary partial matching over already-loaded recent deliveries
    recent.forEach((d) => {
      const dp = digitsOf(String(d.clientPhone || ''));
      if (!dp || !dp.includes(digits)) return;
      const p = String(d.clientPhone || '');
      const ex = agg.get(dp) || { phone: p, orders: 0, lastUsedAt: 0 };
      ex.orders += 1;
      ex.lastUsedAt = Math.max(ex.lastUsedAt || 0, d.createdAt || 0);
      if (p.startsWith('+')) ex.phone = p;
      if (!ex.lastAddress) {
        const a = d.pickup?.address || d.destination?.address;
        if (a) ex.lastAddress = a;
      }
      agg.set(dp, ex);
    });

    const rank = (s: PhoneSuggestion): number => {
      const dp = digitsOf(s.phone);
      if (dp === digits) return 0;
      if (dp.startsWith(digits)) return 1;
      return 2;
    };

    const result = Array.from(agg.values())
      .filter((s) => digitsOf(s.phone).includes(digits))
      .sort((a, b) => rank(a) - rank(b) || b.orders - a.orders || (b.lastUsedAt || 0) - (a.lastUsedAt || 0))
      .slice(0, MAX_PHONE_RESULTS);

    if (phoneCache.size >= MAX_PHONE_CACHE) {
      const oldest = phoneCache.keys().next().value;
      if (oldest !== undefined) phoneCache.delete(oldest);
    }
    phoneCache.set(digits, result);
    return result;
  })().finally(() => { phoneInflight.delete(digits); });

  phoneInflight.set(digits, task);
  return task;
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
