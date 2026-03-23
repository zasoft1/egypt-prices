// ============================================================
//  Egypt Construction Prices API v4
//  المصدر: theprice1.com — كل مصنع لوحده
// ============================================================

let memCache = { data: null, time: 0 };
const CACHE_TTL = 6 * 60 * 60 * 1000;
const SOURCE_URL    = 'https://theprice1.com/%D8%A3%D8%B3%D8%B9%D8%A7%D8%B1-%D9%85%D9%88%D8%A7%D8%AF-%D8%A7%D9%84%D8%A8%D9%86%D8%A7%D8%A1-%D8%A7%D9%84%D9%8A%D9%88%D9%85/';
const ALUM_URL      = 'https://theprice1.com/%D8%A3%D8%B3%D8%B9%D8%A7%D8%B1-%D8%A7%D9%84%D8%A3%D9%84%D9%88%D9%85%D9%86%D9%8A%D9%88%D9%85-%D8%A7%D9%84%D9%8A%D9%88%D9%85/';
const CERAMIC_URL   = 'https://www.biltafsil.com/building-materials/ceramics/';
const WOOD_URL      = 'https://www.biltafsil.com/building-materials/wood/';

async function fetchPage(url = SOURCE_URL) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'ar,en;q=0.5',
    },
    signal: AbortSignal.timeout(10000),
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
  return text
    .replace(/<[^>]+>/g,'')
    .replace(/data-[a-z]+="[^"]*"/gi,'')
    .replace(/class="[^"]*"/gi,'')
    .replace(/^["'>\s]+/,'')
    .replace(/\s+/g,' ')
    .trim();
}

function getTableAfter(html, anchors) {
  for (const anchor of anchors) {
    const idx = html.indexOf(anchor);
    if (idx === -1) continue;
    const tStart = html.indexOf('<table', idx);
    if (tStart === -1 || tStart - idx > 8000) continue;
    const tEnd = html.indexOf('</table>', tStart) + 8;
    if (tEnd < tStart) continue;
    return html.substring(tStart, tEnd);
  }
  return null;
}

// استخراج الجدول رقم N من الصفحة (0-based)
function getNthTable(html, n) {
  let pos = 0;
  for (let i = 0; i <= n; i++) {
    const tStart = html.indexOf('<table', pos);
    if (tStart === -1) return null;
    const tEnd = html.indexOf('</table>', tStart) + 8;
    if (i === n) return html.substring(tStart, tEnd);
    pos = tEnd;
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
    const raw = cleanText(tds[1])
      .replace(/class="[^"]*"/gi,'')
      .replace(/سعر حديد\s*/i,'').replace(/اليوم$/i,'').trim();
    const name = raw.replace(/^[>\s]+/,'').trim();
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
    const raw2 = cleanText(tds[2] || tds[1])
      .replace(/class="[^"]*"/gi,'')
      .replace(/أسمنت|اسمنت/gi,'').replace(/\d+\.\d+/g,'').trim();
    const name = (raw2 || cleanText(tds[1])).replace(/^[>\s]+/,'').trim();
    const price = toNum(tds[tds.length - 1]);
    if (name && price && price > 1000 && price < 20000) {
      result.push({ name: name.substring(0,30), price, unit: 'جنيه / طن' });
    }
  }
  return result;
}

// جداول بسيطة
function parseSimpleRows(tableHtml, minVal, maxVal, unit, combineFirstTwo) {
  if (!tableHtml) return [];
  const rows = tableHtml.split(/<tr[\s>]/i).slice(2);
  const result = [];
  for (const row of rows) {
    const tds = row.split(/<td[\s>]/i);
    if (tds.length < 2) continue;
    const clean = s => cleanText(s).replace(/class="[^"]*"/gi,"").replace(/^[>\s]+/,"").trim();
    let name = clean(tds[1]);
    // لو فيه عمود تاني ومختلف — ندمجهم
    if (combineFirstTwo && tds[2]) {
      const col2 = clean(tds[2]);
      const isPrice = toNum(col2) !== null;
      if (!isPrice && col2 && col2 !== name) {
        name = name + ' ' + col2;
      }
    }
    let price = null;
    for (let i = 2; i < tds.length; i++) {
      const v = toNum(tds[i]);
      if (v && v >= minVal && v <= maxVal) { price = v; break; }
    }
    if (name && price) result.push({ name: name.substring(0,50), price, unit });
  }
  return result;
}

function buildPrices(html) {
  const data = {};

  // الجداول بالترتيب الثابت في الصفحة:
  // 0=حديد، 1=أسمنت، 2=زلط، 3=رمل، 4=طوب أحمر، 5=طوب أبيض

  // ── الحديد (جدول 0) ──
  const steelRows = parseSteelRows(getNthTable(html, 0));
  if (steelRows.length) {
    data.steel = { label:'حديد التسليح', icon:'🔩', cat:'structure', unit:'جنيه / طن', src:'أسعار كوم',
      items: steelRows, avg: Math.round(steelRows.reduce((s,r)=>s+r.price,0)/steelRows.length) };
  }

  // ── الأسمنت (جدول 1) ──
  const cementRows = parseCementRows(getNthTable(html, 1));
  if (cementRows.length) {
    data.cement = { label:'الأسمنت', icon:'🏭', cat:'structure', unit:'جنيه / طن', src:'أسعار كوم',
      items: cementRows, avg: Math.round(cementRows.reduce((s,r)=>s+r.price,0)/cementRows.length) };
  }

  // ── الزلط والسن (جدول 2) ──
  const gravelRows = parseSimpleRows(getNthTable(html, 2), 50, 5000, 'جنيه / م³');
  if (gravelRows.length) {
    data.gravel = { label:'الزلط والسن', icon:'🪨', cat:'structure', unit:'جنيه / م³', src:'أسعار كوم',
      items: gravelRows, avg: Math.round(gravelRows.reduce((s,r)=>s+r.price,0)/gravelRows.length) };
  }

  // ── الرمل (جدول 3) ──
  const sandRows = parseSimpleRows(getNthTable(html, 3), 50, 5000, 'جنيه / م³');
  if (sandRows.length) {
    data.sand = { label:'الرمل', icon:'⏳', cat:'structure', unit:'جنيه / م³', src:'أسعار كوم',
      items: sandRows, avg: Math.round(sandRows.reduce((s,r)=>s+r.price,0)/sandRows.length) };
  }

  // ── الطوب الأحمر (جدول 4) ──
  const bricksRows = parseSimpleRows(getNthTable(html, 4), 500, 50000, 'جنيه / ألف طوبة', true);
  if (bricksRows.length) {
    data.bricks = { label:'الطوب الأحمر', icon:'🧱', cat:'structure', unit:'جنيه / ألف طوبة', src:'أسعار كوم',
      items: bricksRows, avg: Math.round(bricksRows.reduce((s,r)=>s+r.price,0)/bricksRows.length) };
  }

  // ── الطوب الأبيض (جدول 5) ──
  const wbRows = parseSimpleRows(getNthTable(html, 5), 50, 50000, 'جنيه / م²', true);
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
  ceramic: { label:'السيراميك', icon:'🔲', cat:'finish', unit:'جنيه / م²', src:'بيانات احتياطية', avg:175,
    items:[{name:'فرز ثالث حوائط',price:70},{name:'فرز ثاني أرضيات',price:120},{name:'فرز أول كليوباترا',price:220},{name:'بورسلين مصري 60×60',price:370}]},
  paint: { label:'الدهانات', icon:'🎨', cat:'finish', unit:'جنيه / جالون 3.6ل', src:'بيانات احتياطية', avg:850,
    items:[{name:'دهان بلاستيك شعبي',price:450},{name:'دهان GLC بلاستيك',price:750},{name:'دهان جوتن حراري',price:1100},{name:'دهان بروتال سوبر لوكس',price:1200}]},
  wood: { label:'الخشب', icon:'🪵', cat:'finish', unit:'جنيه / م³', src:'بيانات احتياطية', avg:13500,
    items:[{name:'خشب صنوبر',price:11000},{name:'خشب زان',price:14000},{name:'خشب أبيض روسي',price:16000}]},
  copper: { label:'أسلاك كهربائية', icon:'🔌', cat:'metal', unit:'جنيه / كجم', src:'بيانات احتياطية', avg:580,
    items:[{name:'سلك 1.5مم عازل',price:480},{name:'سلك 2.5مم عازل',price:580},{name:'سلك 4مم عازل',price:720},{name:'سلك 6مم عازل',price:1050}]},
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
    // جلب الصفحات بالتوازي
    const [mainHtml, alumHtml, ceramicHtml, woodHtml] = await Promise.all([
      fetchPage(SOURCE_URL),
      fetchPage(ALUM_URL).catch(() => ''),
      fetchPage(CERAMIC_URL).catch(() => ''),
      fetchPage(WOOD_URL).catch(() => ''),
    ]);

    const scraped = buildPrices(mainHtml);

    // النحاس — من البيانات الاحتياطية فقط

    // ── الألومنيوم من صفحة منفصلة ──
    if (alumHtml) {
      const alumTable = getNthTable(alumHtml, 0);
      const alumRows = parseSimpleRows(alumTable, 1000, 200000, 'جنيه / طن');
      if (alumRows.length) {
        scraped.aluminum = { label:'الألومنيوم', icon:'🪟', cat:'metal', unit:'جنيه / طن', src:'أسعار كوم',
          items: alumRows, avg: Math.round(alumRows.reduce((s,r)=>s+r.price,0)/alumRows.length) };
      }
    }

    // ── السيراميك من biltafsil.com ──
    if (ceramicHtml) {
      const ceramicTable = getNthTable(ceramicHtml, 0);
      const ceramicRows = parseSimpleRows(ceramicTable, 50, 2000, 'جنيه / م²');
      if (ceramicRows.length) {
        scraped.ceramic = { label:'السيراميك', icon:'🔲', cat:'finish', unit:'جنيه / م²', src:'بالتفصيل',
          items: ceramicRows, avg: Math.round(ceramicRows.reduce((s,r)=>s+r.price,0)/ceramicRows.length) };
      }
    }

    // ── الخشب من biltafsil.com ──
    if (woodHtml) {
      const woodTable = getNthTable(woodHtml, 0);
      const woodRows = parseSimpleRows(woodTable, 5000, 100000, 'جنيه / م³');
      if (woodRows.length) {
        scraped.wood = { label:'الخشب', icon:'🪵', cat:'finish', unit:'جنيه / م³', src:'بالتفصيل',
          items: woodRows, avg: Math.round(woodRows.reduce((s,r)=>s+r.price,0)/woodRows.length) };
      }
    }

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
