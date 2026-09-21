import {
  collection,
  doc,
  documentId,
  getDocFromServer,
  getDocs,
  getDocsFromCache,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
  QueryDocumentSnapshot,
  startAfter,
  Timestamp,
  Unsubscribe,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';

export interface CachedDocument<T = Record<string, unknown>> {
  id: string;
  data: T;
}

export interface CacheStatus {
  loading: boolean;
  syncing: boolean;
  fromCache: boolean;
  error?: Error;
}

interface StoredDocument {
  key: string;
  collectionName: string;
  documentId: string;
  data: Record<string, unknown>;
}

interface SyncCursor {
  changedAtMs: number;
  eventId: string;
  lastSyncedAtMs: number;
}

interface StoredMeta {
  key: string;
  value: SyncCursor;
}

interface SyncChange {
  collectionName: string;
  documentId: string;
  operation: 'upsert' | 'delete';
  changedAt: Timestamp;
}

type Listener = (
  documents: CachedDocument<any>[],
  status: CacheStatus,
) => void;

interface CollectionManager {
  name: string;
  documents: Map<string, Record<string, unknown>>;
  listeners: Set<Listener>;
  cursor: SyncCursor | null;
  started: boolean;
  starting?: Promise<void>;
  feedUnsubscribe?: Unsubscribe;
  processing: Promise<void>;
}

const DB_NAME = 'zaki-admin-data-cache';
const DB_VERSION = 1;
const DOCUMENT_STORE = 'documents';
const META_STORE = 'meta';
const FULL_REFRESH_AFTER_MS = 45 * 24 * 60 * 60 * 1000;
const managers = new Map<string, CollectionManager>();

const openCacheDb = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(DOCUMENT_STORE)) {
      const store = database.createObjectStore(DOCUMENT_STORE, { keyPath: 'key' });
      store.createIndex('collectionName', 'collectionName', { unique: false });
    }
    if (!database.objectStoreNames.contains(META_STORE)) {
      database.createObjectStore(META_STORE, { keyPath: 'key' });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('Не удалось открыть локальный кэш'));
});

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('Ошибка IndexedDB'));
});

const transactionDone = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error ?? new Error('Ошибка записи IndexedDB'));
  transaction.onabort = () => reject(transaction.error ?? new Error('Запись IndexedDB отменена'));
});

const normalizeForStorage = (value: any): any => {
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.latitude === 'number' && typeof value.longitude === 'number') {
    return { latitude: value.latitude, longitude: value.longitude };
  }
  if (Array.isArray(value)) return value.map(normalizeForStorage);
  const normalized: Record<string, unknown> = {};
  Object.entries(value).forEach(([key, entry]) => {
    normalized[key] = normalizeForStorage(entry);
  });
  return normalized;
};

const metaKey = (collectionName: string) => `cursor:${collectionName}`;

const readStoredCollection = async (collectionName: string): Promise<StoredDocument[]> => {
  const database = await openCacheDb();
  const transaction = database.transaction(DOCUMENT_STORE, 'readonly');
  const index = transaction.objectStore(DOCUMENT_STORE).index('collectionName');
  const result = await requestResult(index.getAll(IDBKeyRange.only(collectionName)));
  database.close();
  return result as StoredDocument[];
};

const readCursor = async (collectionName: string): Promise<SyncCursor | null> => {
  const database = await openCacheDb();
  const transaction = database.transaction(META_STORE, 'readonly');
  const result = await requestResult(transaction.objectStore(META_STORE).get(metaKey(collectionName)));
  database.close();
  return (result as StoredMeta | undefined)?.value ?? null;
};

const writeCursor = async (collectionName: string, cursor: SyncCursor): Promise<void> => {
  const database = await openCacheDb();
  const transaction = database.transaction(META_STORE, 'readwrite');
  transaction.objectStore(META_STORE).put({ key: metaKey(collectionName), value: cursor } as StoredMeta);
  await transactionDone(transaction);
  database.close();
};

const replaceStoredCollection = async (
  collectionName: string,
  documents: Map<string, Record<string, unknown>>,
): Promise<void> => {
  const database = await openCacheDb();
  const transaction = database.transaction(DOCUMENT_STORE, 'readwrite');
  const store = transaction.objectStore(DOCUMENT_STORE);
  const index = store.index('collectionName');
  const keys = await requestResult(index.getAllKeys(IDBKeyRange.only(collectionName)));
  keys.forEach(key => store.delete(key));
  documents.forEach((data, documentIdValue) => {
    store.put({
      key: `${collectionName}/${documentIdValue}`,
      collectionName,
      documentId: documentIdValue,
      data,
    } as StoredDocument);
  });
  await transactionDone(transaction);
  database.close();
};

const applyStoredChanges = async (
  collectionName: string,
  upserts: CachedDocument[],
  deletions: string[],
): Promise<void> => {
  const database = await openCacheDb();
  const transaction = database.transaction(DOCUMENT_STORE, 'readwrite');
  const store = transaction.objectStore(DOCUMENT_STORE);
  deletions.forEach(documentIdValue => store.delete(`${collectionName}/${documentIdValue}`));
  upserts.forEach(({ id, data }) => store.put({
    key: `${collectionName}/${id}`,
    collectionName,
    documentId: id,
    data,
  } as StoredDocument));
  await transactionDone(transaction);
  database.close();
};

const getManager = (name: string): CollectionManager => {
  let manager = managers.get(name);
  if (!manager) {
    manager = {
      name,
      documents: new Map(),
      listeners: new Set(),
      cursor: null,
      started: false,
      processing: Promise.resolve(),
    };
    managers.set(name, manager);
  }
  return manager;
};

const publish = (manager: CollectionManager, status: CacheStatus): void => {
  const documents = Array.from(manager.documents, ([id, data]) => ({ id, data }));
  manager.listeners.forEach(listener => listener(documents, status));
};

const latestFeedCursor = async (collectionName: string): Promise<SyncCursor> => {
  const snapshot = await getDocs(query(
    collection(db, '_syncChanges'),
    where('collectionName', '==', collectionName),
    orderBy('changedAt', 'asc'),
    orderBy(documentId(), 'asc'),
    limitToLast(1),
  ));
  const latest = snapshot.docs[0];
  if (!latest) {
    return { changedAtMs: 0, eventId: '', lastSyncedAtMs: Date.now() };
  }
  const change = latest.data() as SyncChange;
  return {
    changedAtMs: change.changedAt.toMillis(),
    eventId: latest.id,
    lastSyncedAtMs: Date.now(),
  };
};

const bootstrap = async (manager: CollectionManager): Promise<void> => {
  // Capture the feed boundary first. Changes written while the full snapshot is
  // loading are then replayed by startFeed, so no update can fall through the gap.
  let baseline: SyncCursor | null = null;
  let feedError: unknown;
  try {
    baseline = await latestFeedCursor(manager.name);
  } catch (error) {
    // A newly deployed composite index may need a few minutes to become ready.
    // Do not let that make the page empty: complete the ordinary data load and
    // temporarily fall back to Firestore's persistent realtime listener.
    feedError = error;
  }
  const snapshot = await getDocs(collection(db, manager.name));
  manager.documents = new Map(snapshot.docs.map(item => [
    item.id,
    normalizeForStorage(item.data()) as Record<string, unknown>,
  ]));
  await replaceStoredCollection(manager.name, manager.documents);
  publish(manager, { loading: false, syncing: false, fromCache: false });
  if (baseline) {
    manager.cursor = baseline;
    await writeCursor(manager.name, baseline);
  }
  if (feedError) throw feedError;
};

const processFeedDocuments = async (
  manager: CollectionManager,
  changeDocuments: QueryDocumentSnapshot[],
): Promise<void> => {
  if (changeDocuments.length === 0) return;
  const latestByDocument = new Map<string, { event: QueryDocumentSnapshot; change: SyncChange }>();
  changeDocuments.forEach(event => {
    const change = event.data() as SyncChange;
    latestByDocument.set(change.documentId, { event, change });
  });

  const upserts: CachedDocument[] = [];
  const deletions: string[] = [];
  await Promise.all(Array.from(latestByDocument.values()).map(async ({ change }) => {
    if (change.operation === 'delete') {
      manager.documents.delete(change.documentId);
      deletions.push(change.documentId);
      return;
    }
    const current = await getDocFromServer(doc(db, manager.name, change.documentId));
    if (!current.exists()) {
      manager.documents.delete(change.documentId);
      deletions.push(change.documentId);
      return;
    }
    const data = normalizeForStorage(current.data()) as Record<string, unknown>;
    manager.documents.set(current.id, data);
    upserts.push({ id: current.id, data });
  }));

  await applyStoredChanges(manager.name, upserts, deletions);
  const lastEvent = changeDocuments[changeDocuments.length - 1];
  const lastChange = lastEvent.data() as SyncChange;
  manager.cursor = {
    changedAtMs: lastChange.changedAt.toMillis(),
    eventId: lastEvent.id,
    lastSyncedAtMs: Date.now(),
  };
  await writeCursor(manager.name, manager.cursor);
  publish(manager, { loading: false, syncing: false, fromCache: false });
};

const startFeed = (manager: CollectionManager): void => {
  manager.feedUnsubscribe?.();
  const cursor = manager.cursor ?? { changedAtMs: 0, eventId: '', lastSyncedAtMs: 0 };
  const constraints = [
    where('collectionName', '==', manager.name),
    orderBy('changedAt', 'asc'),
    orderBy(documentId(), 'asc'),
  ];
  const feedQuery = cursor.changedAtMs > 0
    ? query(
        collection(db, '_syncChanges'),
        ...constraints,
        startAfter(Timestamp.fromMillis(cursor.changedAtMs), cursor.eventId),
      )
    : query(collection(db, '_syncChanges'), ...constraints);

  manager.feedUnsubscribe = onSnapshot(feedQuery, snapshot => {
    const added = snapshot.docChanges()
      .filter(change => change.type === 'added')
      .map(change => change.doc);
    if (added.length === 0) {
      publish(manager, { loading: false, syncing: false, fromCache: true });
      return;
    }
    publish(manager, { loading: false, syncing: true, fromCache: true });
    manager.processing = manager.processing
      .then(() => processFeedDocuments(manager, added))
      .catch(error => publish(manager, {
        loading: false,
        syncing: false,
        fromCache: true,
        error: error instanceof Error ? error : new Error(String(error)),
      }));
  }, error => publish(manager, {
    loading: false,
    syncing: false,
    fromCache: manager.documents.size > 0,
    error,
  }));
};

const startDirectCollectionFallback = (manager: CollectionManager, cause: unknown): void => {
  console.warn(`Инкрементальная синхронизация ${manager.name} временно недоступна`, cause);
  manager.feedUnsubscribe?.();
  manager.feedUnsubscribe = onSnapshot(
    collection(db, manager.name),
    { includeMetadataChanges: true },
    snapshot => {
      const upserts: CachedDocument[] = [];
      const deletions: string[] = [];
      snapshot.docChanges({ includeMetadataChanges: true }).forEach(change => {
        if (change.type === 'removed') {
          manager.documents.delete(change.doc.id);
          deletions.push(change.doc.id);
          return;
        }
        const data = normalizeForStorage(change.doc.data()) as Record<string, unknown>;
        manager.documents.set(change.doc.id, data);
        upserts.push({ id: change.doc.id, data });
      });
      manager.processing = manager.processing
        .then(() => applyStoredChanges(manager.name, upserts, deletions))
        .then(() => publish(manager, {
          loading: false,
          syncing: snapshot.metadata.fromCache,
          fromCache: snapshot.metadata.fromCache,
        }))
        .catch(error => publish(manager, {
          loading: false,
          syncing: false,
          fromCache: manager.documents.size > 0,
          error: error instanceof Error ? error : new Error(String(error)),
        }));
    },
    error => publish(manager, {
      loading: false,
      syncing: false,
      fromCache: manager.documents.size > 0,
      error,
    }),
  );
  manager.started = true;
};

const startManager = async (manager: CollectionManager): Promise<void> => {
  if (manager.starting) return manager.starting;
  manager.starting = (async () => {
    const [stored, cursor] = await Promise.all([
      readStoredCollection(manager.name),
      readCursor(manager.name),
    ]);
    manager.documents = new Map(stored.map(item => [item.documentId, item.data]));
    manager.cursor = cursor;
    if (stored.length > 0) {
      publish(manager, { loading: false, syncing: true, fromCache: true });
    } else {
      // Reuse Firebase's own persistent cache when upgrading an existing
      // installation to the new application-level cache.
      try {
        const nativeSnapshot = await getDocsFromCache(collection(db, manager.name));
        manager.documents = new Map(nativeSnapshot.docs.map(item => [
          item.id,
          normalizeForStorage(item.data()) as Record<string, unknown>,
        ]));
        if (manager.documents.size > 0) {
          publish(manager, { loading: false, syncing: true, fromCache: true });
        }
      } catch {
        // An empty native cache is expected on the first visit.
      }
    }

    const cursorExpired = !cursor || Date.now() - cursor.lastSyncedAtMs > FULL_REFRESH_AFTER_MS;
    if (cursorExpired) await bootstrap(manager);
    startFeed(manager);
    manager.started = true;
  })().catch(error => {
    startDirectCollectionFallback(manager, error);
  }).finally(() => {
    manager.starting = undefined;
  });
  return manager.starting;
};

export const subscribeCachedCollection = <T>(
  collectionName: string,
  listener: (documents: CachedDocument<T>[], status: CacheStatus) => void,
): (() => void) => {
  const manager = getManager(collectionName);
  const wrapped: Listener = listener as Listener;
  manager.listeners.add(wrapped);
  if (manager.started) {
    publish(manager, { loading: false, syncing: false, fromCache: true });
  } else {
    listener([], { loading: true, syncing: true, fromCache: true });
    void startManager(manager);
  }

  return () => {
    manager.listeners.delete(wrapped);
    if (manager.listeners.size === 0) {
      manager.feedUnsubscribe?.();
      manager.feedUnsubscribe = undefined;
      manager.started = false;
    }
  };
};

export const refreshCachedCollection = async (collectionName: string): Promise<void> => {
  const manager = getManager(collectionName);
  publish(manager, { loading: manager.documents.size === 0, syncing: true, fromCache: true });
  try {
    if (!manager.cursor) await bootstrap(manager);
    if (manager.listeners.size > 0) startFeed(manager);
  } catch (error) {
    startDirectCollectionFallback(manager, error);
  }
};
