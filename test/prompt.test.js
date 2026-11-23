import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScreenPrompt,
  buildExplainPrompt,
  parseScreenReply,
  parseExplainReply,
} from '../src/prompt.js';

test('screen prompt contains the message and the JSON shape', () => {
  const prompt = buildScreenPrompt('hello world');
  assert.match(prompt, /hello world/);
  assert.match(prompt, /"verdict"/);
  assert.match(prompt, /"riskScore"/);
  assert.match(prompt, /JSON only/);
});

test('explain prompt contains the verdict and the message', () => {
  const screening = { verdict: 'scam', riskScore: 90, scamType: 'phishing', redFlags: ['Asks for a fee'] };
  const prompt = buildExplainPrompt('pay a fee to claim', screening);
  assert.match(prompt, /pay a fee to claim/);
  assert.match(prompt, /scam/);
  assert.match(prompt, /90\/100/);
  assert.match(prompt, /Asks for a fee/);
});

test('parseScreenReply accepts clean JSON', () => {
  const reply = '{"verdict": "scam", "riskScore": 92, "scamType": "phishing", "redFlags": ["Fake support"], "summary": "Clearly a scam."}';
  const parsed = parseScreenReply(reply);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.screening.verdict, 'scam');
  assert.equal(parsed.screening.riskScore, 92);
  assert.equal(parsed.screening.scamType, 'phishing');
  assert.deepEqual(parsed.screening.redFlags, ['Fake support']);
});

test('parseScreenReply extracts JSON from a fenced reply', () => {
  const reply = 'Here is the result:\n```json\n{"verdict": "safe", "riskScore": 5, "scamType": "none", "redFlags": [], "summary": "Looks fine."}\n```';
  const parsed = parseScreenReply(reply);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.screening.verdict, 'safe');
});

test('parseScreenReply clamps the risk score', () => {
  const parsed = parseScreenReply('{"verdict": "scam", "riskScore": 250}');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.screening.riskScore, 100);
});

test('parseScreenReply rejects a reply with no verdict', () => {
  const parsed = parseScreenReply('{"riskScore": 50}');
  assert.equal(parsed.ok, false);
  assert.match(parsed.reason, /verdict/);
});

test('parseScreenReply rejects non-JSON text', () => {
  const parsed = parseScreenReply('This looks like a scam to me.');
  assert.equal(parsed.ok, false);
});

test('parseScreenReply rejects an empty reply', () => {
  assert.equal(parseScreenReply('').ok, false);
  assert.equal(parseScreenReply('   ').ok, false);
});

test('parseExplainReply returns cleaned text', () => {
  const parsed = parseExplainReply('```\nThis is a scam.\n\nDo not click.\n```');
  assert.equal(parsed.ok, true);
  assert.match(parsed.explanation, /This is a scam/);
  assert.doesNotMatch(parsed.explanation, /```/);
});

test('parseExplainReply rejects an empty reply', () => {
  assert.equal(parseExplainReply('').ok, false);
});
