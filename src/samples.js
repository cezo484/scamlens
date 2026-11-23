// Sample messages for the demo and the web page. All fictional, written for
// this project. Each sample carries the verdict the local heuristics give
// it, so the scripted demo can check its own output.

export const SAMPLE_MESSAGES = [
  {
    label: 'Fake support DM',
    expected: 'scam',
    text: 'Hello, this is Binance Support. Your account has been flagged for suspicious activity. To verify your wallet, please share your 12-word recovery phrase here or connect your wallet at binance-support-verify.com. Act within 24 hours or your account will be suspended.',
  },
  {
    label: 'Fake airdrop',
    expected: 'scam',
    text: 'Congratulations! You have been selected for the ARB airdrop. Claim 2,500 ARB now at arb-claim.xyz before it expires. A small gas fee is required to unlock your tokens.',
  },
  {
    label: 'Investment pitch',
    expected: 'scam',
    text: 'Hi friend, I made $8,000 last week with this trading bot. Guaranteed 300% returns, no risk. Deposit 0.1 ETH to start and double your money in 7 days. DM me for the link, spots are limited.',
  },
  {
    label: 'Vague security alert',
    expected: 'suspicious',
    text: 'Hi, this is the support team. We noticed unusual activity on your account. Please check your security settings soon.',
  },
  {
    label: 'Ordinary message',
    expected: 'safe',
    text: 'Hi! The team standup moved to 10:30 tomorrow. Can you bring the updated test report? Thanks, see you there.',
  },
];
