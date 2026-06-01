import { loadEnv } from './load-env.mjs';
loadEnv();

import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';

const url = process.argv[2];
if (!url) {
  console.error('usage: node scripts/pay-privy.mjs <url>');
  process.exit(1);
}

const signer = {
  address: process.env.PRIVY_WALLET_ADDRESS,
  signTypedData: async ({ domain, types, primaryType, message }) => {
    const res = await fetch(`https://auth.privy.io/api/v1/wallets/${process.env.PRIVY_WALLET_ID}/rpc`, {
      method: 'POST',
      headers: {
        'privy-app-id': process.env.PRIVY_APP_ID,
        Authorization: `Basic ${Buffer.from(`${process.env.PRIVY_APP_ID}:${process.env.PRIVY_APP_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        {
          method: 'eth_signTypedData_v4',
          params: { typed_data: { domain, types, primary_type: primaryType, message } },
        },
        (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
      ),
    });
    const json = await res.json();
    if (!json?.data?.signature) {
      throw new Error('Privy sign failed: ' + JSON.stringify(json));
    }
    return json.data.signature;
  },
};

const client = new x402Client();
registerExactEvmScheme(client, { signer });
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

const res = await fetchWithPayment(url);
console.error('--- HTTP status:', res.status);
console.error('--- X-Payment-Response:', res.headers.get('x-payment-response') || '(none)');
console.log(await res.text());
