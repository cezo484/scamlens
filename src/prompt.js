// ScamLens prompts and reply parsers, shared by the model paths
// (hybrid SDK, direct on-device). The local heuristics path does not use
// these: it screens with rules instead. Parsers are tolerant: a model reply
// that is not clean JSON still yields a usable result when possible, and a
// reply that cannot be read at all fails loudly so the fallback chain can
// take over.

import { VERDICTS, SCAM_TYPES } from './heuristics.js';

export const SCREEN_SYSTEM_PROMPT =
  'You are a scam detection assistant. You analyze messages people receive ' +
  'in chats, emails and DMs and judge whether they are scams. Answer only ' +
  'with the requested JSON.';

export function buildScreenPrompt(message) {
  return [
    'Analyze the message below for scam signals. Reply with JSON only, no other text, using exactly this shape:',
    '{"verdict": "safe|suspicious|scam", "riskScore": 0-100, "scamType": "none|phishing|impersonation|fake-airdrop|investment|seed-phrase-theft|malware|other", "redFlags": ["short flag", "..."], "summary": "one sentence"}',
    '',
    'Rules:',
    '- verdict "scam" when the message clearly tries to steal money, secrets or access.',
    '- verdict "suspicious" when it has warning signs but could be legitimate.',
    '- verdict "safe" when nothing looks wrong.',
    '- riskScore 0 means clearly safe, 100 means clearly a scam.',
    '- redFlags: short plain-language reasons, at most 5. Empty array when safe.',
    '- scamType "none" when safe.',
    '',
    'Message:',
    '"""',
    message,
    '"""',
  ].join('\n');
}

export function buildExplainPrompt(message, screening) {
  return [
    'Explain this message to a non-technical person in plain English. Keep it short: at most 150 words.',
    '',
    `The message was screened as: verdict ${screening.verdict}, risk score ${screening.riskScore}/100, type ${screening.scamType}.`,
    `Red flags found: ${screening.redFlags.length > 0 ? screening.redFlags.join('; ') : 'none'}.`,
    '',
    'Cover three things in three short paragraphs:',
    '1. What this message is trying to do.',
    '2. The warning signs, in plain words.',
    '3. What the person should do next.',
    '',
    'Message:',
    '"""',
    message,
    '"""',
  ].join('\n');
}

// Extract the first {...} JSON object from a reply that may carry extra
// text or markdown fences around it.
function extractJsonObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function cleanString(value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

export function parseScreenReply(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, reason: 'empty reply' };
  }
  const obj = extractJsonObject(text);
  if (!obj) return { ok: false, reason: 'no JSON object in reply' };

  const verdict = VERDICTS.includes(obj.verdict) ? obj.verdict : null;
  if (!verdict) return { ok: false, reason: 'missing or invalid verdict' };

  const riskScore =
    typeof obj.riskScore === 'number' && Number.isFinite(obj.riskScore)
      ? Math.max(0, Math.min(100, Math.round(obj.riskScore)))
      : verdict === 'scam'
        ? 85
        : verdict === 'suspicious'
          ? 50
          : 5;

  const scamType = SCAM_TYPES.includes(obj.scamType) ? obj.scamType : 'other';
  const redFlags = Array.isArray(obj.redFlags)
    ? obj.redFlags.filter((f) => typeof f === 'string' && f.trim() !== '').slice(0, 5)
    : [];
  const summary = cleanString(
    obj.summary,
    verdict === 'scam'
      ? 'This message shows strong scam signals.'
      : verdict === 'suspicious'
        ? 'This message has some warning signs.'
        : 'No scam signals found in this message.',
  );

  return {
    ok: true,
    screening: { verdict, riskScore, scamType, redFlags, summary, urls: [] },
  };
}

// The explanation is free text. Accept it as-is after light cleanup.
export function parseExplainReply(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, reason: 'empty reply' };
  }
  const cleaned = text
    .replace(/```[a-z]*\n?/gi, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
  if (cleaned === '') return { ok: false, reason: 'empty reply after cleanup' };
  return { ok: true, explanation: cleaned };
}
