// Scripted demo: screens the sample messages with the local heuristics and
// prints the verdicts. No browser and no network needed.
//
//   npm run demo

import { screenLocally } from './heuristics.js';
import { SAMPLE_MESSAGES } from './samples.js';

for (const sample of SAMPLE_MESSAGES) {
  const result = screenLocally(sample.text);
  const mark = result.verdict === sample.expected ? 'OK ' : 'MISS';
  console.log(`[${mark}] ${sample.label}: ${result.verdict} (${result.riskScore}/100, ${result.scamType})`);
  for (const flag of result.redFlags) console.log(`      - ${flag}`);
  console.log(`      ${result.summary}`);
  console.log('');
}

console.log('Path selection (no Firebase config, no on-device model): local heuristics.');
console.log('With a Firebase config the same screen runs through Firebase AI Logic hybrid inference.');
console.log('With Chrome + Gemini Nano and no Firebase config it runs on-device directly.');
