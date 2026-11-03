const { createClient } = require("@supabase/supabase-js");

// Safety net: if a student paid but closed the page before coming back,
// this checks their recent pending payments with PayStation and opens the course.
module.exports = async (req, res) => {
  try {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
    const { data: u } = await admin.auth.getUser(token);
    if (!u || !u.user) return res.status(401).json({ approved: 0 });

    const since = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    const { data: pend } = await admin.from("payments")
      .select("id,invoice_number,courses(price)")
      .eq("user_id", u.user.id).eq("status", "pending").gte("created_at", since).limit(5);

    let approved = 0;
    for (const p of pend || []) {
      const f = new FormData();
      f.append("invoice_number", p.invoice_number);
      const r = await fetch("https://api.paystation.com.bd/transaction-status", {
        method: "POST",
        headers: { merchantId: process.env.PAYSTATION_MERCHANT_ID },
        body: f
      });
      const j = await r.json();
      const d = j && j.data;
      if (d && String(d.trx_status).toLowerCase() === "success" &&
          Number(d.payment_amount) >= Number(p.courses.price)) {
        const up = await admin.from("payments").update({ status: "approved", trx_id: d.trx_id })
          .eq("id", p.id).eq("status", "pending");
        if (!up.error) approved++;
      }
    }
    return res.status(200).json({ approved });
  } catch (e) {
    return res.status(200).json({ approved: 0 });
  }
};
