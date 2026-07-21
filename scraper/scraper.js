// RegWatchAI Live Scraper — Regovix
// Runs every 6 hours via GitHub Actions
// Fetches 6 Australian regulatory sources, detects new content,
// uses Claude AI to classify severity, writes to Supabase

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';

const ANTHROPIC_API_KEY   = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const SOURCES = [
  {
    id: 'safework', name: 'SafeWork NSW',
    url: 'https://www.safework.nsw.gov.au/news',
    baseUrl: 'https://www.safework.nsw.gov.au'
  },
  {
    id: 'nhvr', name: 'NHVR / HVNL',
    url: 'https://www.nhvr.gov.au/news-events/latest-news',
    baseUrl: 'https://www.nhvr.gov.au'
  },
  {
    id: 'swa', name: 'Safe Work Australia',
    url: 'https://www.safeworkaustralia.gov.au/news',
    baseUrl: 'https://www.safeworkaustralia.gov.au'
  },
  {
    id: 'epa', name: 'EPA NSW',
    url: 'https://www.epa.nsw.gov.au/news-and-media',
    baseUrl: 'https://www.epa.nsw.gov.au'
  },
  {
    id: 'adg', name: 'ADG Code',
    url: 'https://www.ntc.gov.au/transport-standards/australian-dangerous-goods-code',
    baseUrl: 'https://www.ntc.gov.au'
  },
  {
    id: 'standards', name: 'AS/NZS Standards',
    url: 'https://www.safeworkaustralia.gov.au/doc/model-whs-regulations',
    baseUrl: 'https://www.safeworkaustralia.gov.au'
  }
];

const HSEQ_KEYWORDS = [
  'whs','work health','safety','hazard','dangerous goods','adg','chemical',
  'fatigue','psychosocial','silica','asbestos','confined space','hvnl',
  'heavy vehicle','chain of responsibility','cor','epa','waste','regulation',
  'code of practice','penalty','prosecution','fine','enforcement','inspection',
  'amendment','commencement','licence','accreditation','notice','alert'
];

async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': 'RegWatchAI/1.0 (Regovix HSEQ Compliance; regovix.com.au)',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch(e) {
    console.error(`  ✗ ${url}: ${e.message}`);
    return null;
  }
}

function extractItems(html, source) {
  const $ = cheerio.load(html);
  const items = [];
  const seen = new Set();

  // Try to find article links
  $('h2 a, h3 a, .news-item a, article a, li a').each((i, el) => {
    if (items.length >= 20) return false;
    const $el = $(el);
    const title = $el.text().trim();
    const href  = $el.attr('href') || '';
    if (!title || title.length < 15 || seen.has(title)) return;

    const combined = title.toLowerCase();
    const relevant = HSEQ_KEYWORDS.some(kw => combined.includes(kw));
    if (!relevant) return;

    seen.add(title);
    const fullUrl = href.startsWith('http') ? href :
                    href.startsWith('/') ? source.baseUrl + href : '';
    const parent = $el.closest('li, article, div').text().replace(/\s+/g,' ').trim();
    const snippet = parent.substring(0, 300);

    items.push({ title, url: fullUrl, snippet, sourceId: source.id });
  });

  return items;
}

function makeId(sourceId, title) {
  return sourceId + '-' + title.toLowerCase().replace(/[^a-z0-9]/g,'').substring(0, 50);
}

async function exists(itemId) {
  const { data } = await supabase
    .from('regwatch_alerts')
    .select('id')
    .eq('item_id', itemId)
    .maybeSingle();
  return !!data;
}

async function classifyWithClaude(item, sourceName) {
  const prompt = `You are RegWatchAI, an expert Australian HSEQ compliance system for Regovix.

Analyse this regulatory news from ${sourceName}:
Title: ${item.title}
URL: ${item.url}
Snippet: ${item.snippet}

Respond ONLY with valid JSON (no markdown):
{
  "sev": "CRITICAL|HIGH|MEDIUM|LOW",
  "tt": "alert title under 80 chars",
  "su": "2-3 sentence summary of what changed and why it matters to HSEQ professionals",
  "apps": ["affected Regovix apps from: DGVault,RiskMatrix,RiskReady,InductReady,ToolboxGen,IncidentLoop,FleetCheck,ChemTrack,AuditMate,WellnessCheck,ComplianceVault"],
  "rf": "reference citation"
}

Severity: CRITICAL=new law/commencement/major code change, HIGH=new guidance/enforcement focus, MEDIUM=consultation/minor amendment, LOW=general news/stats`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    return JSON.parse(text.replace(/```json|```/g,'').trim());
  } catch(e) {
    console.error(`  ✗ Claude error: ${e.message}`);
    return null;
  }
}

async function main() {
  console.log(`\n🔍 RegWatchAI Scraper — ${new Date().toISOString()}`);
  console.log('─'.repeat(60));
  let totalNew = 0;

  for (const source of SOURCES) {
    console.log(`\n📋 ${source.name}`);
    const html = await fetchPage(source.url);
    if (!html) {
      await supabase.from('regwatch_sources').upsert(
        { source_id: source.id, source_name: source.name,
          last_scanned: new Date().toISOString(), status: 'error' },
        { onConflict: 'source_id' }
      );
      continue;
    }

    const items = extractItems(html, source);
    console.log(`   Found ${items.length} relevant items`);
    let newCount = 0;

    for (const item of items) {
      const itemId = makeId(source.id, item.title);
      if (await exists(itemId)) { process.stdout.write('.'); continue; }

      console.log(`\n   🆕 ${item.title.substring(0,70)}`);
      const classified = await classifyWithClaude(item, source.name);
      if (!classified) continue;

      const now = new Date().toISOString().split('T')[0];
      const { error } = await supabase.from('regwatch_alerts').insert({
        item_id: itemId, rid: source.id, reg: source.name,
        sev: classified.sev, tt: classified.tt, su: classified.su,
        apps: classified.apps, rf: classified.rf,
        source_url: item.url, dt: now, st: 'open',
        created_at: new Date().toISOString()
      });

      if (!error) { newCount++; totalNew++; console.log(`   ✅ [${classified.sev}] ${classified.tt}`); }
      else console.error(`   ✗ DB error: ${error.message}`);

      await new Promise(r => setTimeout(r, 1000)); // rate limit
    }

    await supabase.from('regwatch_sources').upsert(
      { source_id: source.id, source_name: source.name,
        last_scanned: new Date().toISOString(),
        items_found: items.length, new_alerts: newCount, status: 'ok' },
      { onConflict: 'source_id' }
    );
    console.log(`\n   ✓ ${newCount} new alerts`);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`✅ Done — ${totalNew} new alerts total\n`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
