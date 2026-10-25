import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';
import { BrowserRouter } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase';
import { clearApiCache, installApiCache } from './apiCache';

// Reuse GET /api responses across page transitions (see apiCache.js).
installApiCache();
let cachedUid;
onAuthStateChanged(auth, (user) => {
  const uid = user?.uid || null;
  if (cachedUid !== undefined && uid !== cachedUid) clearApiCache();
  cachedUid = uid;
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

reportWebVitals();

let refreshingForUpdate = false;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshingForUpdate) return;
    refreshingForUpdate = true;
    window.location.reload();
  });
}

serviceWorkerRegistration.register({
  onUpdate: (registration) => {
    const waitingServiceWorker = registration.waiting;
    if (!waitingServiceWorker) return;

    const userConfirmation = window.confirm(
      'My Portalの新しいバージョンがあります。今すぐ更新しますか？'
    );

    if (userConfirmation) {
      waitingServiceWorker.postMessage({ type: 'SKIP_WAITING' });
    }
  },
});
