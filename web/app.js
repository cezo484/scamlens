// ScamLens browser wiring: detect the on-device model, load the optional
// Firebase config, and run the two fallback chains.
//
// Screen chain (the verdict): hybrid (Firebase AI Logic PREFER_ON_DEVICE)
// -> direct (Chrome Prompt API) -> local (on-page heuristics).
// Explain chain (deep analysis, only on an explicit tap): cloud (Firebase
// AI Logic ONLY_IN_CLOUD) -> local (built from the heuristic flags).
//
// The badge on each result says which path produced it. For the hybrid
// path the badge uses the SDK's own inferenceSource, so it reports what
// actually ran: on-device or in-cloud.

import { screenLocally, analyzeUrls, explainLocally } from '../src/heuristics.js';
import {
  selectScreenPath,
  selectExplainPath,
  nextScreenFallback,
  nextExplainFallback,
  PATH_LABELS,
  PATH_NOTES,
  HYBRID_SOURCE_LABELS,
  HYBRID,
  DIRECT,
  LOCAL,
  CLOUD,
} from '../src/path.js';
import { validateFirebaseConfig, normalizeFirebaseConfig } from '../src/config.js';
import {
  buildScreenPrompt,
  buildExplainPrompt,
  parseScreenReply,
  parseExplainReply,
  SCREEN_SYSTEM_PROMPT,
} from '../src/prompt.js';
import { SAMPLE_MESSAGES } from '../src/samples.js';

const $ = (id) => document.getElementById(id);
const HISTORY_KEY = 'scamlens-history';
const HISTORY_LIMIT = 10;

const state = {
  onDevice: 'unknown',
  cloudConfig: null,
  firebaseApp: null,
  hybridModel: null,
  explainModel: null,
  deviceModelInitDone: false,
  deviceSession: null,
  lastScreening: null,
  lastMessage: null,
  lastPath: null,
  lastPathLabel: null,
};

// --- On-device detection (Chrome Prompt API) -----------------------------

function hasLanguageModel() {
  return typeof LanguageModel !== 'undefined' && typeof LanguageModel.availability === 'function';
}

function legacyLanguageModel() {
  if (typeof window !== 'undefined' && window.ai && window.ai.languageModel) {
    return window.ai.languageModel;
  }
  return null;
}

async function detectOnDevice() {
  if (hasLanguageModel()) {
    try {
      const status = await LanguageModel.availability();
      return ['available', 'downloading', 'downloadable', 'unavailable'].includes(status)
        ? status
        : 'unavailable';
    } catch {
      return 'unavailable';
    }
  }
  const legacy = legacyLanguageModel();
  if (legacy && typeof legacy.capabilities === 'function') {
    try {
      const caps = await legacy.capabilities();
      if (caps.available === 'readily') return 'available';
      if (caps.available === 'after-download') return 'downloadable';
      return 'unavailable';
    } catch {
      return 'unavailable';
    }
  }
  return 'unavailable';
}

async function createDeviceSession(onProgress) {
  if (hasLanguageModel()) {
    const options = onProgress
      ? {
          monitor(m) {
            m.addEventListener('downloadprogress', (e) => onProgress(e.loaded));
          },
        }
      : {};
    return LanguageModel.create(options);
  }
  const legacy = legacyLanguageModel();
  if (legacy && typeof legacy.create === 'function') {
    return legacy.create();
  }
  throw new Error('Prompt API is not available in this browser');
}

// --- Firebase setup -------------------------------------------------------

async function loadCloudConfig() {
  try {
    const module = await import('./firebaseConfig.js');
    const check = validateFirebaseConfig(module.firebaseConfig);
    if (!check.ok) {
      console.info('Firebase config incomplete, missing:', check.missing.join(', '));
      return null;
    }
    return normalizeFirebaseConfig(module.firebaseConfig);
  } catch {
    // No firebaseConfig.js file: the cloud and hybrid paths stay off. This
    // is the normal state for a fresh checkout.
    return null;
  }
}

async function initFirebaseApp() {
  if (state.firebaseApp) return state.firebaseApp;
  const { initializeApp } = await import('firebase/app');
  const app = initializeApp(state.cloudConfig);
  if (state.cloudConfig.appCheckSiteKey) {
    const { initializeAppCheck, ReCaptchaV3Provider } = await import('firebase/app-check');
    if (state.cloudConfig.appCheckDebug) {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(state.cloudConfig.appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }
  state.firebaseApp = app;
  return app;
}

async function initHybridModel() {
  if (state.hybridModel) return state.hybridModel;
  const app = await initFirebaseApp();
  const { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } = await import('firebase/ai');
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  state.hybridModel = getGenerativeModel(ai, {
    mode: InferenceMode.PREFER_ON_DEVICE,
    inCloudParams: {
      model: state.cloudConfig.model,
      generationConfig: { maxOutputTokens: 512 },
    },
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
        initialPrompts: [
          { role: 'system', content: [{ type: 'text', value: SCREEN_SYSTEM_PROMPT }] },
        ],
      },
    },
  });
  return state.hybridModel;
}

async function initExplainModel() {
  if (state.explainModel) return state.explainModel;
  const app = await initFirebaseApp();
  const { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } = await import('firebase/ai');
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  state.explainModel = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: state.cloudConfig.model,
      generationConfig: { maxOutputTokens: 1024 },
    },
  });
  return state.explainModel;
}

// initializeDeviceModel must run after a user interaction and before the
// first hybrid generateContent call. Called lazily on the first screen and
// from the Prepare button. A failure here is not fatal: PREFER_ON_DEVICE
// can still fall back to the cloud model.
async function ensureDeviceModelReady(onProgress) {
  if (state.deviceModelInitDone) return;
  const model = await initHybridModel();
  try {
    await model.initializeDeviceModel((value) => {
      if (onProgress) onProgress(value);
    });
  } catch (error) {
    console.info('On-device model init did not complete:', error.message || error);
  }
  state.deviceModelInitDone = true;
}

// --- Screen paths ---------------------------------------------------------

async function screenHybrid(message) {
  await ensureDeviceModelReady();
  const model = await initHybridModel();
  const result = await model.generateContent(buildScreenPrompt(message));
  const parsed = parseScreenReply(result.response.text());
  if (!parsed.ok) {
    throw new Error(`Hybrid reply could not be read (${parsed.reason})`);
  }
  const source = result.response.inferenceSource || 'IN_CLOUD';
  return { screening: parsed.screening, source };
}

async function screenDirect(message) {
  if (!state.deviceSession) {
    state.deviceSession = await createDeviceSession();
  }
  const text = await state.deviceSession.prompt(buildScreenPrompt(message));
  const parsed = parseScreenReply(text);
  if (!parsed.ok) {
    throw new Error(`On-device reply could not be read (${parsed.reason})`);
  }
  return { screening: parsed.screening, source: 'ON_DEVICE' };
}

function attachUrlFindings(screening, message) {
  const urls = analyzeUrls(message);
  const flags = [];
  for (const u of urls) {
    for (const f of u.flags) flags.push(`Link ${u.host}: ${f}`);
  }
  return {
    ...screening,
    urls,
    redFlags: [...screening.redFlags, ...flags].slice(0, 8),
  };
}

async function screenWith(path, message) {
  if (path === HYBRID) {
    const { screening, source } = await screenHybrid(message);
    return { screening: attachUrlFindings(screening, message), label: HYBRID_SOURCE_LABELS[source] || PATH_LABELS[HYBRID] };
  }
  if (path === DIRECT) {
    const { screening } = await screenDirect(message);
    return { screening: attachUrlFindings(screening, message), label: PATH_LABELS[DIRECT] };
  }
  // Local path: screenLocally already merges URL findings into its flags.
  return { screening: screenLocally(message), label: PATH_LABELS[LOCAL] };
}

async function runScreen(message) {
  const attempts = [];
  let path = selectScreenPath({ firebaseConfigured: !!state.cloudConfig, onDevice: state.onDevice });
  while (path) {
    if (path === HYBRID && !state.cloudConfig) {
      path = nextScreenFallback(path);
      continue;
    }
    if (path === DIRECT && state.onDevice !== 'available' && state.onDevice !== 'downloading') {
      path = nextScreenFallback(path);
      continue;
    }
    try {
      const { screening, label } = await screenWith(path, message);
      return { screening, path, label, attempts };
    } catch (error) {
      attempts.push({ path, error: error.message || String(error) });
      if (path === DIRECT && state.deviceSession) {
        try {
          state.deviceSession.destroy();
        } catch {
          // Session was already closed.
        }
        state.deviceSession = null;
      }
      path = nextScreenFallback(path);
    }
  }
  throw new Error('No path produced a screening');
}

// --- Explain paths --------------------------------------------------------

async function explainWith(path, message, screening) {
  if (path === CLOUD) {
    const model = await initExplainModel();
    const result = await model.generateContent(buildExplainPrompt(message, screening));
    const parsed = parseExplainReply(result.response.text());
    if (!parsed.ok) {
      throw new Error(`Cloud reply could not be read (${parsed.reason})`);
    }
    return { explanation: parsed.explanation, label: PATH_LABELS[CLOUD] };
  }
  return { explanation: explainLocally(message, screening), label: PATH_LABELS[LOCAL] };
}

async function runExplain(message, screening) {
  const attempts = [];
  let path = selectExplainPath({ firebaseConfigured: !!state.cloudConfig });
  while (path) {
    if (path === CLOUD && !state.cloudConfig) {
      path = nextExplainFallback(path);
      continue;
    }
    try {
      return await explainWith(path, message, screening);
    } catch (error) {
      attempts.push({ path, error: error.message || String(error) });
      path = nextExplainFallback(path);
    }
  }
  throw new Error('No path produced an explanation');
}

// --- History (localStorage, snippets only) ---------------------------------

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(entries) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_LIMIT)));
  } catch {
    // Storage full or unavailable: history is a nice-to-have.
  }
}

function addHistoryEntry(message, screening, label) {
  const entries = loadHistory();
  entries.unshift({
    snippet: message.replace(/\s+/g, ' ').slice(0, 60),
    verdict: screening.verdict,
    riskScore: screening.riskScore,
    pathLabel: label,
    time: new Date().toISOString(),
  });
  saveHistory(entries);
  renderHistory();
}

function renderHistory() {
  const entries = loadHistory();
  $('history-section').hidden = entries.length === 0;
  const list = $('history-list');
  list.innerHTML = '';
  for (const entry of entries) {
    const li = document.createElement('li');
    const verdict = document.createElement('span');
    verdict.className = 'verdict verdict-mini';
    verdict.dataset.tone = entry.verdict;
    verdict.textContent = entry.verdict.toUpperCase();
    const text = document.createElement('span');
    const when = new Date(entry.time).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    text.textContent = ` ${entry.snippet}... (${entry.riskScore}/100, ${entry.pathLabel}, ${when})`;
    li.append(verdict, text);
    list.append(li);
  }
}

// --- UI --------------------------------------------------------------------

const DEVICE_STATUS_TEXT = {
  available: 'Ready',
  downloading: 'Downloading model',
  downloadable: 'Model not downloaded yet',
  unavailable: 'Not available in this browser',
  unknown: 'Checking...',
};

const VERDICT_TEXT = {
  safe: 'SAFE',
  suspicious: 'SUSPICIOUS',
  scam: 'SCAM',
};

const SCAM_TYPE_TEXT = {
  none: 'No scam type detected',
  phishing: 'Type: phishing',
  impersonation: 'Type: impersonation',
  'fake-airdrop': 'Type: fake airdrop',
  investment: 'Type: investment scam',
  'seed-phrase-theft': 'Type: seed phrase theft',
  malware: 'Type: malware',
  other: 'Type: other scam',
};

function refreshStatus() {
  const deviceBadge = $('device-status');
  deviceBadge.textContent = DEVICE_STATUS_TEXT[state.onDevice] || 'Unknown';
  deviceBadge.dataset.tone =
    state.onDevice === 'available' ? 'good' : state.onDevice === 'unavailable' ? 'bad' : 'warn';
  $('prepare-button').hidden = !(state.onDevice === 'downloadable' || state.onDevice === 'downloading');

  const cloudBadge = $('cloud-status');
  if (state.cloudConfig) {
    cloudBadge.textContent = `Configured (model ${state.cloudConfig.model})`;
    cloudBadge.dataset.tone = 'good';
  } else {
    cloudBadge.textContent = 'No Firebase config, on-device and local paths cover it';
    cloudBadge.dataset.tone = 'warn';
  }
}

function renderResult(screening, path, label, attempts, elapsedMs) {
  const badge = $('path-badge');
  badge.textContent = label;
  badge.dataset.tone = path === LOCAL ? 'plain' : path === HYBRID ? 'good' : 'good';
  $('path-note').textContent = `${PATH_NOTES[path] || ''} Took ${elapsedMs} ms.`;
  const log = $('attempt-log');
  if (attempts.length > 0) {
    log.textContent =
      'Tried first: ' +
      attempts.map((a) => `${PATH_LABELS[a.path]} failed (${a.error})`).join('; ');
    log.hidden = false;
  } else {
    log.hidden = true;
  }

  const verdictEl = $('verdict-badge');
  verdictEl.textContent = VERDICT_TEXT[screening.verdict];
  verdictEl.dataset.tone = screening.verdict;
  $('risk-text').textContent = `Risk score: ${screening.riskScore}/100`;
  const fill = $('risk-fill');
  fill.style.width = `${screening.riskScore}%`;
  fill.dataset.tone = screening.verdict;
  $('scam-type').textContent = SCAM_TYPE_TEXT[screening.scamType] || '';
  $('summary').textContent = screening.summary;

  const flagsEl = $('red-flags');
  flagsEl.innerHTML = '';
  if (screening.redFlags.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'None found.';
    flagsEl.append(li);
  } else {
    for (const flag of screening.redFlags) {
      const li = document.createElement('li');
      li.textContent = flag;
      flagsEl.append(li);
    }
  }

  const urls = screening.urls || [];
  $('links-block').hidden = urls.length === 0;
  const linkList = $('link-list');
  linkList.innerHTML = '';
  for (const u of urls) {
    const li = document.createElement('li');
    const host = document.createElement('strong');
    host.textContent = u.host || u.url;
    li.append(host);
    if (u.flags.length === 0) {
      li.append(document.createTextNode(': no link tricks found.'));
    } else {
      const sub = document.createElement('ul');
      for (const f of u.flags) {
        const sli = document.createElement('li');
        sli.textContent = f;
        sub.append(sli);
      }
      li.append(sub);
    }
    linkList.append(li);
  }

  $('explanation-block').hidden = true;
  $('result-section').hidden = false;
}

async function onScreen() {
  const message = $('message').value.trim();
  const errorEl = $('error');
  errorEl.hidden = true;
  if (!message) {
    errorEl.textContent = 'Paste a message first, or pick a sample.';
    errorEl.hidden = false;
    return;
  }
  if (message.length > 4000) {
    errorEl.textContent = 'That message is too long. Keep it under 4000 characters.';
    errorEl.hidden = false;
    return;
  }
  const button = $('screen-button');
  button.disabled = true;
  button.textContent = 'Screening...';
  const started = Date.now();
  try {
    const { screening, path, label, attempts } = await runScreen(message);
    state.lastScreening = screening;
    state.lastMessage = message;
    state.lastPath = path;
    state.lastPathLabel = label;
    renderResult(screening, path, label, attempts, Date.now() - started);
    addHistoryEntry(message, screening, label);
  } catch (error) {
    errorEl.textContent = `Could not screen the message: ${error.message || error}`;
    errorEl.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = 'Screen this message';
  }
}

async function onExplain() {
  if (!state.lastScreening || !state.lastMessage) return;
  const button = $('explain-button');
  button.disabled = true;
  button.textContent = 'Explaining...';
  try {
    const { explanation, label } = await runExplain(state.lastMessage, state.lastScreening);
    $('explanation-text').textContent = explanation;
    const badge = $('explain-badge');
    badge.textContent = label;
    badge.dataset.tone = label === PATH_LABELS[LOCAL] ? 'plain' : 'good';
    $('explanation-block').hidden = false;
  } catch (error) {
    const errorEl = $('error');
    errorEl.textContent = `Could not explain: ${error.message || error}`;
    errorEl.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = 'Explain in detail';
  }
}

async function onPrepare() {
  const button = $('prepare-button');
  button.disabled = true;
  $('download-row').hidden = false;
  const onProgress = (loaded) => {
    $('download-progress').value = loaded;
    $('download-text').textContent = `${Math.round(loaded * 100)}%`;
  };
  try {
    if (state.cloudConfig) {
      await ensureDeviceModelReady(onProgress);
    } else {
      const session = await createDeviceSession(onProgress);
      state.deviceSession = session;
    }
    state.onDevice = await detectOnDevice();
    if (state.onDevice === 'downloading' || state.onDevice === 'downloadable') {
      state.onDevice = 'available';
    }
  } catch (error) {
    const errorEl = $('error');
    errorEl.textContent = `Could not prepare the on-device model: ${error.message || error}`;
    errorEl.hidden = false;
  } finally {
    button.disabled = false;
    $('download-row').hidden = true;
    refreshStatus();
  }
}

function resultToText() {
  const s = state.lastScreening;
  const lines = [
    `ScamLens result: ${VERDICT_TEXT[s.verdict]} (${s.riskScore}/100)`,
    SCAM_TYPE_TEXT[s.scamType] || '',
    s.summary,
    '',
    'Red flags:',
    ...(s.redFlags.length > 0 ? s.redFlags.map((f) => `- ${f}`) : ['- None found.']),
    '',
    `Screened via: ${state.lastPathLabel}`,
  ];
  return lines.join('\n');
}

async function init() {
  state.onDevice = await detectOnDevice();
  state.cloudConfig = await loadCloudConfig();
  refreshStatus();
  renderHistory();

  $('screen-button').addEventListener('click', onScreen);
  $('explain-button').addEventListener('click', onExplain);
  $('prepare-button').addEventListener('click', onPrepare);
  document.querySelectorAll('[data-sample]').forEach((button) => {
    button.addEventListener('click', () => {
      $('message').value = SAMPLE_MESSAGES[Number(button.dataset.sample)].text;
      $('message').focus();
    });
  });
  $('copy-button').addEventListener('click', async () => {
    if (!state.lastScreening) return;
    try {
      await navigator.clipboard.writeText(resultToText());
      $('copy-status').textContent = 'Copied.';
    } catch {
      $('copy-status').textContent = 'Copy failed. Select the result text by hand.';
    }
  });
  $('clear-history-button').addEventListener('click', () => {
    saveHistory([]);
    renderHistory();
  });
}

init();
