# ScamLens

Paste a suspicious message and ScamLens tells you, in plain language,
whether it is a scam. Built for people who get crypto scam DMs, phishing
texts and too-good-to-be-true offers every day.

Example message:

```
Hello, this is Binance Support. Your account has been flagged for
suspicious activity. To verify your wallet, please share your 12-word
recovery phrase here or connect your wallet at
binance-support-verify.com. Act within 24 hours or your account will
be suspended.
```

Becomes:

```
SCAM (100/100) - Type: seed phrase theft
- Asks for your seed phrase, recovery phrase or private key
- Asks you to connect, verify or sync your wallet
- Claims to be support, an admin or an official account
- Creates urgency: act now or lose access
- Threatens your account: flagged, hacked, suspended
- Link binance-support-verify.com: mentions binance but is not the
  official binance.com domain
```

Built for #BuildHybridAI 2026 on Devpost.

## How it works

Screening (the verdict) runs through one of three paths, in this order.
The badge on each result says which path screened it.

1. **Hybrid (Firebase AI Logic).** With a Firebase project configured,
   screening goes through the Firebase AI Logic hybrid SDK in
   `PREFER_ON_DEVICE` mode: Gemini Nano screens the message on-device
   when available, and the SDK falls back to a cloud Gemini model when
   it is not. The response reports which one actually ran
   (`inferenceSource`), and the badge shows it honestly.
2. **On-device (direct).** Without a Firebase config, Chrome's Prompt API
   runs Gemini Nano in the browser. The message stays on the device and
   the screening costs nothing. Needs Chrome on desktop, version 139 or
   newer, with the on-device model downloaded.
3. **Local.** When no model path is available, on-page rules screen the
   message: known scam patterns plus a link inspector that checks every
   URL for lookalike domains, punycode, shorteners and other tricks. The
   demo always works, even with no setup at all.

The deep explanation is a separate step with its own path, and it only
runs when you tap "Explain in detail":

- **Cloud.** With a Firebase config, a cloud Gemini model through
  Firebase AI Logic (`ONLY_IN_CLOUD`) explains the scam in plain
  language: what it is trying to do, the warning signs, what to do next.
- **Local.** Without a Firebase config, the explanation is built from
  the on-page checks instead.

Screening runs on-device first on purpose: people paste DMs that may
contain personal information, and that text should not have to leave the
device for a verdict. The cloud only sees a message when the user
explicitly asks for the explanation.

If a path fails, the next one is tried automatically. The attempt log
under the badge records what happened.

Recent screenings are kept in the browser only, as short snippets, never
the full message text.

## Run it

Node.js 20 or newer. No dependencies, nothing to install.

```
git clone <repo>
cd scamlens
node serve.js
```

Then open http://localhost:8080. The page works with no Firebase config:
on a Chrome desktop with the on-device model ready, screenings come from
Gemini Nano; anywhere else, the local heuristics cover the demo.

## Try the on-device path

1. Use Chrome on desktop, version 139 or newer. Check at chrome://settings/help.
2. Open chrome://flags/#prompt-api-for-gemini-nano-multimodal-input and set it to Enabled. Restart Chrome.
3. Open the app and click "Prepare on-device model" if the status row offers it. The model downloads once (a few gigabytes) and Chrome keeps it for later visits.
4. Paste a message and screen it. The badge should read "On-device (Gemini Nano)".

If the browser or the hardware does not qualify, the status row says so and
the cloud or local path takes over. Check the model state any time at
chrome://on-device-internals.

## Add the hybrid and cloud paths

1. In the Firebase console, create a project (or open one you have).
2. Go to AI Services, then AI Logic, and click Get started. Choose the Gemini Developer API provider. The guided setup also turns on App Check for AI Logic.
3. Register a web app in Project settings and copy its config values.
4. Copy the example config and fill it in:

```
cp web/firebaseConfig.js.example web/firebaseConfig.js
```

5. Reload the page. The status row should show the cloud path as configured.

`web/firebaseConfig.js` is gitignored and never goes into the repo.

### App Check

The guided AI Logic setup enforces App Check. If the cloud path reports an App Check error, register a reCAPTCHA v3 site key for your domain in the console and put it in `appCheckSiteKey`. For localhost development, set `appCheckDebug: true`, reload, copy the debug token the browser console prints, and register it in the console under App Check, Apps, Manage debug tokens.

### Cloud model

The default cloud model is `gemini-2.5-flash-lite`, set in `firebaseConfig.js`. It is used both as the hybrid fallback (via `inCloudParams`) and for the cloud-only explanation. Model names change often; check the Firebase AI Logic supported models page and update the `model` field if the cloud path reports an unknown model. A wrong model name does not break the app: the screening falls back to the next path.

## Scripted demo

Screens the five sample messages with the local heuristics and prints the
verdicts. No browser and no network needed.

```
npm run demo
```

## Tests

```
npm test
```

36 tests, all offline. They cover the local heuristics and URL analysis,
the path selection order, the config checks, and the prompt and reply
parsing the model paths share. The browser check
(`video/verify-app.py`, Playwright) screens two samples end to end and
verifies the verdicts, the link inspector, the explanation and the
history.

## Layout

```
src/
  heuristics.js  rule-based screener, URL analysis, local explanation
  prompt.js      screen/explain prompts and model reply parsing
  path.js        path selection and fallback order
  config.js      Firebase config validation and defaults
  samples.js     sample messages for the demo and the web page
  demo.js        scripted demo
test/            node:test suites
web/
  index.html
  app.js         browser wiring: Firebase AI Logic hybrid SDK, Prompt
                 API, fallback chains, UI, history
  styles.css
  firebaseConfig.js.example
serve.js         static server for the web page
video/           demo video pipeline and browser verification
```

## Limits

- The on-device model runs on Chrome desktop only. Other browsers and phones get the cloud or local path.
- The on-device model has a small context window. ScamLens caps messages at 4000 characters.
- The local heuristics work from patterns. They catch the usual scam shapes (seed phrase requests, fake support, fake airdrops, urgency, lookalike links) and miss novel phrasing. They are a fallback, not a replacement for the model paths.
- A clean screening does not prove a message is safe. ScamLens says so on every safe result.
- The Firebase AI Logic SDK is loaded from the Google CDN at page load, so the hybrid and cloud paths need network access. The direct on-device and local paths work offline once the page is loaded.

## License

MIT. See LICENSE.
