const { createClient } = require("@supabase/supabase-js");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    const { data: u } = await admin.auth.getUser(token);
    const user = u && u.user;
    if (!user) return res.status(401).json({ error: "Please log in first." });

    const { course_id, phone, name, email } = req.body || {};
    if (!/^01\d{9}$/.test(phone || "")) {
      return res.status(400).json({ error: "Enter a valid phone number like 01XXXXXXXXX." });
    }
    if (!name || !/^\S+@\S+\.\S+$/.test(email || "")) {
      return res.status(400).json({ error: "Enter your name and a valid email." });
    }

    // price always comes from the database, never from the browser
    const { data: course } = await admin.from("courses")
      .select("id,price,title_en").eq("id", course_id).eq("published", true).single();
    if (!course || course.price <= 0) return res.status(400).json({ error: "Course not found." });

    const { data: have } = await admin.from("enrollments")
      .select("course_id").eq("user_id", user.id).eq("course_id", course.id);
    if (have && have.length) return res.status(400).json({ error: "You already have this course." });

    const invoice = String(Date.now()) + String(Math.floor(Math.random() * 900 + 100)); // digits only
    const ins = await admin.from("payments").insert({
      user_id: user.id, course_id: course.id, method: "paystation",
      invoice_number: invoice, status: "pending"
    }).select("id").single();
    if (ins.error || !ins.data) return res.status(500).json({ error: "Could not start payment." });

    const site = process.env.SITE_URL || "https://" + req.headers.host;
    const f = new FormData();
    f.append("merchantId", process.env.PAYSTATION_MERCHANT_ID);
    f.append("password", process.env.PAYSTATION_PASSWORD);
    f.append("invoice_number", invoice);
    f.append("currency", "BDT");
    f.append("payment_amount", String(course.price));
    f.append("reference", ins.data.id);
    f.append("cust_name", String(name).slice(0, 80));
    f.append("cust_phone", phone);
    f.append("cust_email", String(email).slice(0, 120));
    f.append("callback_url", site + "/api/callback");

    const r = await fetch("https://api.paystation.com.bd/initiate-payment", { method: "POST", body: f });
    const j = await r.json();
    if (j.status !== "success" || !j.payment_url) {
      return res.status(502).json({ error: j.message || "Payment gateway error." });
    }
    return res.status(200).json({ url: j.payment_url });
  } catch (e) {
    return res.status(500).json({ error: "Server error." });
  }
};
