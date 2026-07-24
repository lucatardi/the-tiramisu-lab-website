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

/* ---- Flavour flip cards (home page) ----
   Flips only on tap/click or keyboard (Enter/Space) — never on hover. */
(function () {
  const cards = document.querySelectorAll(".flavour-card");
  if (!cards.length) return;
  cards.forEach((card) => {
    const toggle = () => card.classList.toggle("flipped");
    card.addEventListener("click", toggle);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
  });
})();

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

  /* ---- Collection: weekdays only, LEAD_DAYS notice, location depends on slot ----
     Mobile date/time pickers ignore min/max, so we validate on change too. */
  const SLOTS = {
    daytime: {
      label: "Daytime", from: "09:00", to: "18:00", human: "9–11am and 2–6pm",
      exclude: [["11:30", "13:30"]], // not available over lunch
      where: "St Stephen’s Green, D2",
    },
    evening: {
      label: "Evening", from: "20:00", to: "23:00", human: "8pm–11pm",
      where: "Clongriffin, D13",
    },
  };

  const dateInput = document.getElementById("date");
  const timeInput = document.getElementById("time");
  const dateError = document.getElementById("dateError");
  const timeError = document.getElementById("timeError");
  const slotInputs = Array.from(document.querySelectorAll('input[name="slot"]'));

  /* Local-time yyyy-mm-dd (toISOString would shift us to UTC) */
  const localISO = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

  /* Earliest = LEAD_DAYS away, rolled forward past the weekend */
  const earliest = new Date();
  earliest.setHours(0, 0, 0, 0);
  earliest.setDate(earliest.getDate() + LEAD_DAYS);
  while (isWeekend(earliest)) earliest.setDate(earliest.getDate() + 1);
  const earliestISO = localISO(earliest);

  const currentSlot = () =>
    SLOTS[(slotInputs.find((r) => r.checked) || {}).value] || SLOTS.daytime;

  const showError = (el, msg) => {
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || "";
  };

  function validateDate() {
    if (!dateInput) return true;
    const v = dateInput.value;
    let msg = "";
    if (v) {
      if (v < earliestISO) {
        msg = `That’s too soon — the earliest we can do is ${prettyDate(earliestISO)}.`;
      } else if (isWeekend(new Date(v + "T00:00:00"))) {
        msg = "We only do collections Monday to Friday.";
      }
    }
    dateInput.setCustomValidity(msg);
    showError(dateError, msg);
    return !msg;
  }

  /* ---- Times: only the ones inside the chosen slot are offered ---- */
  const TIME_STEP_MIN = 30;
  const toMinutes = (hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const toValue = (mins) =>
    `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  const toLabel = (mins) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
  };
  const slotTimes = (slot) => {
    const blocked = (mins) =>
      (slot.exclude || []).some(([a, b]) => mins >= toMinutes(a) && mins <= toMinutes(b));
    const out = [];
    for (let m = toMinutes(slot.from); m <= toMinutes(slot.to); m += TIME_STEP_MIN) {
      if (!blocked(m)) out.push({ value: toValue(m), label: toLabel(m) });
    }
    return out;
  };

  /* Only offer weekdays, starting from the earliest allowed day */
  const DATE_CHOICES = 20; // roughly four working weeks
  function fillDates() {
    if (!dateInput) return;
    const keep = dateInput.value;
    const days = [];
    const d = new Date(earliest);
    while (days.length < DATE_CHOICES) {
      if (!isWeekend(d)) days.push(localISO(d));
      d.setDate(d.getDate() + 1);
    }
    dateInput.innerHTML =
      '<option value="">Choose a date…</option>' +
      days.map((v) => `<option value="${v}">${prettyDate(v)}</option>`).join("");
    dateInput.value = days.includes(keep) ? keep : "";
  }

  function fillTimes() {
    if (!timeInput) return;
    const keep = timeInput.value;
    const times = slotTimes(currentSlot());
    timeInput.innerHTML =
      '<option value="">Choose a time…</option>' +
      times.map((t) => `<option value="${t.value}">${t.label}</option>`).join("");
    /* Keep the selection only if it's still valid for this slot */
    timeInput.value = times.some((t) => t.value === keep) ? keep : "";
  }

  function validateTime() {
    if (!timeInput) return true;
    const slot = currentSlot();
    const v = timeInput.value;
    const msg =
      v && !slotTimes(slot).some((t) => t.value === v)
        ? `${slot.label} collection is ${slot.human} — please choose a time from the list.`
        : "";
    timeInput.setCustomValidity(msg);
    showError(timeError, msg);
    return !msg;
  }

  function syncSlot() {
    slotInputs.forEach((r) => {
      const card = r.closest(".slot");
      if (card) card.classList.toggle("slot--on", r.checked);
    });
    fillTimes();
    validateTime();
  }

  if (dateInput) {
    fillDates();
    dateInput.addEventListener("change", validateDate);
  }
  if (timeInput) {
    timeInput.addEventListener("change", validateTime);
    timeInput.addEventListener("input", validateTime);
  }
  slotInputs.forEach((r) => r.addEventListener("change", syncSlot));
  syncSlot();

  orderForm.validateCollection = () => {
    const okDate = validateDate();
    const okTime = validateTime();
    return okDate && okTime;
  };

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
    const timeLabel =
      (timeInput && timeInput.selectedOptions[0] && timeInput.value
        ? timeInput.selectedOptions[0].text
        : data.get("time")) || "—";
    lines.push(`Collection: ${prettyDate(data.get("date"))} at ${timeLabel}`);
    lines.push(`Pick-up: ${currentSlot().where}`);
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
    if (orderForm.validateCollection) orderForm.validateCollection();
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
