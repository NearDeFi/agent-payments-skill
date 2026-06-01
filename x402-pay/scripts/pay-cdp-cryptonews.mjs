import { loadEnv } from './load-env.mjs';
loadEnv();

import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { CdpClient } from '@coinbase/cdp-sdk';

const cdp = new CdpClient(); // reads CDP_API_KEY_ID + CDP_API_KEY_SECRET + CDP_WALLET_SECRET from env

const signer = {
  address: process.env.CDP_WALLET_ADDRESS,
  signTypedData: async ({ domain, types, primaryType, message }) => {
    const { signature } = await cdp.evm.signTypedData({
      address: signer.address,
      domain, types, primaryType, message,
    });
    return signature;
  },
};

const client = new x402Client();
registerExactEvmScheme(client, { signer });
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

const res = await fetchWithPayment('https://x402.ottoai.services/crypto-news');
console.error('HTTP status:', res.status);
const xpr = res.headers.get('x-payment-response');
if (xpr) console.error('x-payment-response:', xpr);
console.log(await res.text());
