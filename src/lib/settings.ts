export type PuzzleRatingVisibility = 'always' | 'after' | 'never';

// Lichess's flat board palettes. Its textured themes (wood, canvas, marble) are
// image assets and aren't reproducible in CSS, so they're not offered.
export const BOARD_THEMES = {
  brown: { label: 'Brown', light: '#f0d9b5', dark: '#b58863' },
  blue: { label: 'Blue', light: '#dee3e6', dark: '#8ca2ad' },
  green: { label: 'Green', light: '#ffffdd', dark: '#86a666' },
  ic: { label: 'IC', light: '#ececec', dark: '#c1c18e' }
} as const;

export type BoardTheme = keyof typeof BOARD_THEMES;

export interface Settings {
  autoNext: boolean;
  autoNextSeconds: number;
  easyThresholdMinutes: number;
  puzzleRating: PuzzleRatingVisibility;
  showCardType: boolean;
  boardTheme: BoardTheme;
  sound: boolean;
}

export const DEFAULTS: Settings = {
  autoNext: false,
  autoNextSeconds: 5,
  easyThresholdMinutes: 5,
  puzzleRating: 'always',
  showCardType: true,
  boardTheme: 'brown',
  sound: true,
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
