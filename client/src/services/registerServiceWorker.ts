export const registerServiceWorker = (): void => {
  if (process.env.NODE_ENV !== 'production') return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${process.env.PUBLIC_URL || ''}/service-worker.js`).catch(() => undefined);
  });
};
