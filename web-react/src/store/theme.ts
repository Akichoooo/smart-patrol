import { create } from 'zustand';

export type ThemeMode = 'dark' | 'light';

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
  initTheme: () => void;
}

export const applyThemeToDOM = (mode: ThemeMode) => {
  if (mode === 'dark') {
    document.body.setAttribute('theme-mode', 'dark');
  } else {
    document.body.removeAttribute('theme-mode');
  }
};

export const useThemeStore = create<ThemeState>((set, get) => {
  const initialMode = ((typeof window !== 'undefined' && localStorage.getItem('semi-theme-mode')) as ThemeMode) || 'dark';

  return {
    mode: initialMode,

    initTheme: () => {
      applyThemeToDOM(get().mode);
    },

    setMode: (mode: ThemeMode) => {
      localStorage.setItem('semi-theme-mode', mode);
      applyThemeToDOM(mode);
      set({ mode });
    },

    toggleMode: () => {
      const nextMode = get().mode === 'dark' ? 'light' : 'dark';
      get().setMode(nextMode);
    },
  };
});
