import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyCPRo5_sfkPMOIDdAP1MWFCSLbCO7HqHA0",
  authDomain: "auva-70253.firebaseapp.com",
  projectId: "auva-70253",
  storageBucket: "auva-70253.firebasestorage.app",
  messagingSenderId: "286896671827",
  appId: "1:286896671827:android:8ef70dcf8e82063cdc0aa6"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const functions = getFunctions(app);
export const auth = getAuth(app);

// Google Maps JavaScript API key (must have "Maps JavaScript API" enabled)
export const GOOGLE_MAPS_API_KEY = "AIzaSyAk3WuUNwz0PNu73HAFPW7knrzPmxrjXzo";

export default app;
