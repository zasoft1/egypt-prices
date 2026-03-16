// ============================================================
//  Egypt Construction Prices API
//  المصدر: theprice1.com (أسعار كوم) — يتحدث يومياً
// ============================================================

let memCache = { data: null, time: 0 };
const CACHE_TTL = 6 * 60 * 60 * 1000;

const SOURCE_URL = 'https://theprice1.com/%D8%A3%D8%B3%D8%B9%D8%A7%D8%B1-%D9%85%D9%88%D8%A7%D8%AF-%D8%A7%D9%84%D8%A8%D9%86%D8%A7%D8%A1-%D8%A7%D9%84%D9%8A%D9%88%D9%85/';

async function fetchPage() {
  const res = await fetch(SOURCE_URL, {
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

function extractNumber(text) {
  if (!text) return null;
  const clean = text.replace(/,|،|٬/g, '').replace(/[٠-٩]/g, d => d.charCodeAt(0) - 1632);
  const m = clean.match(/\d{4,6}/);
  return m ? parseInt(m[0]) : null;
}

function parseTable(html, keyword) {
  // إيجاد الجدول الأقرب للكلمة المفتاحية
  const idx = html.indexOf(keyword);
  if (idx === -1) return null;

  const tableStart = html.indexOf('<table', idx);
  if (tableStart === -1) return null;
  const tableEnd = html.indexOf('</table>', tableStart) + 8;
  const table = html.substring(tableStart, tableEnd);

  // استخراج الصفوف
  const rows = table.split('<tr').slice(2); // تخطي الهيدر
  const results = [];

  for (const row of rows) {
    const cells = row.split('<td');
    if (cells.length < 4) continue;

    const getText = (cell) => cell.replace(/<[^>]+>/g, '').trim();
    const name = getText(cells[1]);
    const high = extractNumber(getText(cells[2]));
    const low  = extractNumber(getText(cells[3]));
    const avg  = cells[4] ? extractNumber(getText(cells[4])) : null;

    if (high || low) {
      results.push({
        name,
        price: avg || Math.round(((high || 0) + (low || 0)) / 2),
        high: high || 0,
        low:  low  || 0,
      });
    }
  }
  return results.length ? results : null;
}

function buildPrices(html) {
  const prices = {};

  // ── الحديد ──
  const steelRows = parseTable(html, 'حديد البناء');
  if (steelRows && steelRows.length > 0) {
    // متوسط كل الشركات
    const avg = Math.round(steelRows.reduce((s, r) => s + r.price, 0) / steelRows.length);
    const ezzRow = steelRows.find(r => r.name.includes('عز')) || steelRows[0];
    prices.steel = {
      price: avg,
      change: 0,
      unit: 'جنيه / طن',
      src: 'أسعار كوم',
      detail: ezzRow ? `عز: ${ezzRow.price.toLocaleString('ar-EG')}` : '',
    };
  }

  // ── الأسمنت ──
  const cementRows = parseTable(html, 'أسمنت البناء');
  if (cementRows && cementRows.length > 0) {
    const avg = Math.round(cementRows.reduce((s, r) => s + r.price, 0) / cementRows.length);
    prices.cement = { price: avg, change: 0, unit: 'جنيه / طن', src: 'أسعار كوم' };
  }

  // ── الرمل ──
  const sandMatch = html.match(/[رR]مل[^٠-٩\d]*([٠-٩\d]{2,4})\s*(?:جنيه|ج)/);
  if (sandMatch) {
    prices.sand = { price: extractNumber(sandMatch[1]) || 150, change: 0, unit: 'جنيه / م³', src: 'أسعار كوم' };
  }

  // ── السن والزلط ──
  const gravelRows = parseTable(html, 'السن والظلط');
  if (gravelRows && gravelRows.length > 0) {
    prices.gravel = { price: gravelRows[0].price, change: 0, unit: 'جنيه / م³', src: 'أسعار كوم' };
  }

  // ── الطوب الأحمر ──
  const bricksRows = parseTable(html, 'الطوب الأحمر');
  if (bricksRows && bricksRows.length > 0) {
    prices.bricks = { price: bricksRows[0].price, change: 0, unit: 'جنيه / ألف طوبة', src: 'أسعار كوم' };
  }

  return prices;
}

// قيم احتياطية محدّثة (مارس 2026)
const FALLBACK = {
  steel:    { price: 37000, change: 0, unit: 'جنيه / طن',       src: 'بيانات احتياطية' },
  cement:   { price: 4200,  change: 0, unit: 'جنيه / طن',       src: 'بيانات احتياطية' },
  bricks:   { price: 7500,  change: 0, unit: 'جنيه / ألف طوبة', src: 'بيانات احتياطية' },
  sand:     { price: 160,   change: 0, unit: 'جنيه / م³',       src: 'بيانات احتياطية' },
  gravel:   { price: 280,   change: 0, unit: 'جنيه / م³',       src: 'بيانات احتياطية' },
  ceramic:  { price: 450,   change: 0, unit: 'جنيه / م²',       src: 'بيانات احتياطية' },
  paint:    { price: 380,   change: 0, unit: 'جنيه / لتر',      src: 'بيانات احتياطية' },
  wood:     { price: 12000, change: 0, unit: 'جنيه / م³',       src: 'بيانات احتياطية' },
  copper:   { price: 520,   change: 0, unit: 'جنيه / كجم',      src: 'بيانات احتياطية' },
  aluminum: { price: 95000, change: 0, unit: 'جنيه / طن',       src: 'بيانات احتياطية' },
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
    const html  = await fetchPage();
    const scraped = buildPrices(html);

    // دمج مع الاحتياطي
    const prices = { ...FALLBACK };
    for (const key of Object.keys(scraped)) {
      if (scraped[key] && scraped[key].price > 0) {
        prices[key] = { ...FALLBACK[key], ...scraped[key] };
      }
    }

    const scrapedCount = Object.keys(scraped).length;

    const response = {
      success: true,
      cached: false,
      scrapedItems: scrapedCount,
      source: scrapedCount > 0 ? 'أسعار كوم (theprice1.com)' : 'بيانات احتياطية',
      updatedAt: new Date().toISOString(),
      updatedAtAr: new Date().toLocaleDateString('ar-EG', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      }),
      prices,
    };

    memCache = { data: response, time: Date.now() };
    return res.status(200).json(response);

  } catch (err) {
    const fallbackRes = {
      success: true,
      cached: false,
      scrapedItems: 0,
      source: 'بيانات احتياطية (خطأ في الجلب)',
      updatedAt: new Date().toISOString(),
      updatedAtAr: new Date().toLocaleDateString('ar-EG', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      }),
      prices: FALLBACK,
    };
    return res.status(200).json(fallbackRes);
  }
}
