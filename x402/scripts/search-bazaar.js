// Search the saved bazaar_list() result for services matching a keyword.
// Run with: node scripts/search-bazaar.js <saved-file> <keyword>
// Example:  node scripts/search-bazaar.js /tmp/bazaar.json weather
import { readFileSync } from 'fs';

const [,, filePath, ...terms] = process.argv;
const keyword = terms.join(' ').toLowerCase();

const raw = JSON.parse(readFileSync(filePath || 'bazaar.json', 'utf8'));
const items = JSON.parse(raw[0].text).items;

const showAll = process.argv.includes('--all');

const results = items
  .filter(s => showAll || s.description)
  .filter(s => {
    const haystack = (s.description || '') + s.resource;
    return !keyword || haystack.toLowerCase().includes(keyword);
  })
  .map(s => ({ usd: s.maxAmountRequired / 1e6, ...s }))
  .filter(s => s.usd > 0)
  .sort((a, b) => a.usd - b.usd);

for (const s of results.slice(0, 20)) {
  console.log(`$${s.usd.toFixed(4)} | ${s.resource}`);
  if (s.description) console.log(`  ${s.description.slice(0, 100)}`);
}
