import test from 'node:test';
import assert from 'node:assert/strict';
import {
  screenLocally,
  analyzeUrl,
  analyzeUrls,
  extractUrls,
  explainLocally,
} from '../src/heuristics.js';
import { SAMPLE_MESSAGES } from '../src/samples.js';

test('sample messages get their expected verdicts', () => {
  for (const sample of SAMPLE_MESSAGES) {
    const result = screenLocally(sample.text);
    assert.equal(
      result.verdict,
      sample.expected,
      `${sample.label}: expected ${sample.expected}, got ${result.verdict} (${result.riskScore})`,
    );
  }
});

test('seed phrase request is always a scam with a high score', () => {
  const result = screenLocally('Please share your seed phrase so we can restore your wallet.');
  assert.equal(result.verdict, 'scam');
  assert.equal(result.scamType, 'seed-phrase-theft');
  assert.ok(result.riskScore >= 85);
  assert.ok(result.redFlags.some((f) => f.includes('seed phrase')));
});

test('ordinary text is safe with a low score', () => {
  const result = screenLocally('Lunch is at noon, bring the report.');
  assert.equal(result.verdict, 'safe');
  assert.ok(result.riskScore <= 10);
  assert.equal(result.scamType, 'none');
  assert.deepEqual(result.redFlags, []);
});

test('extractUrls finds scheme links and bare domains', () => {
  const urls = extractUrls('Visit https://example.com/a and also arb-claim.xyz for details.');
  assert.ok(urls.includes('https://example.com/a'));
  assert.ok(urls.includes('arb-claim.xyz'));
});

test('extractUrls ignores times and version numbers', () => {
  assert.deepEqual(extractUrls('Meet at 10.30, version 1.2.3 is out.'), []);
});

test('extractUrls strips trailing punctuation', () => {
  assert.deepEqual(extractUrls('See https://example.com/a.'), ['https://example.com/a']);
});

test('analyzeUrl flags a brand lookalike', () => {
  const result = analyzeUrl('https://binance-support-verify.com/login');
  assert.ok(result.flags.some((f) => f.includes('binance')));
  assert.ok(result.weight >= 35);
});

test('analyzeUrl accepts the real brand domain', () => {
  const result = analyzeUrl('https://binance.com/en');
  assert.ok(!result.flags.some((f) => f.includes('not the official')));
  assert.equal(result.weight, 0);
});

test('analyzeUrl flags punycode, IP hosts and shorteners', () => {
  assert.ok(analyzeUrl('https://xn--binance-abc.com').flags.some((f) => f.includes('Punycode')));
  assert.ok(analyzeUrl('http://192.168.1.10/login').flags.some((f) => f.includes('IP address')));
  assert.ok(analyzeUrl('https://bit.ly/abc123').flags.some((f) => f.includes('shortener')));
});

test('analyzeUrl flags suspicious TLDs and plain HTTP', () => {
  const result = analyzeUrl('http://free-airdrop.xyz/claim');
  assert.ok(result.flags.some((f) => f.includes('.xyz')));
  assert.ok(result.flags.some((f) => f.includes('HTTP')));
});

test('analyzeUrls runs over every link in a message', () => {
  const results = analyzeUrls('See https://okx.com and https://okx-support.net now.');
  assert.equal(results.length, 2);
  assert.ok(results[1].flags.some((f) => f.includes('okx')));
});

test('explainLocally gives do-not-click advice for scams', () => {
  const screening = screenLocally(SAMPLE_MESSAGES[0].text);
  const text = explainLocally(SAMPLE_MESSAGES[0].text, screening);
  assert.match(text, /Do not click/);
  assert.match(text, /seed phrase/);
});

test('explainLocally stays calm for safe messages', () => {
  const screening = screenLocally(SAMPLE_MESSAGES[4].text);
  const text = explainLocally(SAMPLE_MESSAGES[4].text, screening);
  assert.match(text, /Nothing in this message matched/);
  assert.doesNotMatch(text, /Do not click/);
});

test('risk score stays within 0-100', () => {
  const kitchen = SAMPLE_MESSAGES.map((s) => s.text).join(' ');
  const result = screenLocally(kitchen);
  assert.ok(result.riskScore >= 0 && result.riskScore <= 100);
});
