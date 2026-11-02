const { createClient } = require("@supabase/supabase-js");

module.exports = async (req, res) => {
  const back = (ok) => {
    res.setHeader("Location", ok ? "/?pay=ok#dashboard" : "/?pay=fail#courses");
    res.status(302).end();
  };
  try {
    const invoice = req.query.invoice_number;
    if (!invoice) return back(false);
    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

    const { data: pay } = await admin.from("payments")
      .select("id,status,courses(price)").eq("invoice_number", invoice).single();
    if (!pay) return back(false);
    if (pay.status === "approved") return back(true);

    // never trust the browser: ask PayStation directly if this invoice was paid
    const f = new FormData();
    f.append("invoice_number", invoice);
    const r = await fetch("https://api.paystation.com.bd/transaction-status", {
      method: "POST",
      headers: { merchantId: process.env.PAYSTATION_MERCHANT_ID },
      body: f
    });
    const j = await r.json();
    const d = j && j.data;
    const paid = d && String(d.trx_status).toLowerCase() === "success" &&
      Number(d.payment_amount) >= Number(pay.courses.price);
    if (!paid) return back(false);

    // approving the payment enrolls the student (database trigger)
    await admin.from("payments").update({ status: "approved", trx_id: d.trx_id })
      .eq("id", pay.id).eq("status", "pending");
    return back(true);
  } catch (e) {
    return back(false);
  }
};
