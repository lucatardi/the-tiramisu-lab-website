/* ===========================================================
   The Tiramisu Lab — shared scripts
   =========================================================== */

/* ---- Config ---- */
const WHATSAPP_NUMBER = "353833311181"; // digits only, incl. country code (no +)
const CURRENCY = "€";
const LEAD_DAYS = 2;                    // minimum days' notice for collection

/* ---- Footer year (all pages) ---- */
const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

/* ---- Mobile nav toggle (all pages) ---- */
const navToggle = document.querySelector(".nav-toggle");
const navLinks = document.querySelector(".nav-links");
if (navToggle && navLinks) {
  navToggle.addEventListener("click", () => {
    const open = navLinks.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", String(open));
  });
  navLinks.addEventListener("click", (e) => {
    if (e.target.tagName === "A") {
      navLinks.classList.remove("open");
      navToggle.setAttribute("aria-expanded", "false");
    }
  });
}

/* ===========================================================
   Order & collect page
   =========================================================== */
const orderForm = document.getElementById("orderForm");

if (orderForm) {
  const money = (n) => CURRENCY + n.toFixed(2);

  const products = Array.from(document.querySelectorAll(".product")).map((el) => ({
    name: el.dataset.name,
    price: parseFloat(el.dataset.price),
    input: el.querySelector('input[type="number"]'),
  }));

  const summaryLines = document.getElementById("summaryLines");
  const summaryTotal = document.getElementById("summaryTotal");

  /* ---- Collection date: must be at least LEAD_DAYS away ----
     Note: mobile date pickers ignore `min`, so we validate on change too. */
  const dateInput = document.getElementById("date");
  const dateError = document.getElementById("dateError");
  const dateHint = document.getElementById("dateHint");

  /* Local-time yyyy-mm-dd (toISOString would shift us to UTC) */
  const localISO = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const earliest = new Date();
  earliest.setHours(0, 0, 0, 0);
  earliest.setDate(earliest.getDate() + LEAD_DAYS);
  const earliestISO = localISO(earliest);
  const earliestPretty = earliest.toLocaleDateString("en-IE", {
    weekday: "long", day: "numeric", month: "long",
  });

  if (dateInput) {
    dateInput.min = earliestISO;
    if (dateHint) {
      dateHint.textContent =
        `We need at least ${LEAD_DAYS} days’ notice — everything is made to order, so the earliest collection is ${earliestPretty}. We’ll agree the exact time when we confirm. Pick-up is in Clongriffin.`;
    }

    const validateDate = () => {
      const v = dateInput.value;
      const tooSoon = v && v < earliestISO;
      dateInput.setCustomValidity(
        tooSoon ? `Sorry — the earliest collection is ${earliestPretty}.` : ""
      );
      if (dateError) {
        dateError.hidden = !tooSoon;
        dateError.textContent = tooSoon
          ? `That’s too soon — the earliest we can do is ${earliestPretty}.`
          : "";
      }
      return !tooSoon;
    };

    dateInput.addEventListener("change", validateDate);
    dateInput.addEventListener("input", validateDate);
    orderForm.validateDate = validateDate;
  }

  /* Quantity steppers */
  document.querySelectorAll("[data-qty]").forEach((qty) => {
    const input = qty.querySelector("input");
    qty.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const step = parseInt(btn.dataset.step, 10);
        input.value = Math.max(0, Math.min(99, (parseInt(input.value, 10) || 0) + step));
        recalc();
      });
    });
    input.addEventListener("input", () => {
      let v = parseInt(input.value, 10);
      if (isNaN(v) || v < 0) v = 0;
      if (v > 99) v = 99;
      input.value = v;
      recalc();
    });
  });

  function currentItems() {
    return products
      .map((p) => {
        const qty = parseInt(p.input.value, 10) || 0;
        return { name: p.name, qty, line: qty * p.price };
      })
      .filter((i) => i.qty > 0);
  }

  /* Recalculate the summary panel */
  function recalc() {
    const items = currentItems();
    summaryLines.innerHTML = "";

    if (items.length === 0) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "Nothing added yet — pick a tiramisu to start.";
      summaryLines.appendChild(li);
    } else {
      items.forEach((i) => {
        const li = document.createElement("li");
        const left = document.createElement("span");
        left.textContent = `${i.qty} × ${i.name}`;
        const right = document.createElement("span");
        right.textContent = money(i.line);
        li.append(left, right);
        summaryLines.appendChild(li);
      });
    }

    const total = items.reduce((s, i) => s + i.line, 0);
    summaryTotal.textContent = money(total);
    return { items, total };
  }

  /* Format a yyyy-mm-dd date as something readable */
  function prettyDate(value) {
    if (!value) return "—";
    const d = new Date(value + "T00:00:00");
    if (isNaN(d)) return value;
    return d.toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long" });
  }

  /* Compose the WhatsApp order message */
  function buildMessage() {
    const { items, total } = recalc();
    const data = new FormData(orderForm);
    const lines = [];

    lines.push("Hi! I'd like to order for collection:");
    lines.push("");
    items.forEach((i) => lines.push(`• ${i.qty} × ${i.name} — ${money(i.line)}`));
    lines.push("");
    lines.push(`Total: ${money(total)}`);
    lines.push("");
    lines.push(`Collection: ${prettyDate(data.get("date"))}`);
    lines.push(`Preferred time: ${data.get("time") || "—"}`);
    lines.push("");
    lines.push(`Name: ${data.get("name") || "—"}`);
    lines.push(`Phone: ${data.get("phone") || "—"}`);
    const notes = (data.get("notes") || "").trim();
    if (notes) lines.push(`Notes: ${notes}`);
    return lines.join("\n");
  }

  /* Submit → open WhatsApp with the order ready to send */
  orderForm.addEventListener("submit", (e) => {
    e.preventDefault();

    const { items } = recalc();
    if (items.length === 0) {
      alert("Please add at least one tiramisu to your order.");
      return;
    }
    if (orderForm.validateDate) orderForm.validateDate();
    if (!orderForm.checkValidity()) {
      orderForm.reportValidity();
      return;
    }

    const msg = encodeURIComponent(buildMessage());
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`, "_blank", "noopener");
  });

  /* Initial paint */
  recalc();
}
