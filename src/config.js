// Firebase config validation for ScamLens. The web app loads its config
// from web/firebaseConfig.js, a gitignored file the user fills in from the
// Firebase console. Without it, the cloud and hybrid paths stay off and the
// app still works through the direct on-device path and local heuristics.

export const REQUIRED_FIELDS = ['apiKey', 'authDomain', 'projectId', 'appId'];

export const DEFAULT_CLOUD_MODEL = 'gemini-2.5-flash-lite';

export function validateFirebaseConfig(config) {
  if (!config || typeof config !== 'object') {
    return { ok: false, missing: REQUIRED_FIELDS.slice() };
  }
  const missing = REQUIRED_FIELDS.filter(
    (field) => typeof config[field] !== 'string' || config[field].trim() === '',
  );
  return { ok: missing.length === 0, missing };
}

export function normalizeFirebaseConfig(config) {
  return {
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    appId: config.appId,
    model:
      typeof config.model === 'string' && config.model.trim() !== ''
        ? config.model.trim()
        : DEFAULT_CLOUD_MODEL,
    appCheckSiteKey:
      typeof config.appCheckSiteKey === 'string' ? config.appCheckSiteKey : '',
    appCheckDebug: config.appCheckDebug === true,
  };
}
