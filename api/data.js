/* =========================================================
   Vercel Serverless Function — proxy ke JSONBin
   Lokasi: /api/data  (otomatis tersedia di Vercel)
   Tugas: menyimpan API key di SERVER (env var), bukan di kode
   browser, supaya situs publik lo tetap aman.

   Env var yang WAJIB diisi di dashboard Vercel:
     JSONBIN_KEY     = Access Key dari jsonbin.io (X-Access-Key)
     JSONBIN_BIN_ID  = ID Bin tempat data disimpan
   ========================================================= */
export default async function handler(req, res) {
  const KEY = process.env.JSONBIN_KEY;
  const BIN = process.env.JSONBIN_BIN_ID;

  // Belum dikonfigurasi -> beri sinyal ke app supaya fallback ke LocalStorage.
  if (!KEY || !BIN) {
    res.status(200).json({ notConfigured: true });
    return;
  }

  const base = `https://api.jsonbin.io/v3/b/${BIN}`;
  const headers = { 'X-Access-Key': KEY };

  try {
    if (req.method === 'GET') {
      const r = await fetch(`${base}/latest`, { headers });
      if (!r.ok) { res.status(502).json({ error: 'jsonbin_get_failed', status: r.status }); return; }
      const j = await r.json();
      const rec = j.record;
      let transactions = [];
      let updatedAt = 0;
      if (Array.isArray(rec)) {
        transactions = rec; // bin lama: langsung array transaksi
      } else if (rec && typeof rec === 'object') {
        transactions = Array.isArray(rec.transactions) ? rec.transactions : [];
        updatedAt = rec.updatedAt || 0;
      }
      res.status(200).json({ updatedAt, transactions });
      return;
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      const payload = req.body && typeof req.body === 'object'
        ? req.body
        : { updatedAt: Date.now(), transactions: [] };
      const r = await fetch(base, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) { res.status(502).json({ error: 'jsonbin_put_failed', status: r.status }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    res.setHeader('Allow', 'GET, POST, PUT');
    res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
