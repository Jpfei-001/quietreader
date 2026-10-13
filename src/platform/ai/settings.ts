import { DEFAULT_AI_PREFERENCES, type AiPreferences, type AiMode } from './types';
export const AI_SETTINGS_KEY = 'quiet-reader:ai-preferences:v1';
export function isAiMode(value: unknown): value is AiMode { return value === 'expanded' || value === 'detached' || value === 'floating'; }
export function normalizeAiPreferences(value: unknown): AiPreferences {
  const p = typeof value === 'object' && value ? value as Partial<AiPreferences> : {};
  return { version: 1, model: typeof p.model === 'string' && /^[a-zA-Z0-9._:/-]{1,100}$/.test(p.model) ? p.model : DEFAULT_AI_PREFERENCES.model, preferredMode: isAiMode(p.preferredMode) ? p.preferredMode : 'expanded' };
}
export function loadAiPreferences(): AiPreferences { try { return normalizeAiPreferences(JSON.parse(localStorage.getItem(AI_SETTINGS_KEY) ?? 'null')); } catch { return { ...DEFAULT_AI_PREFERENCES }; } }
export function saveAiPreferences(preferences: AiPreferences) { localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(normalizeAiPreferences(preferences))); }
