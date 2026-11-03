const { createClient } = require("@supabase/supabase-js");

module.exports = async (req, res) => {
  const back = (ok, why) => {
    res.setHeader("Location", ok ? "/?pay=ok#dashboard" : "/?pay=fail&why=" + encodeURIComponent(why || "x") + "#courses");
    res.status(302).end();
  };
  try {
    const invoice = req.query.invoice_number;
    if (!invoice) return back(false, "noinvoice");
    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

    // never trust the browser: ask PayStation directly if this invoice was paid
    const f = new FormData();
    f.append("invoice_number", String(invoice));
    const r = await fetch("https://api.paystation.com.bd/transaction-status", {
      method: "POST",
      headers: { merchantId: process.env.PAYSTATION_MERCHANT_ID },
      body: f
    });
    const j = await r.json();
    const d = j && j.data;
    if (!d) return back(false, "gateway-" + ((j && (j.status_code || j.message)) || "none"));

    // find our payment row: by invoice number, or by the reference we sent (our payment id)
    let { data: pay } = await admin.from("payments")
      .select("id,status,courses(price)").eq("invoice_number", String(invoice)).maybeSingle();
    if (!pay && d.reference) {
      const q = await admin.from("payments")
        .select("id,status,courses(price)").eq("id", String(d.reference)).maybeSingle();
      pay = q.data;
    }
    if (!pay) return back(false, "nopayment");
    if (pay.status === "approved") return back(true);

    const st = String(d.trx_status).toLowerCase();
    if (st !== "success") return back(false, "status-" + st);
    if (Number(d.payment_amount) < Number(pay.courses.price)) return back(false, "amount");

    // approving the payment enrolls the student (database trigger)
    const up = await admin.from("payments").update({ status: "approved", trx_id: d.trx_id })
      .eq("id", pay.id).eq("status", "pending");
    if (up.error) return back(false, "db");
    return back(true);
  } catch (e) {
    return back(false, "error");
  }
};
