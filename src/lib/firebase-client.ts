"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  type Auth,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyBCzzML3CziZX9Njc5kwBC06-DEOvf2Ock",
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "bigbag-47e89.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "bigbag-47e89",
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "bigbag-47e89.firebasestorage.app",
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "729188042913",
  appId:
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID ||
    "1:729188042913:web:f75523057b0cf9e0f8c8e0",
  measurementId:
    process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-BX7DTKG7FW",
};

let persistenceReady: Promise<void> | null = null;

export function getFirebaseApp(): FirebaseApp {
  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}

export function getFirebaseAuth(): Auth {
  const auth = getAuth(getFirebaseApp());
  persistenceReady ||= setPersistence(auth, browserLocalPersistence);
  return auth;
}

export async function waitForFirebasePersistence(): Promise<void> {
  getFirebaseAuth();
  await persistenceReady;
}

/** Analytics is optional and browser-only; unsupported environments stay quiet. */
export async function initializeFirebaseAnalytics(): Promise<void> {
  if (typeof window === "undefined" || process.env.NODE_ENV !== "production") return;
  try {
    const { getAnalytics, isSupported } = await import("firebase/analytics");
    if (await isSupported()) getAnalytics(getFirebaseApp());
  } catch {
    // Auth and the builder must keep working when analytics is blocked.
  }
}
