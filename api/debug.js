// ============================================================
//  Debug endpoint — ضعه كـ api/debug.js على GitHub مؤقتاً
// ============================================================
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const SOURCE_URL = 'https://theprice1.com/%D8%A3%D8%B3%D8%B9%D8%A7%D8%B1-%D9%85%D9%88%D8%A7%D8%AF-%D8%A7%D9%84%D8%A8%D9%86%D8%A7%D8%A1-%D8%A7%D9%84%D9%8A%D9%88%D9%85/';
  
  try {
    const r = await fetch(SOURCE_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' },
      signal: AbortSignal.timeout(12000),
    });
    const html = await r.text();
    
    // عدّ الجداول وخذ أول 200 حرف من كل جدول
    const tables = [];
    let pos = 0, idx = 0;
    while (true) {
      const s = html.indexOf('<table', pos);
      if (s === -1) break;
      const e = html.indexOf('</table>', s) + 8;
      tables.push({
        index: idx,
        preview: html.substring(s, Math.min(s+300, e)).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()
      });
      pos = e; idx++;
      if (idx > 10) break;
    }
    
    // ابحث عن anchors
    const anchors = [
      'أسعار طن حديد البناء اليوم',
      'أسعار طن أسمنت البناء اليوم', 
      'أسعار السن والظلط اليوم',
      'أسعار متر الرمل اليوم',
      'أسعار الطوب الأحمر اليوم',
      'أسعار الطوب الأبيض اليوم',
    ];
    
    const found = {};
    for (const a of anchors) {
      const i = html.indexOf(a);
      if (i !== -1) {
        const tStart = html.indexOf('<table', i);
        found[a] = { anchorPos: i, tablePos: tStart, distance: tStart - i };
      } else {
        found[a] = 'NOT FOUND';
      }
    }
    
    return res.status(200).json({
      totalTables: tables.length,
      tables,
      anchors: found,
      htmlLength: html.length,
    });
    
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
