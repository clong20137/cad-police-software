export type ThemeModePreference = 'light' | 'dark' | 'schedule';
export type AlertSoundPreference = 'classic' | 'soft' | 'urgent' | 'radio' | 'none';

export type AccountPreferences = {
  themeMode: ThemeModePreference;
  lightStart: string;
  darkStart: string;
  newCallSound: AlertSoundPreference;
  pushNotifications: boolean;
};

const PREFERENCE_KEY = 'cad_account_preferences';

export const defaultAccountPreferences: AccountPreferences = {
  themeMode: 'light',
  lightStart: '06:00',
  darkStart: '18:00',
  newCallSound: 'classic',
  pushNotifications: false
};

export const alertSoundOptions: Array<{ id: AlertSoundPreference; label: string }> = [
  { id: 'classic', label: 'Classic' },
  { id: 'soft', label: 'Soft' },
  { id: 'urgent', label: 'Urgent' },
  { id: 'radio', label: 'Radio' },
  { id: 'none', label: 'None' }
];

export const loadAccountPreferences = (): AccountPreferences => {
  try {
    const stored = localStorage.getItem(PREFERENCE_KEY);
    return stored ? { ...defaultAccountPreferences, ...JSON.parse(stored) } : defaultAccountPreferences;
  } catch {
    return defaultAccountPreferences;
  }
};

export const saveAccountPreferences = (preferences: AccountPreferences): void => {
  localStorage.setItem(PREFERENCE_KEY, JSON.stringify(preferences));
};

export const resolveThemePreference = (preferences: AccountPreferences, now = new Date()): 'light' | 'dark' => {
  if (preferences.themeMode === 'light' || preferences.themeMode === 'dark') return preferences.themeMode;
  const current = minutesForTime(`${now.getHours()}:${now.getMinutes()}`);
  const lightStart = minutesForTime(preferences.lightStart);
  const darkStart = minutesForTime(preferences.darkStart);
  if (lightStart === darkStart) return 'light';
  if (lightStart < darkStart) {
    return current >= lightStart && current < darkStart ? 'light' : 'dark';
  }
  return current >= lightStart || current < darkStart ? 'light' : 'dark';
};

export const playCadAlertSound = (sound: AlertSoundPreference, kind: 'message' | 'call'): void => {
  if (sound === 'none') return;
  try {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(sound === 'urgent' ? 0.12 : 0.08, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.38);
    gain.connect(context.destination);

    const pattern = soundPattern(sound, kind);
    pattern.forEach((tone) => {
      const oscillator = context.createOscillator();
      oscillator.type = tone.type;
      oscillator.frequency.value = tone.frequency;
      oscillator.connect(gain);
      oscillator.start(context.currentTime + tone.start);
      oscillator.stop(context.currentTime + tone.stop);
    });
  } catch {
    // Browsers may block audio before user interaction.
  }
};

export const notifyIfAllowed = (title: string, body: string, preferences: AccountPreferences): void => {
  if (!preferences.pushNotifications || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body });
  } catch {
    // Notifications are best-effort.
  }
};

const minutesForTime = (value: string): number => {
  const [rawHour = '0', rawMinute = '0'] = value.split(':');
  const hour = Math.min(23, Math.max(0, Number(rawHour) || 0));
  const minute = Math.min(59, Math.max(0, Number(rawMinute) || 0));
  return hour * 60 + minute;
};

const soundPattern = (
  sound: Exclude<AlertSoundPreference, 'none'>,
  kind: 'message' | 'call'
): Array<{ frequency: number; start: number; stop: number; type: OscillatorType }> => {
  if (sound === 'soft') return [{ frequency: kind === 'message' ? 660 : 480, start: 0, stop: 0.2, type: 'sine' }];
  if (sound === 'urgent') {
    return [
      { frequency: 740, start: 0, stop: 0.12, type: 'square' },
      { frequency: 560, start: 0.14, stop: 0.28, type: 'square' },
      { frequency: 740, start: 0.3, stop: 0.42, type: 'square' }
    ];
  }
  if (sound === 'radio') {
    return [
      { frequency: 420, start: 0, stop: 0.1, type: 'sawtooth' },
      { frequency: 520, start: 0.12, stop: 0.24, type: 'triangle' }
    ];
  }
  return [{ frequency: kind === 'message' ? 740 : 520, start: 0, stop: 0.24, type: kind === 'message' ? 'sine' : 'triangle' }];
};
