import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App'; // Mengimpor komponen App utama

// Konfigurasi Firebase Anda yang telah Anda berikan
const firebaseConfig = {
    apiKey: "AIzaSyDxQm8bn8DMqQIxoeHNEPVsWO31nWSVVaA",
    authDomain: "astin-27ee3.firebaseapp.com",
    projectId: "astin-27ee3",
    storageBucket: "astin-27ee3.firebasestorage.app",
    messagingSenderId: "87851561591",
    appId: "1:87851561591:web:d4c09e5e9bea0e85d30c72",
    measurementId: "G-4W7F0XE9GR"
};

// Mendapatkan ID aplikasi dari konfigurasi Firebase
const appId = firebaseConfig.appId;

// Mendapatkan elemen root dari HTML
const container = document.getElementById('root');
// Membuat root React
const root = createRoot(container);

// Merender komponen App ke dalam root
// firebaseConfig dan appId dilewatkan sebagai props ke komponen App
root.render(
  <React.StrictMode>
    <App firebaseConfig={firebaseConfig} appId={appId} />
  </React.StrictMode>
);
