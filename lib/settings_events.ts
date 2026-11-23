/**
 * Screens in a React Navigation stack stay mounted after navigation, so a
 * screen cannot rely on mount effects to pick up settings changed elsewhere.
 * Persisters emit an event and the inbox view reloads from storage.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeToSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifySettingsChanged(): void {
  for (const listener of [...listeners]) {
    try { listener(); } catch { /* one bad listener must not break saving */ }
  }
}
