// ScamLens path selection: which engine screens a message, and which one
// explains it. Two independent chains, because screening and explaining
// have different privacy needs.
//
// Screen chain (the verdict):
//   HYBRID -> DIRECT -> LOCAL
//   HYBRID: Firebase AI Logic hybrid SDK, PREFER_ON_DEVICE. The SDK runs
//     Gemini Nano on-device when available and falls back to the cloud
//     model otherwise. Needs a Firebase config. The response tells us
//     which one actually ran (inferenceSource: ON_DEVICE or IN_CLOUD).
//   DIRECT: Chrome Prompt API directly, no Firebase needed. Used when the
//     app has no Firebase config but the browser has an on-device model.
//   LOCAL: rule-based heuristics on the page. Always available, so the
//     demo works with no setup at all.
//
// Explain chain (the deep analysis, only on an explicit tap):
//   CLOUD -> LOCAL
//   CLOUD: Firebase AI Logic, ONLY_IN_CLOUD. The message leaves the device
//     only because the user asked for the explanation.
//   LOCAL: explanation built from the heuristic flags.

export const HYBRID = 'hybrid';
export const DIRECT = 'direct';
export const LOCAL = 'local';
export const CLOUD = 'cloud';

export const SCREEN_ORDER = [HYBRID, DIRECT, LOCAL];
export const EXPLAIN_ORDER = [CLOUD, LOCAL];

export const PATH_LABELS = {
  [HYBRID]: 'Hybrid (Firebase AI Logic)',
  [DIRECT]: 'On-device (Gemini Nano)',
  [LOCAL]: 'Local heuristics',
  [CLOUD]: 'Cloud (Firebase AI Logic)',
};

// The label shown when the hybrid SDK reports which inference source it
// actually used for a given request.
export const HYBRID_SOURCE_LABELS = {
  ON_DEVICE: 'On-device (Gemini Nano)',
  IN_CLOUD: 'Cloud (Firebase AI Logic)',
};

export const PATH_NOTES = {
  [HYBRID]: 'Screened through Firebase AI Logic hybrid inference.',
  [DIRECT]: 'Screened on-device by Gemini Nano. The message never left this device.',
  [LOCAL]: 'Screened by on-page rules. No model was available.',
  [CLOUD]: 'Explained by a cloud Gemini model through Firebase AI Logic.',
};

// onDevice: 'available' | 'downloading' | 'downloadable' | 'unavailable' | 'unknown'
// (the status strings from the Prompt API availability check).
export function selectScreenPath({ firebaseConfigured, onDevice }) {
  if (firebaseConfigured) return HYBRID;
  if (onDevice === 'available' || onDevice === 'downloading') return DIRECT;
  return LOCAL;
}

export function selectExplainPath({ firebaseConfigured }) {
  return firebaseConfigured ? CLOUD : LOCAL;
}

export function nextScreenFallback(path) {
  const i = SCREEN_ORDER.indexOf(path);
  return i >= 0 && i + 1 < SCREEN_ORDER.length ? SCREEN_ORDER[i + 1] : null;
}

export function nextExplainFallback(path) {
  const i = EXPLAIN_ORDER.indexOf(path);
  return i >= 0 && i + 1 < EXPLAIN_ORDER.length ? EXPLAIN_ORDER[i + 1] : null;
}
