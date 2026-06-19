/**
 * ================================================================
 *  LACITADEL — ELECTRON MAIN PROCESS
 * ================================================================
 *  * Never Do Evil · Never Break Valve TOS — Ever
 *  * Read-only data, never touches game client
 *  * Respects rate limits on all external services
 *  * Free for all players, always
 * ================================================================
 *  Hecho en Puerto Rico 🇵🇷 · por Chanlaser
 *  Desarrollado con la ayuda de Claude (Anthropic)
 * ================================================================
 */
'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path  = require('path');
const fs    = require('fs');
const https = require('https');
const http  = require('http');

// ── LIGHTWEIGHT UPDATE LOGGER (built-in fs, no extra package) ─────────────
// Writes to %APPDATA%/LaCitadel/update.log so auto-update behavior is debuggable.
// (Long-term TODO: replace with electron-log for rotation/levels.)
function updLog(msg){
  try {
    const dir = app.getPath('userData');
    const line = '[' + new Date().toISOString() + '] ' + msg + '\n';
    fs.appendFileSync(path.join(dir, 'update.log'), line);
    console.log('[update]', msg);
  } catch(e) { console.log('[update] (log write failed)', msg); }
}

const USER_AGENT         = 'LaCitadel/1.0 (community tool; never-breaks-tos)';
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

let mainWindow  = null;
let updateTimer = null;

// ── CACHED ITEM MAPS (fetched once per session) ───────────────────────────
// Maps ability_id (number) -> { nameEn, nameEs, tier, image, type }
let itemMapEn = {};
let itemMapEs = {};
let itemMapsLoaded = false;

// Dynamic hero slug -> numeric id map (authoritative, from assets endpoint)
let heroIdMap = {};
let heroNameById = {};
let heroMapLoaded = false;

async function loadHeroMap(){
  if(heroMapLoaded) return;
  try{
    const res = await fetchUrl('https://api.deadlock-api.com/v1/assets/heroes?language=english', {timeout:15000});
    const assets = JSON.parse(res.body);
    (Array.isArray(assets)?assets:[]).forEach(h=>{
      if(h.id && h.class_name){
        const slug = h.class_name.replace(/^hero_/,'').replace(/_/g,'-');
        heroIdMap[slug] = h.id;                               // code-name slug (e.g. "inferno")
        if(h.name) heroIdMap[slugify(h.name)] = h.id;         // public-name slug (e.g. "infernus")
        if(h.name) heroIdMap[slugify(h.name.replace(/&/g,"and"))] = h.id; // "&" variant (Mo & Krill -> mo-and-krill)
        heroNameById[h.id] = h.name || slug;
      }
    });
    heroMapLoaded = true;
    console.log('[hero-map] Loaded', Object.keys(heroIdMap).length, 'hero slug->id mappings');
  }catch(e){ console.log('[hero-map] Failed:', e.message); }
}

// Resolve a hero slug to numeric id: dynamic map first, hardcoded fallback
function heroNumId(slug){
  const id = heroIdMap[slug];
  if(!id) console.log('[hero-id] sin resolver (no en assets):', slug);
  return id || null;
}

// ── WINDOW ────────────────────────────────────────────────────────────────
function createWindow(){
  mainWindow = new BrowserWindow({
    width:1280, height:800, minWidth:900, minHeight:600,
    title:'LaCitadel', icon: path.join(__dirname,'assets','icon.png'),
    backgroundColor:'#0b0b0e',
    webPreferences:{
      preload: path.join(__dirname,'preload.js'),
      contextIsolation:true, nodeIntegration:false, sandbox:false,
    },
    autoHideMenuBar:true, show:false,
  });
  mainWindow.loadFile(path.join(__dirname,'src','index.html'));
  mainWindow.once('ready-to-show',()=>{ mainWindow.show(); scheduleAutoUpdate(); });
  mainWindow.webContents.setWindowOpenHandler(({url})=>{ shell.openExternal(url); return {action:'deny'}; });
  mainWindow.on('closed',()=>{ mainWindow=null; });
}

// Register asset protocol so src/index.html can load ../assets/ files
const { protocol } = require('electron');
app.whenReady().then(() => {
  console.log('=== LaCitadel main.js LOADED · build: PATCH-FIX title/pub_date · 2026-06-17 ===');
  protocol.registerFileProtocol('asset', (request, callback) => {
    const filePath = request.url.replace('asset://', '');
    callback(path.join(__dirname, filePath));
  });
  createWindow();
});
app.on('window-all-closed',()=>{ if(process.platform!=='darwin') app.quit(); });
app.on('activate',()=>{ if(!mainWindow) createWindow(); });
app.on('quit',()=>{ if(updateTimer) clearTimeout(updateTimer); });

// ── HTTP HELPER ───────────────────────────────────────────────────────────
function fetchUrl(url, opts={}){
  return new Promise((resolve, reject) => {
    const timeout = opts.timeout || 20000;
    let settled = false;
    const done = (fn, val) => { if(!settled){ settled=true; clearTimeout(timer); fn(val); } };
    const timer = setTimeout(() => done(reject, new Error('Timeout for '+url)), timeout);

    try {
      const { net } = require('electron');
      const request = net.request({ url, method:'GET' });
      request.setHeader('User-Agent', USER_AGENT);
      request.setHeader('Accept', 'application/json,text/html,*/*');
      request.on('response', (response) => {
        if([301,302,303,307,308].includes(response.statusCode) && response.headers.location){
          const loc = Array.isArray(response.headers.location) ? response.headers.location[0] : response.headers.location;
          if((opts._r||0) >= 5) return done(reject, new Error('Too many redirects'));
          return fetchUrl(loc, {...opts, _r:(opts._r||0)+1}).then(v=>done(resolve,v)).catch(e=>done(reject,e));
        }
        if(response.statusCode === 429) return done(reject, new Error('Rate limited (429)'));
        if(response.statusCode < 200 || response.statusCode >= 400) return done(reject, new Error('HTTP '+response.statusCode+' for '+url));
        const chunks = [];
        response.on('data', c => chunks.push(c));
        response.on('end', () => done(resolve, { status:response.statusCode, headers:response.headers, body:Buffer.concat(chunks).toString('utf8') }));
      });
      request.on('error', e => done(reject, e));
      request.end();
    } catch(e) {
      const lib = url.startsWith('https') ? https : http;
      const req = lib.get(url, { headers:{ 'User-Agent':USER_AGENT, 'Accept':'application/json,text/html,*/*' } }, res => {
        if([301,302,303,307,308].includes(res.statusCode) && res.headers.location){
          if((opts._r||0)>=5) return done(reject, new Error('Too many redirects'));
          return fetchUrl(res.headers.location,{...opts,_r:(opts._r||0)+1}).then(v=>done(resolve,v)).catch(e=>done(reject,e));
        }
        if(res.statusCode===429) return done(reject, new Error('Rate limited (429)'));
        if(res.statusCode<200||res.statusCode>=400) return done(reject, new Error('HTTP '+res.statusCode+' for '+url));
        const chunks=[];
        res.on('data',c=>chunks.push(c));
        res.on('end',()=>done(resolve,{status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString('utf8')}));
      });
      req.on('error', e => done(reject, e));
    }
  });
}

const sleep    = ms => new Promise(r=>setTimeout(r,ms));
const slugify  = n  => n.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

// ── ITEM MAPS ─────────────────────────────────────────────────────────────
async function loadItemMaps(){
  if(itemMapsLoaded) return;
  try {
    const [enRes, esRes] = await Promise.all([
      fetchUrl('https://api.deadlock-api.com/v1/assets/items?language=english', {timeout:15000}),
      fetchUrl('https://api.deadlock-api.com/v1/assets/items?language=spanish', {timeout:15000}),
    ]);
    const enItems = JSON.parse(enRes.body);
    const esItems = JSON.parse(esRes.body);

    // Build id -> name map, skip internal/non-shopable items
    enItems.forEach(i => {
      if(i.id && i.name && !i.name.startsWith('citadel_')) {
        itemMapEn[i.id] = { name:i.name, tier:i.item_tier||1, image:i.shop_image||i.image||'', type:i.item_slot_type||'' };
      }
    });
    esItems.forEach(i => {
      if(i.id && i.name && !i.name.startsWith('citadel_')) {
        itemMapEs[i.id] = { name:i.name, tier:i.item_tier||1, image:i.shop_image||i.image||'', type:i.item_slot_type||'' };
      }
    });

    itemMapsLoaded = true;
    console.log('[items] Loaded EN:', Object.keys(itemMapEn).length, 'ES:', Object.keys(itemMapEs).length);
  } catch(e) {
    console.log('[items] Failed to load item maps:', e.message);
  }
}

// Get item name for given language
function getItemName(abilityId, lang='en'){
  const map = lang==='es' ? itemMapEs : itemMapEn;
  return map[abilityId]?.name || null;
}

function getItemInfo(abilityId){
  const en = itemMapEn[abilityId];
  const es = itemMapEs[abilityId];
  if(!en && !es) return null;
  return {
    nameEn: en?.name || es?.name || '',
    nameEs: es?.name || en?.name || '',
    tier:   en?.tier || es?.tier || 1,
    image:  en?.image || es?.image || '',
    type:   en?.type  || es?.type  || '',
  };
}

// ── PHASE 1: HERO STATS ───────────────────────────────────────────────────
let assetHeroMap = null;   // cached hero assets (names/classes) so repeat windows skip the assets fetch
async function fetchHeroStats(minBadge=0, minTs=0, maxTs=0, reuseAssets=false){
  let statsUrl = `https://api.deadlock-api.com/v1/analytics/hero-stats?min_average_badge=${minBadge}`;
  if(minTs>0) statsUrl += `&min_unix_timestamp=${minTs}`;
  if(maxTs>0) statsUrl += `&max_unix_timestamp=${maxTs}`;
  let stats, heroMap;
  if(reuseAssets && assetHeroMap){
    const statsRes = await fetchUrl(statsUrl, {timeout:15000});
    stats   = JSON.parse(statsRes.body);
    heroMap = assetHeroMap;
  } else {
    const [statsRes, assetsRes] = await Promise.all([
      fetchUrl(statsUrl, {timeout:15000}),
      fetchUrl('https://api.deadlock-api.com/v1/assets/heroes?language=english', {timeout:15000}),
    ]);
    stats  = JSON.parse(statsRes.body);
    const assets = JSON.parse(assetsRes.body);
    heroMap = {};
    (Array.isArray(assets)?assets:[]).forEach(h=>{
      heroMap[h.id] = {name:h.name||'', cls:h.class_name||''};
      if(h.id && h.class_name){
        const slug = h.class_name.replace(/^hero_/,'').replace(/_/g,'-');
        heroIdMap[slug] = h.id;                               // code-name slug
        if(h.name) heroIdMap[slugify(h.name)] = h.id;         // public-name slug
        if(h.name) heroIdMap[slugify(h.name.replace(/&/g,"and"))] = h.id; // "&" variant
        heroNameById[h.id] = h.name || slug;
      }
    });
    assetHeroMap = heroMap;
    heroMapLoaded = true;
  }
  console.log('[hero-stats] stats:', stats.length, 'minTs:', minTs, 'maxTs:', maxTs);
  // The /v1/analytics/hero-stats response has NO pick_rate field. It returns
  // { hero_id, wins, losses, matches, matches_per_bucket, ... }.
  //  · win rate = wins / matches
  //  · pick rate ≈ this hero's matches / total matches in the window
  //    (matches_per_bucket = total matches across all heroes in the bucket).
  //    Fallback to the sum of matches if the field is missing, then to any
  //    pick_rate field a future API version might add.
  const totalMatches = stats.reduce((s,h)=> s + (Number(h.matches)||0), 0) || 1;
  const totalGames = totalMatches / 12;   // Deadlock = 12 heroes per match (6v6)
  return stats.map(h=>{
    const asset = heroMap[h.hero_id] || {};
    const name  = asset.name || ('Hero '+h.hero_id);
    const matches = Number(h.matches) || 0;
    const wr    = matches ? h.wins/matches : parseFloat(h.win_rate||0);
    const pick  = totalGames ? Math.min(1, matches / totalGames) : 0;   // % of games this hero appears in
    const id    = asset.cls ? asset.cls.replace(/^hero_/,'').replace(/_/g,'-') : slugify(name);
    return { id, name, wr, pick, matches };
  }).filter(h=>h.id && h.name && !/^Hero \d+$/.test(h.name) && h.matches>0);
}

// ── HERO NUMERIC ID MAP ───────────────────────────────────────────────────
// ── HERO NUMERIC ID — single source of truth ──────────────────────────────
// No hardcoded ID map. IDs come ONLY from the live assets endpoint (loadHeroMap
// / fetchHeroStats build heroIdMap from class_name). Hardcoded numbers go stale
// the moment Valve renumbers or adds heroes — which is exactly what broke
// McGinnis/Ivy/Silver/etc. (their old hardcoded ids 37/22/62 no longer match).

// ── PHASE 2: HERO BUILDS ──────────────────────────────────────────────────
// Endpoint: api.deadlock-api.com/v1/builds?hero_id=N
// Structure: [{hero_build: {details: {mod_categories: [{name, mods: [{ability_id}]}]}}}]
// Note: builds change when players edit them — always fetch fresh
async function fetchHeroBuild(heroId){
  await sleep(150);
  await loadHeroMap();
  const numId = heroNumId(heroId);
  if(!numId) return null;

  // Ensure item maps are loaded
  await loadItemMaps();

  const url = `https://api.deadlock-api.com/v1/builds?hero_id=${numId}`;
  const res = await fetchUrl(url, {timeout:15000});
  const data = JSON.parse(res.body);
  if(!Array.isArray(data) || data.length === 0) return null;

  // Sort by popularity to get the most-used build.
  // Real row shape (api-check.js): top-level { hero_build, num_favorites,
  // num_weekly_favorites, num_ignores, num_reports, rollup_category }.
  // weekly favorites weighted highest, then all-time favorites, minus ignores.
  const score = o => (Number(o.num_weekly_favorites)||0)*3
                   + (Number(o.num_favorites)||0)
                   - (Number(o.num_ignores)||0)
                   // legacy/fallback fields in case the API shape changes:
                   + (Number(o.hero_build?.favorites)||0)
                   + (Number(o.hero_build?.weekly_views)||0);
  const sorted = [...data].sort((a,b)=> score(b) - score(a));

  const raw = sorted[0].hero_build || sorted[0];
  const buildName   = raw.name || '';
  const description = raw.description || '';
  const categories  = raw.details?.mod_categories || [];

  if(!categories.length) return null;

  // Parse each category into early/core/late
  const early = [], core = [], late = [];

  categories.forEach(cat => {
    const catName = (cat.name||'').toLowerCase();
    const items = (cat.mods||[]).map(mod => {
      const info = getItemInfo(mod.ability_id);
      if(!info) return null;
      return {
        t:      info.tier,
        nameEn: info.nameEn,
        nameEs: info.nameEs,
        image:  info.image,
        type:   info.type,
        note:   mod.annotation || '',
      };
    }).filter(Boolean);

    if(!items.length) return;

    // Categorize by section name keywords
    if(catName.includes('early') || catName.includes('temprano') || catName.includes('500') || catName.includes('start')){
      early.push({ label: cat.name, items });
    } else if(catName.includes('late') || catName.includes('luxury') || catName.includes('lujo') || catName.includes('final')){
      late.push({ label: cat.name, items });
    } else {
      core.push({ label: cat.name, items });
    }
  });

  if(!early.length && !core.length && !late.length) return null;

  return {
    buildName,
    description,
    patch:       raw.patch || '',
    source:      (raw.author_name||'Community') + ' · deadlock-api.com',
    sourceUrl:   `https://deadlock-api.com/heroes/${heroId}`,
    weeklyViews: raw.weekly_views || raw.favorites || 0,
    totalBuilds: data.length,
    // Bilingual sections — renderer picks nameEn or nameEs based on LANG
    early, core, late,
    abilityOrder: raw.ability_order || [],
    categories: categories.map(c=>c.name), // raw category names for display
  };
}

// ── PHASE 3: ITEM STATS ───────────────────────────────────────────────────
async function fetchItemStats(heroId, minBadge=0){
  await loadHeroMap();
  const numId = heroNumId(heroId);
  if(!numId) return null;
  await sleep(150);

  // Ensure item maps loaded for ID->name lookup
  await loadItemMaps();

  const url = `https://api.deadlock-api.com/v1/analytics/item-stats?hero_id=${numId}&min_average_badge=${minBadge}`;
  const res = await fetchUrl(url, {timeout:12000});
  const data = JSON.parse(res.body);
  if(!Array.isArray(data)||data.length<5) return null;

  // Relative pick rate = item's matches / highest matches among this hero's items
  const maxMatches = Math.max(...data.map(it=>it.matches||0), 1);

  return data.map(item=>{
    // API returns item_id — map to names using item assets
    const info = getItemInfo(item.item_id);
    const nameEn = item.item_name || item.name || info?.nameEn || '';
    const nameEs = info?.nameEs || nameEn;
    if(!nameEn) return null;
    const wr   = item.wins && item.matches ? item.wins/item.matches : parseFloat(item.win_rate||0);
    const pick = item.matches ? item.matches / maxMatches : parseFloat(item.pick_rate||0);
    return {
      nameEn, nameEs,
      name: nameEn, // fallback for existing renderer
      tier: info?.tier || item.item_tier || 1,
      image: info?.image || '',
      type:  info?.type  || '',
      wr, pick,
      wins:    item.wins    || 0,
      matches: item.matches || 0,
    };
  }).filter(Boolean).filter(i=>i.wr>0).sort((a,b)=>b.wr-a.wr);
}

// ── PHASE 4: LEADERBOARD ──────────────────────────────────────────────────
// Confirmed: api.deadlock-api.com/v1/leaderboard/{RegionName}
// Real row shape (api-check, Jun 2026): {account_name, possible_account_ids,
// rank, top_hero_ids, badge_level, ranked_rank, ranked_subrank}.
// NOTE: there is NO matches-played field — we surface the player's RANK instead.
const REGION_NAMES = {
  sa:'SAmerica', na:'NAmerica', eu:'Europe',
  asia:'Asia', oce:'Oceania'
};

// Deadlock rank tiers (ranked_rank 0..11). subrank is 1..6 (roman numerals).
const RANK_TIERS = ['Obscurus','Initiate','Seeker','Alchemist','Arcanist','Ritualist',
                    'Emissary','Archon','Oracle','Phantom','Ascendant','Eternus'];
const ROMAN = ['','I','II','III','IV','V','VI'];
function rankLabelFromRanked(rr, sr){
  if(rr==null) return '';
  const tier = RANK_TIERS[rr] || ('Rank '+rr);
  const sub  = ROMAN[sr] || '';
  return sub ? (tier+' '+sub) : tier;
}

async function fetchLeaderboard(region='sa', minBadge=0){
  await loadHeroMap();
  const regionName = REGION_NAMES[region] || 'SAmerica';
  const url = `https://api.deadlock-api.com/v1/leaderboard/${regionName}`;
  const res = await fetchUrl(url, {timeout:15000});
  const data = JSON.parse(res.body);
  console.log('[leaderboard] entries:', (data.entries||data||[]).length);
  const idToName = id => heroNameById[id] || ('#'+id);
  return (data.entries||data||[]).slice(0,200).map((p,i)=>{
    const ids = p.top_hero_ids || p.hero_ids || (p.top_hero_id?[p.top_hero_id]:[]) || [];
    const mh  = ids.length ? idToName(ids[0]) : '';
    return {
      pos:      p.rank || (i+1),
      name:     p.account_name||p.name||p.player_name||'Unknown',
      region:   region.toUpperCase(),
      badge:    p.badge_level||0,
      heroes:   ids.slice(0,3).map(idToName),
      main:     mh,        // renderer reads p.main
      mainHero: mh,        // keep both for safety
      rankLabel:rankLabelFromRanked(p.ranked_rank, p.ranked_subrank),
    };
  });
}

// ── PHASE 5: PATCH NOTES ──────────────────────────────────────────────────
// ── PHASE 6: HERO COUNTERS (qué héroe le gana a cuál) ─────────────────────
// CONFIRMED via live API (api-check.js, May 2026):
//   GET /v1/analytics/hero-counter-stats?min_average_badge=<b>
//   rows: { hero_id, enemy_hero_id, wins, matches_played, ... }  (1406 rows)
// For OUR hero: each row's enemy_hero_id is the opponent; wr = wins/matches_played.
async function fetchHeroCounters(heroId, minBadge=0){
  try{
    await loadHeroMap();
    const numId = heroNumId(heroId);
    if(!numId) return null;
    const url = `https://api.deadlock-api.com/v1/analytics/hero-counter-stats?min_average_badge=${minBadge}`;
    const res = await fetchUrl(url, {timeout:15000});
    const data = JSON.parse(res.body);
    if(!Array.isArray(data)) return null;
    const rows = data.filter(r => (r.hero_id===numId) && r.enemy_hero_id && (r.matches_played||0) >= 15);
    const mapped = rows.map(r => {
      const m = Number(r.matches_played) || 0;
      return {
        enemyId:   r.enemy_hero_id,
        enemyName: heroNameById[r.enemy_hero_id] || ('#'+r.enemy_hero_id),
        wr:        m ? (Number(r.wins)||0)/m : 0,
        matches:   m,
      };
    }).filter(x => x.wr>0);
    mapped.sort((a,b)=>b.wr-a.wr);
    console.log('[counters] hero', numId, '→', mapped.length, 'matchups');
    return {
      strong: mapped.slice(0,8),                 // le ganas (mejores matchups)
      weak:   mapped.slice(-8).reverse(),         // te ganan (peores matchups)
    };
  }catch(e){
    console.log('[counters] endpoint error:', e.message);
    return null; // fail soft — Counters half stays empty, Sinergias unaffected
  }
}

// ── PHASE 7: HERO SYNERGIES (mejores dúos) ────────────────────────────────
// CONFIRMED via live API (api-check.js, May 2026):
//   GET /v1/analytics/hero-synergy-stats?min_average_badge=<b>
//   rows: { hero_id1, hero_id2, wins, matches_played, ... }  (703 rows)
// Each row is an unordered pair. Keep rows containing OUR hero; the ally is
// whichever of hero_id1/hero_id2 is not us. wr = wins/matches_played.
async function fetchHeroSynergies(heroId, minBadge=0){
  await loadHeroMap();
  const numId = heroNumId(heroId);
  if(!numId) return null;
  const url = `https://api.deadlock-api.com/v1/analytics/hero-synergy-stats?min_average_badge=${minBadge}`;
  const res = await fetchUrl(url, {timeout:15000});
  const data = JSON.parse(res.body);
  if(!Array.isArray(data)) return null;
  const rows = data.filter(r =>
    (r.hero_id1===numId || r.hero_id2===numId) && (r.matches_played||0) >= 15);
  const mapped = rows.map(r => {
    const allyId = r.hero_id1===numId ? r.hero_id2 : r.hero_id1;
    const m = Number(r.matches_played) || 0;
    return {
      allyId,
      allyName: heroNameById[allyId] || ('#'+allyId),
      wr:       m ? (Number(r.wins)||0)/m : 0,
      matches:  m,
    };
  }).filter(x => x.allyId && x.wr>0);
  mapped.sort((a,b)=>b.wr-a.wr);
  console.log('[synergies] hero', numId, '→', mapped.length, 'duos');
  return { best: mapped.slice(0,8) };           // mejores compañeros
}

async function fetchPatchNotes(){
  try{
    const res = await fetchUrl('https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=1422450&count=30', {timeout:12000});
    const data = JSON.parse(res.body);
    const items = (data.appnews && data.appnews.newsitems) || [];
    // Official Valve posts only (feed_type 1) whose title looks like a patch — drops press articles
    const patches = items.filter(it => Number(it.feed_type)===1 && /update|hotfix|gameplay|patch/i.test(it.title||''));
    console.log('[patch-notes] steam items:', items.length, '| patch posts:', patches.length);
    return patches.slice(0,15).map(it=>{
      const ts = Number(it.date)||0;
      const dateStr = ts ? new Date(ts*1000).toISOString().slice(0,10) : '';
      const gid = it.gid || '';
      return {
        name: it.title || 'Update',
        date: dateStr,
        ts: ts,
        summary: it.contents || '',
        url: gid ? ('https://steamcommunity.com/games/1422450/announcements/detail/'+gid) : 'https://steamcommunity.com/games/1422450/announcements'
      };
    });
  }catch(e){ console.log('[patch-notes] ERROR', e.message); return []; }
}

// ── IPC HANDLERS ──────────────────────────────────────────────────────────
ipcMain.handle('fetch-hero-stats', async(_, badge) => {
  try {
    const data = await fetchHeroStats(badge||0);
    console.log('[hero-stats] Success:', data.length, 'heroes');
    return { ok:true, data };
  } catch(e) {
    console.error('[hero-stats] ERROR:', e.message||e.code||String(e));
    return { ok:false, error:e.message||e.code||'unknown' };
  }
});

ipcMain.handle('fetch-hero-build', async(_, id) => {
  try {
    const data = await fetchHeroBuild(id);
    console.log('[build]', id, data ? 'OK sections:'+(data.early.length+data.core.length+data.late.length) : 'null');
    return { ok:true, data };
  } catch(e) {
    console.error('[build] ERROR', id, e.message);
    return { ok:false, error:e.message };
  }
});

ipcMain.handle('fetch-item-stats',  async(_,id,b)=> { try{ return {ok:true,data:await fetchItemStats(id,b||0)}; }catch(e){ return {ok:false,error:e.message}; } });
ipcMain.handle('fetch-leaderboard', async(_,r,b)=>  { try{ return {ok:true,data:await fetchLeaderboard(r||'sa',b||0)}; }catch(e){ return {ok:false,error:e.message}; } });
ipcMain.handle('fetch-hero-counters',  async(_,id,b)=> { try{ return {ok:true,data:await fetchHeroCounters(id,b||0)}; }catch(e){ return {ok:false,error:e.message}; } });
ipcMain.handle('fetch-hero-synergies', async(_,id,b)=> { try{ return {ok:true,data:await fetchHeroSynergies(id,b||0)}; }catch(e){ return {ok:false,error:e.message}; } });
ipcMain.handle('fetch-patch-notes', async()=>       { try{ return {ok:true,data:await fetchPatchNotes()}; }catch(e){ return {ok:false,error:e.message}; } });
ipcMain.handle('get-app-version',   async()=>       app.getVersion());

// ── AUTO-UPDATE SCHEDULER ─────────────────────────────────────────────────
function scheduleAutoUpdate(){
  if(updateTimer) clearTimeout(updateTimer);
  updateTimer = setTimeout(()=>{
    if(mainWindow&&!mainWindow.isDestroyed()) mainWindow.webContents.send('auto-update-tick');
    scheduleAutoUpdate();
  }, UPDATE_INTERVAL_MS);
}

// ── APP AUTO-UPDATER (GitHub Releases) ───────────────────────────────────
let autoUpdater = null;
try {
  const { autoUpdater: au } = require('electron-updater');
  autoUpdater = au;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  updLog('electron-updater loaded; current app version ' + app.getVersion());
  autoUpdater.on('checking-for-update', ()  => updLog('checking-for-update...'));
  autoUpdater.on('update-available',    info => { updLog('UPDATE AVAILABLE: v' + info.version); if(mainWindow&&!mainWindow.isDestroyed()) mainWindow.webContents.send('app-update-available',    {version:info.version,releaseDate:info.releaseDate,releaseNotes:info.releaseNotes||''}); });
  autoUpdater.on('update-not-available',(info) => { updLog('no update available (latest is v' + (info&&info.version) + ')'); if(mainWindow&&!mainWindow.isDestroyed()) mainWindow.webContents.send('app-update-not-available'); });
  autoUpdater.on('download-progress',   p    => { if(mainWindow&&!mainWindow.isDestroyed()) mainWindow.webContents.send('app-update-progress', Math.round(p.percent)); });
  autoUpdater.on('update-downloaded',   ()   => { updLog('update downloaded, ready to install'); if(mainWindow&&!mainWindow.isDestroyed()) mainWindow.webContents.send('app-update-downloaded'); });
  autoUpdater.on('error',               err  => { updLog('ERROR: ' + (err && (err.stack||err.message||err))); if(mainWindow&&!mainWindow.isDestroyed()) mainWindow.webContents.send('app-update-error', err.message); });
} catch(e) { updLog('electron-updater NOT available: ' + e.message); }

ipcMain.handle('check-for-update', async() => { if(!autoUpdater) return {ok:false,error:'updater not available'}; try{ await autoUpdater.checkForUpdates(); return {ok:true}; }catch(e){ updLog('manual check error: '+e.message); return {ok:false,error:e.message}; } });
ipcMain.handle('download-update',  async() => { if(!autoUpdater) return {ok:false}; try{ await autoUpdater.downloadUpdate(); return {ok:true}; }catch(e){ updLog('download error: '+e.message); return {ok:false,error:e.message}; } });
ipcMain.on('install-update', () => { if(autoUpdater) autoUpdater.quitAndInstall(); });

app.whenReady().then(() => {
  setTimeout(() => {
    if(autoUpdater){ updLog('launch check firing (30s after ready)'); autoUpdater.checkForUpdates().catch(err => updLog('launch check rejected: ' + (err && (err.stack||err.message||err)))); }
    else { updLog('launch check skipped — autoUpdater is null'); }
  }, 30000);
});
