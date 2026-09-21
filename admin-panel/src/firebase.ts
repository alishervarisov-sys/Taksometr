import { initializeApp } from 'firebase/app';
import {
  CACHE_SIZE_UNLIMITED,
  enablePersistentCacheIndexAutoCreation,
  getPersistentCacheIndexManager,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyCPRo5_sfkPMOIDdAP1MWFCSLbCO7HqHA0",
  authDomain: "auva-70253.firebaseapp.com",
  projectId: "auva-70253",
  storageBucket: "auva-70253.firebasestorage.app",
  messagingSenderId: "286896671827",
  appId: "1:286896671827:android:8ef70dcf8e82063cdc0aa6"
};

const app = initializeApp(firebaseConfig);
// Keep the admin data in IndexedDB. The same build is embedded into the
// Windows dispatcher, so previously loaded screens remain usable when the
// connection is temporarily unavailable. Multiple-tab mode keeps the hosted
// web panel and the Windows WebView cache safe when both are open.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    // The admin APK is expected to retain every document it has already seen.
    // Firestore then restores screens from IndexedDB and only synchronizes
    // additions/changes with the backend.
    cacheSizeBytes: CACHE_SIZE_UNLIMITED,
    tabManager: persistentMultipleTabManager(),
  }),
});

// Local indexes make large cached queries (deliveries, clients, transactions)
// run from the device instead of scanning the entire IndexedDB cache each time.
const cacheIndexManager = getPersistentCacheIndexManager(db);
if (cacheIndexManager) {
  enablePersistentCacheIndexAutoCreation(cacheIndexManager);
}
export const functions = getFunctions(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

// Google Maps JavaScript API key (must have "Maps JavaScript API" enabled)
export const GOOGLE_MAPS_API_KEY = "AIzaSyAk3WuUNwz0PNu73HAFPW7knrzPmxrjXzo";

export default app;
