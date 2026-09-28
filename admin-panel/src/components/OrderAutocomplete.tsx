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

// Local matches are displayed immediately. This short pause only limits the
// follow-up Firebase request while an operator is still typing.
const DEBOUNCE_MS = 180;
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

function collectRecentPhoneSuggestions(digits: string, recent: RecentDelivery[]): Map<string, PhoneSuggestion> {
  const suggestions = new Map<string, PhoneSuggestion>();
  recent.forEach((d) => {
    const normalizedPhone = digitsOf(String(d.clientPhone || ''));
    if (!normalizedPhone || !normalizedPhone.includes(digits)) return;
    const phone = String(d.clientPhone || '');
    const existing = suggestions.get(normalizedPhone) || { phone, orders: 0, lastUsedAt: 0 };
    existing.orders += 1;
    existing.lastUsedAt = Math.max(existing.lastUsedAt || 0, d.createdAt || 0);
    if (phone.startsWith('+')) existing.phone = phone;
    if (!existing.lastAddress) {
      const address = d.pickup?.address || d.destination?.address;
      if (address) existing.lastAddress = address;
    }
    suggestions.set(normalizedPhone, existing);
  });
  return suggestions;
}

function sortPhoneSuggestions(suggestions: Iterable<PhoneSuggestion>, digits: string): PhoneSuggestion[] {
  const rank = (suggestion: PhoneSuggestion): number => {
    const phoneDigits = digitsOf(suggestion.phone);
    if (phoneDigits === digits) return 0;
    if (phoneDigits.startsWith(digits)) return 1;
    return 2;
  };

  return Array.from(suggestions)
    .filter((suggestion) => digitsOf(suggestion.phone).includes(digits))
    .sort((a, b) => rank(a) - rank(b) || b.orders - a.orders || (b.lastUsedAt || 0) - (a.lastUsedAt || 0))
    .slice(0, MAX_PHONE_RESULTS);
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

    // Merge partial matches from the already-open deliveries without another
    // network request. The same data is also shown immediately while typing.
    mergePhoneAgg(agg, collectRecentPhoneSuggestions(digits, recent));
    const result = sortPhoneSuggestions(agg.values(), digits);

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

const addressCache = new Map<string, AddressSuggestion[]>();
const addressInflight = new Map<string, Promise<AddressSuggestion[]>>();
const MAX_ADDRESS_CACHE = 100;

function addRecentAddressMatches(queryText: string, recent: RecentDelivery[], map: Map<string, AddressSuggestion>) {
  const normalizedQuery = normAddr(queryText);
  recent.forEach((delivery) => {
    for (const point of [delivery.pickup, delivery.destination]) {
      if (point?.address && normAddr(point.address).includes(normalizedQuery)) {
        addDeliveryToAddressMap(delivery, map);
        break;
      }
    }
  });
}

function sortAddressSuggestions(suggestions: Iterable<AddressSuggestion>, normalizedQuery: string): AddressSuggestion[] {
  return Array.from(suggestions)
    .map((suggestion) => ({ suggestion, rank: addressRank(normAddr(suggestion.address), normalizedQuery) }))
    .filter(({ rank }) => rank <= 3)
    .sort((a, b) => a.rank - b.rank || b.suggestion.usage - a.suggestion.usage || (b.suggestion.lastUsedAt || 0) - (a.suggestion.lastUsedAt || 0))
    .map(({ suggestion }) => suggestion)
    .slice(0, MAX_ADDRESS_RESULTS);
}

function getRecentAddressSuggestions(input: string, recent: RecentDelivery[]): AddressSuggestion[] {
  const prefix = input.trim();
  if (prefix.length < MIN_ADDRESS_CHARS) return [];
  const map = new Map<string, AddressSuggestion>();
  addRecentAddressMatches(prefix, recent, map);
  return sortAddressSuggestions(map.values(), normAddr(prefix));
}

async function fetchAddressSuggestions(input: string, recent: RecentDelivery[]): Promise<AddressSuggestion[]> {
  const prefix = input.trim();
  if (prefix.length < MIN_ADDRESS_CHARS) return [];
  const normalizedQuery = normAddr(prefix);
  const cached = addressCache.get(normalizedQuery);
  if (cached) return cached;
  const running = addressInflight.get(normalizedQuery);
  if (running) return running;

  const task = (async (): Promise<AddressSuggestion[]> => {
    const map = new Map<string, AddressSuggestion>();

    // Prefix search over own base (server-side, automatic single-field indexes on
    // the pickup.address / destination.address subfields)
    const results = await Promise.allSettled([
      getDocs(query(collection(db, 'deliveries'),
        where('pickup.address', '>=', prefix), where('pickup.address', '<', prefix + RANGE_END), limit(10))),
      getDocs(query(collection(db, 'deliveries'),
        where('destination.address', '>=', prefix), where('destination.address', '<', prefix + RANGE_END), limit(10))),
    ]);
    results.forEach((result) => {
      if (result.status !== 'fulfilled') return;
      result.value.docs.forEach((document) => addDeliveryToAddressMap(document.data() as RecentDelivery, map));
    });

    // Supplementary partial / word matching over already-loaded recent deliveries
    addRecentAddressMatches(prefix, recent, map);
    const suggestions = sortAddressSuggestions(map.values(), normalizedQuery);

    if (addressCache.size >= MAX_ADDRESS_CACHE) {
      const oldest = addressCache.keys().next().value;
      if (oldest !== undefined) addressCache.delete(oldest);
    }
    addressCache.set(normalizedQuery, suggestions);
    return suggestions;
  })().finally(() => { addressInflight.delete(normalizedQuery); });

  addressInflight.set(normalizedQuery, task);
  return task;
}

// ─── Client's recent saved addresses (phone → addresses) ────────────────────

const clientAddressCache = new Map<string, AddressSuggestion[]>();
const clientAddressInflight = new Map<string, Promise<AddressSuggestion[]>>();
const MAX_CLIENT_ADDRESS_CACHE = 60;

export async function fetchClientRecentAddresses(phone: string, max = 6): Promise<AddressSuggestion[]> {
  if (!phone) return [];
  const cacheKey = `${digitsOf(phone)}:${max}`;
  const cached = clientAddressCache.get(cacheKey);
  if (cached) return cached;
  const running = clientAddressInflight.get(cacheKey);
  if (running) return running;

  const task = (async (): Promise<AddressSuggestion[]> => {
    const snapshot = await getDocs(query(collection(db, 'deliveries'), where('clientPhone', '==', phone), limit(40)));
    const items = snapshot.docs
      .map((document) => document.data() as RecentDelivery)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const map = new Map<string, AddressSuggestion>();
    items.forEach((delivery) => addDeliveryToAddressMap(delivery, map));
    const suggestions = Array.from(map.values())
      .sort((a, b) => b.usage - a.usage || (b.lastUsedAt || 0) - (a.lastUsedAt || 0))
      .slice(0, max);

    if (clientAddressCache.size >= MAX_CLIENT_ADDRESS_CACHE) {
      const oldest = clientAddressCache.keys().next().value;
      if (oldest !== undefined) clientAddressCache.delete(oldest);
    }
    clientAddressCache.set(cacheKey, suggestions);
    return suggestions;
  })().finally(() => { clientAddressInflight.delete(cacheKey); });

  clientAddressInflight.set(cacheKey, task);
  return task;
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
    const seq = seqRef.current;
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
        const digits = digitsOf(newInput);
        // Invalidate an older Firebase response immediately, then show matches
        // from the deliveries that are already in the browser.
        seqRef.current += 1;
        if (digits.length < MIN_PHONE_DIGITS) {
          setOptions([]); setSearchDone(false); setLoading(false);
        } else {
          setOptions(sortPhoneSuggestions(collectRecentPhoneSuggestions(digits, recentDeliveries).values(), digits));
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
    const seq = seqRef.current;
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
        // Keep the suggestion list responsive even on a slow connection; the
        // Firebase result replaces these local matches when it arrives.
        seqRef.current += 1;
        if (newInput.trim().length < MIN_ADDRESS_CHARS) {
          setOptions([]); setSearchDone(false); setLoading(false);
        } else {
          setOptions(getRecentAddressSuggestions(newInput, recentDeliveries));
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
