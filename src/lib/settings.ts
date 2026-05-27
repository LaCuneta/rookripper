export type PuzzleRatingVisibility = 'always' | 'after' | 'never';

export interface Settings {
  autoNext: boolean;
  autoNextSeconds: number;
  easyThresholdMinutes: number;
  puzzleRating: PuzzleRatingVisibility;
  showCardType: boolean;
}

export const DEFAULTS: Settings = {
  autoNext: false,
  autoNextSeconds: 5,
  easyThresholdMinutes: 5,
  puzzleRating: 'always',
  showCardType: true,
};

const KEY = 'rookripper_settings';

export function loadSettings(): Settings {
  if (typeof window === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
