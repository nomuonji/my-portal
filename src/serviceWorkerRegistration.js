const isLocalhost = Boolean(
  window.location.hostname === 'localhost' ||
    window.location.hostname === '[::1]' ||
    window.location.hostname.match(/^127\.\d+\.\d+\.\d+$/)
);

const UPDATE_CHECK_INTERVAL = 5 * 60 * 1000;

export function register(config) {
  if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;

  const publicUrl = new URL(process.env.PUBLIC_URL, window.location.href);
  if (publicUrl.origin !== window.location.origin) return;

  window.addEventListener('load', () => {
    const swUrl = `${process.env.PUBLIC_URL}/service-worker.js`;

    if (isLocalhost) {
      checkValidServiceWorker(swUrl, config);
      navigator.serviceWorker.ready.then(() => {
        console.log('My Portal PWA service worker is ready.');
      });
    } else {
      registerValidSW(swUrl, config);
    }
  });
}

function registerValidSW(swUrl, config) {
  navigator.serviceWorker
    .register(swUrl, { updateViaCache: 'none' })
    .then((registration) => {
      let updateNotified = false;

      const notifyUpdate = () => {
        if (!registration.waiting || updateNotified) return;
        updateNotified = true;
        config?.onUpdate?.(registration);
      };

      // A worker can already be waiting before this page finishes loading.
      // The stock CRA helper misses that case, which is common for installed PWAs.
      if (navigator.serviceWorker.controller && registration.waiting) {
        notifyUpdate();
      }

      registration.addEventListener('updatefound', () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;

        installingWorker.addEventListener('statechange', () => {
          if (installingWorker.state !== 'installed') return;

          if (navigator.serviceWorker.controller) {
            updateNotified = false;
            notifyUpdate();
          } else {
            console.log('My Portal is cached for offline use.');
            config?.onSuccess?.(registration);
          }
        });
      });

      const checkForUpdates = () => {
        if (document.visibilityState === 'hidden') return;
        registration.update().catch((error) => {
          console.debug('PWA update check skipped:', error);
        });
      };

      // Installed PWAs can stay open for days. Check on resume/focus and on a
      // light periodic cadence so users do not remain on a stale build.
      window.addEventListener('focus', checkForUpdates);
      window.addEventListener('online', checkForUpdates);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdates();
      });
      window.setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL);

      checkForUpdates();
    })
    .catch((error) => {
      console.error('Error during service worker registration:', error);
    });
}

function checkValidServiceWorker(swUrl, config) {
  fetch(swUrl, {
    headers: { 'Service-Worker': 'script' },
    cache: 'no-store',
  })
    .then((response) => {
      const contentType = response.headers.get('content-type');
      if (
        response.status === 404 ||
        (contentType != null && contentType.indexOf('javascript') === -1)
      ) {
        navigator.serviceWorker.ready.then((registration) => {
          registration.unregister().then(() => window.location.reload());
        });
      } else {
        registerValidSW(swUrl, config);
      }
    })
    .catch(() => {
      console.log('No internet connection found. App is running in offline mode.');
    });
}

export function unregister() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready
    .then((registration) => registration.unregister())
    .catch((error) => console.error(error.message));
}
