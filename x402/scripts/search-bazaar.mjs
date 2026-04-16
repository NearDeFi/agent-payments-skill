#!/usr/bin/env node
// Search x402 bazaar services by keyword, or get full details for a specific service.
// Usage:  node scripts/search-bazaar.mjs search <keyword> [--all]
//         node scripts/search-bazaar.mjs details <resource-url>
// Flags:  --all   include services without a description (search only)
import https from 'https';

const BAZAAR_API = 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources';
const PAGE_SIZE = 1000;

const args = process.argv.slice(2);
const cmd  = args[0];

if (!cmd) {
  console.log('Usage:');
  console.log('  node scripts/search-bazaar.mjs search <keyword> [--all]');
  console.log('  node scripts/search-bazaar.mjs details <resource-url>');
  process.exit(0);
}

function fetchPage(offset) {
  return new Promise((resolve, reject) => {
    const url = `${BAZAAR_API}?limit=${PAGE_SIZE}&offset=${offset}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

const first = await fetchPage(0);
const total = first.pagination?.total ?? first.items?.length ?? 0;
const remaining = [];
for (let offset = PAGE_SIZE; offset < total; offset += PAGE_SIZE) {
  remaining.push(fetchPage(offset));
}
const rest = await Promise.all(remaining);
const items = [first.items || [], ...rest.map(p => p.items || [])].flat();

// ── Details mode ──────────────────────────────────────────────────────────────

if (cmd === 'details') {
  const detailsUrl = args[1];
  if (!detailsUrl) {
    console.error('Usage: node scripts/search-bazaar.mjs details <resource-url>');
    process.exit(1);
  }

  const service = items.find(s => s.resource === detailsUrl);
  if (!service) {
    console.error(`Service not found: ${detailsUrl}`);
    console.error('Use search mode to find the exact resource URL.');
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
  const showAll = args.includes('--all');
  const keyword = args.slice(1).filter(a => !a.startsWith('--')).join(' ').toLowerCase();

  const results = items
    .filter(s => showAll || s.description || s.metadata?.description)
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

} else {
  console.error(`Unknown command: ${cmd}`);
  console.error('Usage:');
  console.error('  node scripts/search-bazaar.mjs search <keyword> [--all]');
  console.error('  node scripts/search-bazaar.mjs details <resource-url>');
  process.exit(1);
}
