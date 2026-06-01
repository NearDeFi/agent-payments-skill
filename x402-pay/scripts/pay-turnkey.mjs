import { loadEnv } from './load-env.mjs';
loadEnv();
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { createAccount } from '@turnkey/viem';
import { Turnkey } from '@turnkey/sdk-server';
import { createWalletClient, http } from 'viem';
import { base } from 'viem/chains';

const turnkey = new Turnkey({
  apiBaseUrl:            'https://api.turnkey.com',
  apiPublicKey:          process.env.TURNKEY_API_PUBLIC_KEY,
  apiPrivateKey:         process.env.TURNKEY_API_PRIVATE_KEY,
  defaultOrganizationId: process.env.TURNKEY_ORGANIZATION_ID,
});
const account = await createAccount({
  client:         turnkey.apiClient(),
  organizationId: process.env.TURNKEY_ORGANIZATION_ID,
  signWith:       process.env.TURNKEY_SIGN_WITH,
});
const walletClient = createWalletClient({ account, chain: base, transport: http() });

const signer = {
  address: process.env.TURNKEY_SIGN_WITH,
  signTypedData: async ({ domain, types, primaryType, message }) =>
    walletClient.signTypedData({ domain, types, primaryType, message }),
};

const client = new x402Client();
registerExactEvmScheme(client, { signer });
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

const res = await fetchWithPayment('https://x402.ottoai.services/crypto-news');
console.log('HTTP', res.status);
console.log(await res.text());
