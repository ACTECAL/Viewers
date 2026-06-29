import { create } from 'zustand';

type UIModeState = {
  mode: 'diagnostic' | 'simple';
  setMode: (mode: 'diagnostic' | 'simple') => void;
};

export const useUIModeStore = create<UIModeState>((set) => ({
  mode: new URLSearchParams(window.location.search).get('mode') === 'simple' ? 'simple' : 'diagnostic',
  setMode: (mode) => set({ mode }),
}));
