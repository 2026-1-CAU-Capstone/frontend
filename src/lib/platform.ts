/**
 * Runtime environment detection. Capacitor is dynamically imported so the
 * web build doesn't need it at all — if the dependency isn't installed yet
 * (or the bundle is being served outside a native shell) the helpers fall
 * back to web behavior.
 */

let cachedNative: boolean | null = null;

/** True when running inside a Capacitor-wrapped iOS/Android app. */
export function isNativeApp(): boolean {
  if (cachedNative !== null) return cachedNative;
  try {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    cachedNative = !!cap?.isNativePlatform?.();
  } catch {
    cachedNative = false;
  }
  return cachedNative;
}

/** True when running inside the Capacitor iOS shell specifically. */
export function isIosApp(): boolean {
  if (!isNativeApp()) return false;
  try {
    const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
    return cap?.getPlatform?.() === 'ios';
  } catch {
    return false;
  }
}
