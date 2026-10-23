import { useEffect, useRef, useState } from 'react';

export function usePwa() {
  const [updateReady, setUpdateReady] = useState(false);
  const refreshing = useRef(false);

  useEffect(() => {
    if (
      !import.meta.env.PROD ||
      import.meta.env.VITE_SINGLE_FILE === '1' ||
      window.location.protocol === 'file:' ||
      !('serviceWorker' in navigator)
    ) {
      return;
    }

    let disposed = false;
    const onControllerChange = () => {
      if (refreshing.current) window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('./sw.js', {
          scope: './',
        });
        if (disposed) return;

        if (registration.waiting && navigator.serviceWorker.controller) {
          setUpdateReady(true);
        }

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (
              installing.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              setUpdateReady(true);
            }
          });
        });

        // 打开页面时主动检查一次；失败不影响主应用
        await registration.update();
      } catch {
        // PWA 是增强项，注册失败时仍可正常在线使用
      }
    };

    void register();

    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        onControllerChange,
      );
    };
  }, []);

  const applyUpdate = () => {
    refreshing.current = true;
    void navigator.serviceWorker.getRegistration().then((registration) => {
      if (registration?.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      } else {
        window.location.reload();
      }
    });
  };

  return { updateReady, applyUpdate };
}
