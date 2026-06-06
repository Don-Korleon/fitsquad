/// <reference types="vite/client" />

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe: { start_param?: string };
        ready: () => void;
        expand: () => void;
        themeParams: Record<string, string>;
        MainButton: {
          text: string;
          show: () => void;
          hide: () => void;
          onClick: (cb: () => void) => void;
          offClick: (cb: () => void) => void;
          showProgress: (leaveActive?: boolean) => void;
          hideProgress: () => void;
        };
        HapticFeedback: { impactOccurred: (style: string) => void };
        showAlert: (message: string, callback?: () => void) => void;
        close: () => void;
      };
    };
  }
}

export {};