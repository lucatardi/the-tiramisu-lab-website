/* ===========================================================
   The Tiramisu Lab — shared scripts
   =========================================================== */

/* ---- Config: where order requests go ----
   Replace these with your real details. */
const ORDER_EMAIL = "hello@thetiramisulab.com";   // TODO: your inbox
const WHATSAPP_NUMBER = "10000000000";            // TODO: digits only, incl. country code (no +)
const CURRENCY = "€";

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
   Order page logic
   =========================================================== */
const orderForm = document.getElementById("orderForm");

if (orderForm) {
  const money = (n) => CURRENCY + n.toFixed(2);

  const products = Array.from(document.querySelectorAll(".product")).map((el) => ({
    el,
    name: el.dataset.name,
    price: parseFloat(el.dataset.price),
    input: el.querySelector('input[type="number"]'),
  }));

  const summaryLines = document.getElementById("summaryLines");
  const summaryTotal = document.getElementById("summaryTotal");
  const waLink = document.getElementById("waLink");

  /* Set the date picker minimum to tomorrow (24h ahead) */
  const dateInput = document.getElementById("date");
  if (dateInput) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    dateInput.min = tomorrow.toISOString().split("T")[0];
  }

  /* Quantity steppers */
  document.querySelectorAll("[data-qty]").forEach((qty) => {
    const input = qty.querySelector("input");
    qty.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const step = parseInt(btn.dataset.step, 10);
        const next = Math.max(0, Math.min(99, (parseInt(input.value, 10) || 0) + step));
        input.value = next;
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

  /* Build the current order as a list of {name, qty, price, line} */
  function currentItems() {
    return products
      .map((p) => {
        const qty = parseInt(p.input.value, 10) || 0;
        return { name: p.name, qty, price: p.price, line: qty * p.price };
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

  /* Compose a human-readable order message */
  function buildMessage() {
    const { items, total } = recalc();
    const data = new FormData(orderForm);
    const lines = [];

    lines.push("New tiramisu order request");
    lines.push("");
    items.forEach((i) => lines.push(`• ${i.qty} × ${i.name} — ${money(i.line)}`));
    lines.push("");
    lines.push(`Total: ${money(total)}`);
    lines.push("");
    lines.push(`Collection date: ${data.get("date") || "—"}`);
    lines.push(`Preferred time:  ${data.get("time") || "—"}`);
    lines.push("");
    lines.push(`Name:  ${data.get("name") || "—"}`);
    lines.push(`Phone: ${data.get("phone") || "—"}`);
    lines.push(`Email: ${data.get("email") || "—"}`);
    const notes = (data.get("notes") || "").trim();
    if (notes) {
      lines.push("");
      lines.push(`Notes: ${notes}`);
    }
    return lines.join("\n");
  }

  /* Keep the WhatsApp link in sync */
  function syncWhatsApp() {
    const msg = encodeURIComponent(buildMessage());
    waLink.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`;
  }
  orderForm.addEventListener("input", syncWhatsApp);

  /* Submit → open email client with the prefilled order */
  orderForm.addEventListener("submit", (e) => {
    e.preventDefault();

    const { items, total } = recalc();
    if (items.length === 0) {
      alert("Please add at least one tiramisu to your order.");
      return;
    }
    if (!orderForm.checkValidity()) {
      orderForm.reportValidity();
      return;
    }

    const subject = encodeURIComponent("Tiramisu order request — collection");
    const body = encodeURIComponent(buildMessage());
    window.location.href = `mailto:${ORDER_EMAIL}?subject=${subject}&body=${body}`;
  });

  /* Initial paint */
  recalc();
  syncWhatsApp();
}
