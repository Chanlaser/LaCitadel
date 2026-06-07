/**
 * ================================================================
 *  LaCitadel — API DIAGNOSTIC  (run with plain Node, NOT Electron)
 * ================================================================
 *  Usage:   node api-check.js
 *  Purpose: hit every deadlock-api endpoint LaCitadel depends on and
 *           print the REAL HTTP status + the REAL field names of the
 *           first row. This is the ground truth for the Counters y
 *           Sinergias field mapping and for FASE 1 reachability.
 *
 *  Copy the whole console output back into the chat to finalize the
 *  field mapping.
 * ================================================================
 */
'use strict';
const https = require('https');

const UA = 'LaCitadel/1.0 (community tool; never-breaks-tos)';
const SAMPLE_HERO = 15; // Seven — change if you like

function get(url) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, ms: Date.now() - started, body });
      });
    });
    req.setTimeout(15000, () => { req.destroy(); resolve({ status: 0, ms: 15000, body: '', err: 'timeout' }); });
    req.on('error', e => resolve({ status: 0, ms: Date.now() - started, body: '', err: e.message }));
  });
}

// Pretty-print: status, count, keys of first row, compact sample row
function describe(label, r) {
  console.log('\n──────────────────────────────────────────────');
  console.log(label);
  if (r.err) { console.log('  RESULT: NETWORK ERROR →', r.err); return; }
  console.log('  HTTP ' + r.status + '  (' + r.ms + 'ms)');
  if (r.status < 200 || r.status >= 300) {
    console.log('  BODY (first 200 chars): ' + r.body.slice(0, 200).replace(/\s+/g, ' '));
    return;
  }
  let data;
  try { data = JSON.parse(r.body); }
  catch (e) { console.log('  NOT JSON. First 200 chars: ' + r.body.slice(0, 200)); return; }

  if (Array.isArray(data)) {
    console.log('  ARRAY length: ' + data.length);
    if (data.length) {
      console.log('  row[0] KEYS: ' + Object.keys(data[0]).join(', '));
      console.log('  row[0] SAMPLE: ' + JSON.stringify(data[0]).slice(0, 400));
    }
  } else if (data && typeof data === 'object') {
    console.log('  OBJECT KEYS: ' + Object.keys(data).join(', '));
    console.log('  SAMPLE: ' + JSON.stringify(data).slice(0, 400));
  } else {
    console.log('  VALUE: ' + JSON.stringify(data).slice(0, 200));
  }
}

(async () => {
  const B = 'https://api.deadlock-api.com';
  console.log('LaCitadel API diagnostic · Node ' + process.version + ' · ' + new Date().toISOString());
  console.log('Sample hero id: ' + SAMPLE_HERO);

  // 0) Sanity: assets reachable at all?
  describe('[0] assets/heroes (sanity / reachability)',
    await get(`${B}/v1/assets/heroes?language=english`));

  // 1) FASE 1 — hero-stats. Test BOTH badge param spellings.
  describe('[1a] hero-stats?min_badge=90  (param the app currently sends)',
    await get(`${B}/v1/analytics/hero-stats?min_badge=90`));
  describe('[1b] hero-stats?min_average_badge=90  (documented param name)',
    await get(`${B}/v1/analytics/hero-stats?min_average_badge=90`));
  describe('[1c] hero-stats  (no badge filter — baseline)',
    await get(`${B}/v1/analytics/hero-stats`));

  // 2) SYNERGIES — the corrected endpoint (hero-comb-stats, comb_size=2)
  describe('[2] hero-comb-stats?comb_size=2&include_hero_ids=' + SAMPLE_HERO + '  (NEW synergy source)',
    await get(`${B}/v1/analytics/hero-comb-stats?comb_size=2&include_hero_ids=${SAMPLE_HERO}&min_matches=20&min_average_badge=90`));

  // 3) COUNTERS — the app's current guess (may 404)
  describe('[3a] hero-counter-stats?min_badge=90  (app guess — may not exist)',
    await get(`${B}/v1/analytics/hero-counter-stats?min_badge=90`));
  describe('[3b] hero-synergy-stats?min_badge=90  (OLD app guess — likely 404)',
    await get(`${B}/v1/analytics/hero-synergy-stats?min_badge=90`));

  // 4) Other phases (quick reachability)
  describe('[4] builds?hero_id=' + SAMPLE_HERO,
    await get(`${B}/v1/builds?hero_id=${SAMPLE_HERO}`));
  describe('[5] item-stats?hero_id=' + SAMPLE_HERO,
    await get(`${B}/v1/analytics/item-stats?hero_id=${SAMPLE_HERO}&min_average_badge=90`));

  console.log('\n──────────────────────────────────────────────');
  console.log('Done. Copy everything above back into the chat.');
  console.log('Key things it tells us:');
  console.log('  • [1a vs 1b]  which badge param actually filters (different counts = it works).');
  console.log('  • [2] row[0] KEYS  → confirms hero_ids / wins / matches for synergies.');
  console.log('  • [3a/3b] HTTP status  → whether a counter endpoint exists at all.');
})();
