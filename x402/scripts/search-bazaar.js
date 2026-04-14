// Search bazaar services by keyword.
// File mode:  node scripts/search-bazaar.js <saved-file> <keyword>
// Live mode:  node scripts/search-bazaar.js --url https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources <keyword>
// Flags:      --all   include services without a description
const { readFileSync } = require('fs');
const https = require('https');

const args = process.argv.slice(2);
const showAll = args.includes('--all');
const urlFlagIdx = args.indexOf('--url');
const isUrlMode = urlFlagIdx !== -1;

let url, positionals;
if (isUrlMode) {
  url = args[urlFlagIdx + 1];
  positionals = args.filter((_, i) => i !== urlFlagIdx && i !== urlFlagIdx + 1 && !args[i]?.startsWith('--'));
} else {
  positionals = args.filter(arg => !arg.startsWith('--'));
}

const [filePath, ...terms] = positionals;
const keyword = terms.join(' ').toLowerCase();

function search(items) {
  const results = items
    .filter(s => showAll || s.description || s.metadata?.description)
    .filter(s => {
      const desc = s.description || s.metadata?.description || '';
      const haystack = desc + s.resource;
      return !keyword || haystack.toLowerCase().includes(keyword);
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

if (isUrlMode) {
  // Fetch live from the bazaar API
  const fullUrl = keyword ? `${url}?limit=200` : `${url}?limit=100`;
  https.get(fullUrl, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      const response = JSON.parse(data);
      search(response.items || []);
    });
  }).on('error', err => {
    console.error('Error fetching bazaar:', err.message);
    process.exit(1);
  });
} else {
  // Read from a file saved by bazaar_list()
  const raw = JSON.parse(readFileSync(filePath || 'bazaar.json', 'utf8'));
  const items = JSON.parse(raw[0].text).items;
  search(items);
}
