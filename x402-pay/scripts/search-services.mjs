#!/usr/bin/env node
// Search x402 services by keyword, or get full details for a specific service.
// Default source: x402-list.com (curated, uptime-monitored).
// Usage:  node scripts/search-services.mjs search [keyword] [--source bazaar]
//         node scripts/search-services.mjs details <resource-url>
// Flags:  --source bazaar  use Coinbase bazaar instead of x402-list
// Only online (x402-list) / described (bazaar) services are listed — an agent should
// never act on an offline endpoint or a service it can't identify.
import https from 'https';

const X402LIST_API = 'https://x402-list.com/api/v1';
const BAZAAR_API   = 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources';
const PAGE_SIZE    = 1000;

const args   = process.argv.slice(2);
const cmd    = args[0];
const useBazaar = args.includes('--source') && args[args.indexOf('--source') + 1] === 'bazaar';

if (!cmd) {
  console.log('Usage:');
  console.log('  node scripts/search-services.mjs search [keyword] [--source bazaar]');
  console.log('  node scripts/search-services.mjs details <resource-url>');
  process.exit(0);
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`Invalid JSON: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

// ── Fetch all items from selected source ──────────────────────────────────────

async function fetchX402List() {
  const page = await fetchJson(`${X402LIST_API}/services?per_page=100`);
  return (page.data || []);
}

async function fetchBazaar() {
  const first = await fetchJson(`${BAZAAR_API}?limit=${PAGE_SIZE}&offset=0`);
  const total = first.pagination?.total ?? first.items?.length ?? 0;
  const remaining = [];
  for (let offset = PAGE_SIZE; offset < total; offset += PAGE_SIZE) {
    remaining.push(fetchJson(`${BAZAAR_API}?limit=${PAGE_SIZE}&offset=${offset}`));
  }
  const rest = await Promise.all(remaining);
  return [first.items || [], ...rest.map(p => p.items || [])].flat();
}

// ── Details mode ──────────────────────────────────────────────────────────────

if (cmd === 'details') {
  const detailsUrl = args[1];
  if (!detailsUrl) {
    console.error('Usage: node scripts/search-services.mjs details <resource-url>');
    process.exit(1);
  }

  // Try x402-list first (unless --source bazaar)
  if (!useBazaar) {
    const listItems = await fetchX402List();
    const match = listItems.find(s => detailsUrl.startsWith(s.base_url));
    if (match) {
      const detail = await fetchJson(`${X402LIST_API}/services/${match.slug}`);
      const svc = detail.data || detail;
      console.log(`Service:  ${svc.name}`);
      console.log(`URL:      ${svc.base_url}`);
      console.log(`Status:   ${svc.status} | Uptime 24h: ${svc.uptime?.['24h'] ?? svc.uptime_24h ?? '?'}% | 7d: ${svc.uptime?.['7d'] ?? '?'}%`);
      if (svc.description) console.log(`Desc:     ${svc.description}`);
      console.log(`Networks: ${(svc.networks || []).join(', ')}`);
      if (svc.endpoints?.length) {
        console.log('\nEndpoints:');
        for (const ep of svc.endpoints) {
          console.log(`  ${ep.method} ${ep.path} — $${parseFloat(ep.min_price_usd).toFixed(4)} USDC`);
          if (ep.description) console.log(`    ${ep.description}`);
        }
      }
      process.exit(0);
    }
  }

  // Fall back to bazaar
  const bazaarItems = await fetchBazaar();
  const service = bazaarItems.find(s => s.resource === detailsUrl);
  if (!service) {
    console.error(`Service not found: ${detailsUrl}`);
    console.error('Use search mode to find available services.');
    process.exit(1);
  }

  const accepts = service.accepts || [];
  const minAmount = accepts.reduce((min, a) => {
    const amt = parseInt(a.amount || a.maxAmountRequired || 0, 10);
    return amt > 0 && (min === 0 || amt < min) ? amt : min;
  }, 0);

  console.log(`Resource:    ${service.resource}`);
  console.log(`Price:       $${(minAmount / 1e6).toFixed(4)} USDC`);
  console.log(`Networks:    ${accepts.map(a => a.network).join(', ')}`);
  const desc = service.description || service.metadata?.description;
  if (desc) console.log(`Description: ${desc}`);
  const meta = service.metadata || {};
  if (meta.inputSchema)  console.log(`\nInput schema:\n${JSON.stringify(meta.inputSchema, null, 2)}`);
  if (meta.outputSchema) console.log(`\nOutput schema:\n${JSON.stringify(meta.outputSchema, null, 2)}`);
  if (meta.examples)     console.log(`\nExamples:\n${JSON.stringify(meta.examples, null, 2)}`);

  process.exit(0);
}

// ── Search mode ───────────────────────────────────────────────────────────────

if (cmd === 'search') {
  const sliced = args.slice(1);
  const localSourceIdx = sliced.indexOf('--source');
  const keyword = sliced
    .filter((a, i) => !a.startsWith('--') && !(localSourceIdx !== -1 && i === localSourceIdx + 1))
    .join(' ').toLowerCase();

  if (!useBazaar) {
    // x402-list: only list services that are currently online
    const items = await fetchX402List();
    const results = items
      .filter(s => s.status === 'online')
      .filter(s => {
        if (!keyword) return true;
        return (s.description + ' ' + s.base_url).toLowerCase().includes(keyword);
      })
      .filter(s => parseFloat(s.min_price_usd) > 0)
      .sort((a, b) => parseFloat(a.min_price_usd) - parseFloat(b.min_price_usd));

    for (const s of results.slice(0, 20)) {
      const price = parseFloat(s.min_price_usd).toFixed(4);
      const uptime = s.uptime_24h != null ? ` | ${s.uptime_24h}% up` : '';
      console.log(`$${price}${uptime} | ${s.base_url}`);
      if (s.description) console.log(`  ${s.description.slice(0, 100)}`);
    }
    if (results.length === 0) console.log('No results found.');

  } else {
    // Bazaar: only list services that carry a description (identifiable to an agent)
    const items = await fetchBazaar();
    const results = items
      .filter(s => s.description || s.metadata?.description)
      .filter(s => {
        const desc = s.description || s.metadata?.description || '';
        return !keyword || (desc + s.resource).toLowerCase().includes(keyword);
      })
      .map(s => {
        const accepts = s.accepts || [];
        const minAmount = accepts.reduce((min, a) => {
          const amt = parseInt(a.amount || a.maxAmountRequired || 0, 10);
          return amt > 0 && (min === 0 || amt < min) ? amt : min;
        }, 0);
        return { usd: minAmount / 1e6, desc: s.description || s.metadata?.description || '', ...s };
      })
      .filter(s => s.usd > 0)
      .sort((a, b) => a.usd - b.usd);

    for (const s of results.slice(0, 20)) {
      console.log(`$${s.usd.toFixed(4)} | ${s.resource}`);
      if (s.desc) console.log(`  ${s.desc.slice(0, 100)}`);
    }
    if (results.length === 0) console.log('No results found.');
  }

} else {
  console.error(`Unknown command: ${cmd}`);
  console.error('Usage:');
  console.error('  node scripts/search-services.mjs search [keyword] [--source bazaar]');
  console.error('  node scripts/search-services.mjs details <resource-url>');
  process.exit(1);
}
