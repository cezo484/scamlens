// ScamLens local heuristics: a rule-based screener that runs entirely on
// the page with no model and no network. It is the fallback path when the
// on-device and cloud model paths are unavailable, and it also powers the
// URL inspector and the local explanation. It never claims certainty: it
// returns a risk score and the flags that produced it.

export const VERDICTS = ['safe', 'suspicious', 'scam'];

export const SCAM_TYPES = [
  'none',
  'phishing',
  'impersonation',
  'fake-airdrop',
  'investment',
  'seed-phrase-theft',
  'malware',
  'other',
];

// Each rule: id, human-readable flag, weight, and the scam type it points
// to. Weights add up into the risk score (clamped to 0-100).
const RULES = [
  {
    id: 'seed-phrase',
    flag: 'Asks for your seed phrase, recovery phrase or private key',
    weight: 60,
    type: 'seed-phrase-theft',
    test: /(seed phrase|recovery phrase|secret phrase|private key|mnemonic|12 words|24 words|secret recovery)/i,
  },
  {
    id: 'wallet-connect',
    flag: 'Asks you to connect, verify or sync your wallet',
    weight: 30,
    type: 'phishing',
    test: /(connect (your )?wallet|verify your wallet|validate (your )?wallet|sync (your )?wallet|link your wallet)/i,
  },
  {
    id: 'impersonation',
    flag: 'Claims to be support, an admin or an official account',
    weight: 25,
    type: 'impersonation',
    test: /(support team|official support|customer (service|support)|i am (an )?admin|this is .* support|admin team|help ?desk)/i,
  },
  {
    id: 'urgency',
    flag: 'Creates urgency: act now or lose access',
    weight: 20,
    type: 'other',
    test: /(act (now|immediately|fast)|urgent|limited time|expires (in|soon|today)|last chance|within 24 hours|account will be (suspended|closed|locked|deleted)|immediate action)/i,
  },
  {
    id: 'too-good',
    flag: 'Promises free money or guaranteed returns',
    weight: 25,
    type: 'investment',
    test: /(double your|triple your|guaranteed (profit|returns?|income)|risk-?free|100x|1000x|earn .* per day|passive income|no risk)/i,
  },
  {
    id: 'fake-airdrop',
    flag: 'Offers an airdrop or prize you did not enter',
    weight: 30,
    type: 'fake-airdrop',
    test: /(you (have )?been selected|you (have )?won|congratulations.*(won|selected|airdrop)|claim your .*airdrop|free .* tokens?|giveaway.*claim)/i,
  },
  {
    id: 'upfront-fee',
    flag: 'Asks for a fee or deposit to unlock something',
    weight: 30,
    type: 'other',
    test: /(gas fee .* to (claim|unlock)|fee .* to (claim|unlock|receive)|pay .* to (unlock|claim|activate|release)|deposit .* to start|send .* to (this|the) address)/i,
  },
  {
    id: 'account-threat',
    flag: 'Threatens your account: flagged, hacked, suspended',
    weight: 20,
    type: 'phishing',
    test: /(account (has been )?(flagged|hacked|compromised|suspended)|suspicious activity (on|in) your account|unusual (login|activity)|security alert)/i,
  },
  {
    id: 'dm-offer',
    flag: 'Unsolicited money offer in a direct message',
    weight: 15,
    type: 'investment',
    test: /(dm me|message me|contact me.*(earn|profit|invest)|i made \$|made \$[0-9,]+ last week)/i,
  },
  {
    id: 'download',
    flag: 'Asks you to download or install something',
    weight: 20,
    type: 'malware',
    test: /(download (this|the|our) (app|file|wallet|update)|install (this|the) (app|update)|run (this|the) file|apk|new version.*download)/i,
  },
];

const URL_SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly',
  'cutt.ly', 'shorturl.at', 'rebrand.ly', 'shorte.st', 'adf.ly',
]);

const SUSPICIOUS_TLDS = new Set([
  'xyz', 'top', 'click', 'buzz', 'work', 'live', 'online', 'site', 'fun',
  'icu', 'cyou', 'shop', 'link', 'pw', 'cc', 'ru',
]);

// Well-known crypto/finance brands and their real domains. A link that
// contains a brand name but is not on the real domain is a lookalike.
const BRAND_DOMAINS = [
  ['binance', 'binance.com'],
  ['coinbase', 'coinbase.com'],
  ['metamask', 'metamask.io'],
  ['trust wallet', 'trustwallet.com'],
  ['kraken', 'kraken.com'],
  ['okx', 'okx.com'],
  ['phantom', 'phantom.app'],
  ['ledger', 'ledger.com'],
  ['trezor', 'trezor.io'],
  ['uniswap', 'uniswap.org'],
  ['opensea', 'opensea.io'],
  ['bybit', 'bybit.com'],
  ['kucoin', 'kucoin.com'],
  ['telegram', 'telegram.org'],
  ['discord', 'discord.com'],
  ['solana', 'solana.com'],
  ['ethereum', 'ethereum.org'],
];

// Links with a scheme (or www.) plus bare domains like arb-claim.xyz,
// which scam DMs often paste without a scheme. The bare-domain pattern
// only matches names ending in a real TLD, so version numbers (1.2.3) and
// times (10.30) do not match.
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;
const BARE_DOMAIN_RE =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|xyz|app|co|me|gg|top|click|buzz|live|online|site|fun|shop|link|info|biz|us|ru|cc|pw|icu|cyou|work)\b/gi;

export function extractUrls(text) {
  const found = (text.match(URL_RE) || []).map((u) => u.replace(/[.,;:!?]+$/, ''));
  const remainder = found.reduce((t, u) => t.replace(u, ' '), text);
  for (const bare of remainder.match(BARE_DOMAIN_RE) || []) {
    found.push(bare);
  }
  return [...new Set(found)];
}

function hostOf(url) {
  try {
    const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function analyzeUrl(rawUrl) {
  const url = rawUrl;
  const host = hostOf(url);
  const flags = [];
  let weight = 0;

  if (!host) return { url, host: '', flags: ['Could not parse this link'], weight: 10 };

  if (host.includes('xn--')) {
    flags.push('Punycode in the domain: it may look like a brand it is not');
    weight += 30;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    flags.push('The link points at a raw IP address, not a named site');
    weight += 30;
  }
  if (URL_SHORTENERS.has(host) || URL_SHORTENERS.has(host.replace(/^www\./, ''))) {
    flags.push('URL shortener hides the real destination');
    weight += 20;
  }
  const tld = host.split('.').pop();
  if (SUSPICIOUS_TLDS.has(tld)) {
    flags.push(`Uncommon top-level domain (.${tld}), often used for throwaway scam sites`);
    weight += 15;
  }
  if (/^http:\/\//i.test(url)) {
    flags.push('Plain HTTP link: the connection is not encrypted');
    weight += 10;
  }
  if (host.split('.').length > 4) {
    flags.push('Unusually deep subdomain chain, often used to fake a brand');
    weight += 10;
  }
  if (url.includes('@')) {
    flags.push('Contains @ in the link, a classic way to hide the real host');
    weight += 20;
  }
  for (const [brand, real] of BRAND_DOMAINS) {
    const brandKey = brand.replace(/\s+/g, '');
    if (host.includes(brandKey) && host !== real && !host.endsWith(`.${real}`)) {
      flags.push(`Mentions ${brand} but is not the official ${real} domain`);
      weight += 35;
      break;
    }
  }
  if (url.length > 120) {
    flags.push('Very long link, often used to hide the real destination');
    weight += 5;
  }

  return { url, host, flags, weight };
}

export function analyzeUrls(text) {
  return extractUrls(text).map(analyzeUrl);
}

// Pick the most likely scam type from the matched rules, preferring the
// highest-weight rule that names a specific type.
function pickType(matches) {
  let best = { weight: 0, type: 'none' };
  for (const m of matches) {
    if (m.type !== 'other' && m.type !== 'none' && m.weight > best.weight) {
      best = m;
    }
  }
  if (best.type !== 'none') return best.type;
  return matches.length > 0 ? 'other' : 'none';
}

function verdictFor(score, matches) {
  const seedAsked = matches.some((m) => m.id === 'seed-phrase');
  if (seedAsked) return 'scam';
  if (score >= 65) return 'scam';
  if (score >= 30) return 'suspicious';
  return 'safe';
}

function summaryFor(verdict, matches, urls) {
  if (verdict === 'scam') {
    return 'This message shows strong scam signals. Do not click any link, do not reply, and never share your seed phrase or private key.';
  }
  if (verdict === 'suspicious') {
    return 'This message has some warning signs. Treat it with caution: verify the sender through an official channel before acting on it.';
  }
  const flaggedUrls = urls.filter((u) => u.flags.length > 0).length;
  if (flaggedUrls > 0) {
    return 'The message text looks ordinary, but at least one link in it looks risky. Check the link inspector below.';
  }
  return 'No scam signals found in this message. Stay alert anyway: a clean scan does not prove a message is safe.';
}

// Main entry: screen a message with local rules only.
export function screenLocally(text) {
  const matches = RULES.filter((r) => r.test.test(text));
  const urls = analyzeUrls(text);
  const urlWeight = urls.reduce((sum, u) => sum + u.weight, 0);
  const ruleWeight = matches.reduce((sum, m) => sum + m.weight, 0);
  let score = Math.min(100, ruleWeight + urlWeight);
  if (matches.length === 0 && urls.every((u) => u.flags.length === 0)) score = 5;
  if (matches.some((m) => m.id === 'seed-phrase')) score = Math.max(score, 85);

  const verdict = verdictFor(score, matches);
  const redFlags = matches.map((m) => m.flag);
  for (const u of urls) {
    for (const f of u.flags) redFlags.push(`Link ${u.host}: ${f}`);
  }
  return {
    verdict,
    riskScore: score,
    scamType: pickType(matches),
    redFlags,
    urls,
    summary: summaryFor(verdict, matches, urls),
  };
}

// Build a plain-language explanation from a screening result, without any
// model. Used when the cloud explanation path is unavailable.
export function explainLocally(text, screening) {
  const lines = [];
  if (screening.verdict === 'scam') {
    lines.push('This message looks like a scam. Here is why:');
  } else if (screening.verdict === 'suspicious') {
    lines.push('This message is suspicious. Here is what stood out:');
  } else {
    lines.push('Nothing in this message matched known scam patterns. A few general notes:');
  }
  for (const flag of screening.redFlags.slice(0, 6)) {
    lines.push(`- ${flag}.`);
  }
  if (screening.redFlags.length === 0) {
    lines.push('- No urgency tricks, no requests for secrets, no suspicious links.');
  }
  lines.push('');
  lines.push('What to do:');
  if (screening.verdict === 'safe') {
    lines.push('- If you were not expecting this message, still verify the sender before acting on it.');
    lines.push('- Never share your seed phrase or private key with anyone, for any reason.');
  } else {
    lines.push('- Do not click links or reply to the sender.');
    lines.push('- Never share your seed phrase, private key, or wallet approval with anyone.');
    lines.push('- Block the sender and report the message in the app where you got it.');
    lines.push('- If it claims to be a company, reach them through their official site or app, never through a link in the message.');
  }
  return lines.join('\n');
}
