// ============================================================
//  Egypt Construction Prices API v4
//  المصدر: theprice1.com — كل مصنع لوحده
// ============================================================

let memCache = { data: null, time: 0 };
const CACHE_TTL = 6 * 60 * 60 * 1000;
const SOURCE_URL = 'https://theprice1.com/%D8%A3%D8%B3%D8%B9%D8%A7%D8%B1-%D9%85%D9%88%D8%A7%D8%AF-%D8%A7%D9%84%D8%A8%D9%86%D8%A7%D8%A1-%D8%A7%D9%84%D9%9A%D9%8A%D9%88%D9%85/';

async function fetchPage() {
  const res = await fetch(SOURCE_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'ar,en;q=0.5',
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.text();
}

function toNum(text) {
  if (!text) return null;
  const clean = text.replace(/<[^>]+>/g,'').replace(/,|،|٬/g,'')
    .replace(/[٠-٩]/g, d => d.charCodeAt(0) - 1632).trim();
  const m = clean.match(/\d{3,7}(?:\.\d+)?/);
  return m ? Math.round(parseFloat(m[0])) : null;
}

function cleanText(text) {
  return text.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
}

function getTableAfter(html, anchors) {
  for (const anchor of anchors) {
    const idx = html.indexOf(anchor);
    if (idx === -1) continue;
    const tStart = html.indexOf('<table', idx);
    if (tStart === -1 || tStart - idx > 4000) continue;
    const tEnd = html.indexOf('</table>', tStart) + 8;
    if (tEnd < tStart) continue;
    return html.substring(tStart, tEnd);
  }
  return null;
}

// الحديد — 5 أعمدة (اسم، وحدة، أعلى، أدنى، متوسط)
function parseSteelRows(tableHtml) {
  if (!tableHtml) return [];
  const rows = tableHtml.split(/<tr[\s>]/i).slice(2);
  const result = [];
  for (const row of rows) {
    const tds = row.split(/<td[\s>]/i);
    if (tds.length < 5) continue;
    const name = cleanText(tds[1])
      .replace(/سعر حديد\s*/i,'').replace(/اليوم$/i,'').trim();
    const avg = toNum(tds[4]);
    if (name && avg && avg > 10000 && avg < 200000) {
      result.push({ name, price: avg, unit: 'جنيه / طن' });
    }
  }
  return result;
}

// الأسمنت — 3 أعمدة (شركة، نوع، سعر)
function parseCementRows(tableHtml) {
  if (!tableHtml) return [];
  const rows = tableHtml.split(/<tr[\s>]/i).slice(2);
  const result = [];
  for (const row of rows) {
    const tds = row.split(/<td[\s>]/i);
    if (tds.length < 3) continue;
    const name = cleanText(tds[2] || tds[1])
      .replace(/أسمنت|اسمنت/gi,'').replace(/\d+\.\d+/g,'').trim() || cleanText(tds[1]);
    const price = toNum(tds[tds.length - 1]);
    if (name && price && price > 1000 && price < 20000) {
      result.push({ name: name.substring(0,30), price, unit: 'جنيه / طن' });
    }
  }
  return result;
}

// جداول بسيطة
function parseSimpleRows(tableHtml, minVal, maxVal, unit) {
  if (!tableHtml) return [];
  const rows = tableHtml.split(/<tr[\s>]/i).slice(2);
  const result = [];
  for (const row of rows) {
    const tds = row.split(/<td[\s>]/i);
    if (tds.length < 2) continue;
    const name = cleanText(tds[1]);
    let price = null;
    for (let i = 2; i < tds.length; i++) {
      const v = toNum(tds[i]);
      if (v && v >= minVal && v <= maxVal) { price = v; break; }
    }
    if (name && price) result.push({ name: name.substring(0,40), price, unit });
  }
  return result;
}

function buildPrices(html) {
  const data = {};

  // ── الحديد ──
  const steelTable = getTableAfter(html, ['أسعار طن حديد البناء اليوم','أسعار_طن_حديد_البناء_اليوم']);
  const steelRows = parseSteelRows(steelTable);
  if (steelRows.length) {
    data.steel = {
      label: 'حديد التسليح',
      icon: '🔩',
      cat: 'structure',
      unit: 'جنيه / طن',
      src: 'أسعار كوم',
      items: steelRows,
      avg: Math.round(steelRows.reduce((s,r)=>s+r.price,0)/steelRows.length),
    };
  }

  // ── الأسمنت ──
  const cementTable = getTableAfter(html, ['أسعار طن أسمنت البناء اليوم','أسعار_طن_أسمنت_البناء_اليوم']);
  const cementRows = parseCementRows(cementTable);
  if (cementRows.length) {
    data.cement = {
      label: 'الأسمنت',
      icon: '🏭',
      cat: 'structure',
      unit: 'جنيه / طن',
      src: 'أسعار كوم',
      items: cementRows,
      avg: Math.round(cementRows.reduce((s,r)=>s+r.price,0)/cementRows.length),
    };
  }

  // ── الزلط ──
  const gravelTable = getTableAfter(html, ['أسعار السن والظلط اليوم','أسعار_السن_والظلط_اليوم']);
  const gravelRows = parseSimpleRows(gravelTable, 100, 2000, 'جنيه / م³');
  if (gravelRows.length) {
    data.gravel = { label:'الزلط والسن', icon:'🪨', cat:'structure', unit:'جنيه / م³', src:'أسعار كوم',
      items: gravelRows, avg: Math.round(gravelRows.reduce((s,r)=>s+r.price,0)/gravelRows.length) };
  }

  // ── الرمل ──
  const sandTable = getTableAfter(html, ['أسعار متر الرمل اليوم','أسعار_متر_الرمل_اليوم']);
  const sandRows = parseSimpleRows(sandTable, 50, 1000, 'جنيه / م³');
  if (sandRows.length) {
    data.sand = { label:'الرمل', icon:'⏳', cat:'structure', unit:'جنيه / م³', src:'أسعار كوم',
      items: sandRows, avg: Math.round(sandRows.reduce((s,r)=>s+r.price,0)/sandRows.length) };
  }

  // ── الطوب الأحمر ──
  const bricksTable = getTableAfter(html, ['أسعار الطوب الأحمر اليوم','أسعار_الطوب_الأحمر_اليوم']);
  const bricksRows = parseSimpleRows(bricksTable, 500, 15000, 'جنيه / ألف طوبة');
  if (bricksRows.length) {
    data.bricks = { label:'الطوب الأحمر', icon:'🧱', cat:'structure', unit:'جنيه / ألف طوبة', src:'أسعار كوم',
      items: bricksRows, avg: Math.round(bricksRows.reduce((s,r)=>s+r.price,0)/bricksRows.length) };
  }

  // ── الطوب الأبيض ──
  const wbTable = getTableAfter(html, ['أسعار الطوب الأبيض اليوم','أسعار_الطوب_الأبيض_اليوم']);
  const wbRows = parseSimpleRows(wbTable, 100, 5000, 'جنيه / م²');
  if (wbRows.length) {
    data.white_bricks = { label:'الطوب الأبيض', icon:'⬜', cat:'structure', unit:'جنيه / م²', src:'أسعار كوم',
      items: wbRows, avg: Math.round(wbRows.reduce((s,r)=>s+r.price,0)/wbRows.length) };
  }

  return data;
}

// بيانات احتياطية بنفس الهيكل الجديد
const FALLBACK = {
  steel: { label:'حديد التسليح', icon:'🔩', cat:'structure', unit:'جنيه / طن', src:'بيانات احتياطية', avg:36100,
    items:[{name:'عز',price:38000},{name:'بشاي',price:37950},{name:'المصريين',price:37500},{name:'مصر ستيل',price:35000},{name:'العشري',price:34500}]},
  cement: { label:'الأسمنت', icon:'🏭', cat:'structure', unit:'جنيه / طن', src:'بيانات احتياطية', avg:3760,
    items:[{name:'سيناء 52.5',price:3850},{name:'العسكري 52.5',price:3850},{name:'سيناء 42.5',price:3800},{name:'العريش 42.5',price:3800},{name:'المصريين',price:3770},{name:'وادي النيل',price:3680},{name:'بني سويف',price:3700}]},
  bricks: { label:'الطوب الأحمر', icon:'🧱', cat:'structure', unit:'جنيه / ألف طوبة', src:'بيانات احتياطية', avg:7500,
    items:[{name:'طوب أحمر مصمت',price:7500}]},
  sand: { label:'الرمل', icon:'⏳', cat:'structure', unit:'جنيه / م³', src:'بيانات احتياطية', avg:160,
    items:[{name:'رمل مكسر',price:160},{name:'رمل ناعم',price:150}]},
  gravel: { label:'الزلط والسن', icon:'🪨', cat:'structure', unit:'جنيه / م³', src:'بيانات احتياطية', avg:280,
    items:[{name:'زلط جلبهانة',price:280},{name:'سن',price:260}]},
  ceramic: { label:'السيراميك', icon:'🔲', cat:'finish', unit:'جنيه / م²', src:'بيانات احتياطية', avg:450,
    items:[{name:'متوسط الجودة 60×60',price:450},{name:'جودة عالية',price:650}]},
  paint: { label:'الدهانات', icon:'🎨', cat:'finish', unit:'جنيه / لتر', src:'بيانات احتياطية', avg:380,
    items:[{name:'دهان حراري',price:420},{name:'دهان بلاستيك',price:340}]},
  wood: { label:'الخشب', icon:'🪵', cat:'finish', unit:'جنيه / م³', src:'بيانات احتياطية', avg:12000,
    items:[{name:'خشب صنوبر',price:12000},{name:'خشب زان',price:15000}]},
  copper: { label:'أسلاك النحاس', icon:'🔌', cat:'metal', unit:'جنيه / كجم', src:'بيانات احتياطية', avg:520,
    items:[{name:'سلك 2.5مم',price:520},{name:'سلك 4مم',price:600}]},
  aluminum: { label:'الألومنيوم', icon:'🪟', cat:'metal', unit:'جنيه / طن', src:'بيانات احتياطية', avg:95000,
    items:[{name:'بروفيل نوافذ',price:95000}]},
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const force = req.query.force === '1';
  if (!force && memCache.data && Date.now() - memCache.time < CACHE_TTL) {
    return res.status(200).json({ ...memCache.data, cached: true });
  }

  try {
    const html = await fetchPage();
    const scraped = buildPrices(html);

    const prices = { ...FALLBACK };
    for (const key of Object.keys(scraped)) {
      if (scraped[key]?.items?.length > 0) {
        prices[key] = { ...FALLBACK[key], ...scraped[key] };
      }
    }

    const scrapedCount = Object.keys(scraped).length;
    const response = {
      success: true, cached: false,
      scrapedItems: scrapedCount,
      source: scrapedCount > 0 ? `أسعار كوم — ${scrapedCount} مواد` : 'بيانات احتياطية',
      updatedAt: new Date().toISOString(),
      updatedAtAr: new Date().toLocaleDateString('ar-EG', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      }),
      prices,
    };

    memCache = { data: response, time: Date.now() };
    return res.status(200).json(response);

  } catch (err) {
    return res.status(200).json({
      success: true, cached: false, scrapedItems: 0,
      source: 'بيانات احتياطية',
      updatedAt: new Date().toISOString(),
      updatedAtAr: new Date().toLocaleDateString('ar-EG', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      }),
      prices: FALLBACK,
    });
  }
}
