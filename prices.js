// ============================================================
//  Egypt Construction Prices API
//  Vercel Serverless Function — يسكرب أسعار مواد البناء
//  المصادر: مواقع مصرية متعددة
// ============================================================

// Cache في الذاكرة (تعيش طول عمر الـ instance)
let memCache = { data: null, time: 0 };
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 ساعات

// ─── دالة fetch مع timeout ───────────────────────────────
async function fetchWithTimeout(url, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ar,en;q=0.5',
        'Cache-Control': 'no-cache',
      },
    });
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ─── استخراج رقم من نص ────────────────────────────────────
function extractNumber(text) {
  if (!text) return null;
  const clean = text.replace(/,/g, '').replace(/٬/g, '');
  const m = clean.match(/[\d]+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

// ─── استخراج بالـ Regex ───────────────────────────────────
function regexExtract(html, patterns) {
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m) {
      const num = extractNumber(m[1] || m[0]);
      if (num && num > 0) return num;
    }
  }
  return null;
}

// ─── السكرابر الأول: مصراوي / اليوم السابع RSS ────────────
async function scrapeFromNews() {
  const results = {};

  // أسعار حديد التسليح
  try {
    const html = await fetchWithTimeout(
      'https://www.youm7.com/Section/أسعار/468'
    );
    // ابحث عن أسعار الحديد
    const steelPatterns = [
      /حديد[^<]*?(\d{1,3}[,،]?\d{3})\s*جنيه/gi,
      /سعر\s*الحديد[^<]*?(\d{1,3}[,،]?\d{3})/gi,
      /ezz[^<]*?(\d{1,3}[,،]?\d{3})/gi,
    ];
    const steel = regexExtract(html, steelPatterns);
    if (steel && steel > 10000) results.steel = steel;
  } catch(e) {}

  // أسعار الأسمنت
  try {
    const html = await fetchWithTimeout(
      'https://www.youm7.com/Section/أسعار/468'
    );
    const cementPatterns = [
      /أسمنت[^<]*?(\d{1,3}[,،]?\d{3})\s*جنيه/gi,
      /سعر\s*الأسمنت[^<]*?(\d{3,4})/gi,
      /الاسمنت[^<]*?(\d{3,4})/gi,
    ];
    const cement = regexExtract(html, cementPatterns);
    if (cement && cement > 500) results.cement = cement;
  } catch(e) {}

  return results;
}

// ─── السكرابر الثاني: مواقع أسعار متخصصة ─────────────────
async function scrapeSpecialized() {
  const results = {};

  // محاولة جلب أسعار من موقع متخصص
  const urls = [
    'https://www.masrawy.com/news/tag/أسعار-مواد-البناء',
    'https://www.elwatannews.com/news/tag/أسعار-مواد-البناء',
  ];

  for (const url of urls) {
    try {
      const html = await fetchWithTimeout(url, 6000);

      if (!results.steel) {
        const m = html.match(/حديد[^<"]{0,30}?(\d{1,2}[,،]\d{3})\s*(?:جنيه|ج\.م)/i);
        if (m) {
          const v = extractNumber(m[1]);
          if (v > 10000) results.steel = v;
        }
      }

      if (!results.cement) {
        const m = html.match(/أسمنت[^<"]{0,30}?(\d{3,4})\s*(?:جنيه|ج\.م)/i);
        if (m) {
          const v = extractNumber(m[1]);
          if (v > 500) results.cement = v;
        }
      }

    } catch(e) {}
  }

  return results;
}

// ─── بيانات مرجعية (تُستخدم كـ fallback / seed) ──────────
// آخر تحديث يدوي — تعكس أسعار السوق المصري التقريبية
const REFERENCE_PRICES = {
  steel:      { price: 28000, unit: 'جنيه / طن',     change: 0, src: 'بيانات مرجعية' },
  cement:     { price: 3200,  unit: 'جنيه / طن',     change: 0, src: 'بيانات مرجعية' },
  bricks:     { price: 6500,  unit: 'جنيه / ألف طوبة', change: 0, src: 'بيانات مرجعية' },
  sand:       { price: 1800,  unit: 'جنيه / م³',     change: 0, src: 'بيانات مرجعية' },
  gravel:     { price: 2200,  unit: 'جنيه / م³',     change: 0, src: 'بيانات مرجعية' },
  ceramic:    { price: 350,   unit: 'جنيه / م²',     change: 0, src: 'بيانات مرجعية' },
  paint:      { price: 280,   unit: 'جنيه / لتر',    change: 0, src: 'بيانات مرجعية' },
  wood:       { price: 9500,  unit: 'جنيه / م³',     change: 0, src: 'بيانات مرجعية' },
  copper:     { price: 380,   unit: 'جنيه / كجم',    change: 0, src: 'بيانات مرجعية' },
  aluminum:   { price: 85000, unit: 'جنيه / طن',     change: 0, src: 'بيانات مرجعية' },
};

// ─── دمج نتائج السكرابينج مع البيانات المرجعية ────────────
function mergeResults(scraped) {
  const out = JSON.parse(JSON.stringify(REFERENCE_PRICES));

  if (scraped.steel && scraped.steel > 10000 && scraped.steel < 100000) {
    out.steel.change = scraped.steel - out.steel.price;
    out.steel.price  = scraped.steel;
    out.steel.src    = 'اليوم السابع';
  }
  if (scraped.cement && scraped.cement > 500 && scraped.cement < 10000) {
    out.cement.change = scraped.cement - out.cement.price;
    out.cement.price  = scraped.cement;
    out.cement.src    = 'اليوم السابع';
  }

  return out;
}

// ─── Handler الرئيسي ──────────────────────────────────────
export default async function handler(req, res) {
  // CORS — يسمح لـ Blogger بالاتصال
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // تحقق من الكاش
  const force = req.query.force === '1';
  if (!force && memCache.data && Date.now() - memCache.time < CACHE_TTL) {
    return res.status(200).json({ ...memCache.data, cached: true });
  }

  try {
    // شغّل السكرابرز بالتوازي
    const [news, specialized] = await Promise.allSettled([
      scrapeFromNews(),
      scrapeSpecialized(),
    ]);

    const scraped = {
      ...(news.status === 'fulfilled' ? news.value : {}),
      ...(specialized.status === 'fulfilled' ? specialized.value : {}),
    };

    const prices = mergeResults(scraped);
    const scrapedCount = Object.keys(scraped).length;

    const response = {
      success: true,
      cached: false,
      scrapedItems: scrapedCount,
      source: scrapedCount > 0 ? 'سكرابينج مباشر + بيانات مرجعية' : 'بيانات مرجعية',
      updatedAt: new Date().toISOString(),
      updatedAtAr: new Date().toLocaleDateString('ar-EG', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      }),
      prices,
    };

    // احفظ في الكاش
    memCache = { data: response, time: Date.now() };

    return res.status(200).json(response);

  } catch (err) {
    // في حالة الخطأ، ارجع البيانات المرجعية
    const fallback = {
      success: true,
      cached: false,
      scrapedItems: 0,
      source: 'بيانات مرجعية (خطأ في الجلب)',
      updatedAt: new Date().toISOString(),
      updatedAtAr: new Date().toLocaleDateString('ar-EG', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      }),
      prices: REFERENCE_PRICES,
    };
    return res.status(200).json(fallback);
  }
}
