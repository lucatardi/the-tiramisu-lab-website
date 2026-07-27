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
      label: "Daytime", times: ["10:00", "17:00"], human: "10am or 5pm",
      where: "St Stephen’s Green, D2",
    },
    evening: {
      label: "Evening", times: ["20:00", "22:00"], human: "8pm or 10pm",
      where: "Clongriffin, D13",
    },
  };

  const dateInput = document.getElementById("date");
  const timeToggle = document.getElementById("timeToggle");
  const dateError = document.getElementById("dateError");
  const timeError = document.getElementById("timeError");
  const closedNotice = document.getElementById("closedNotice");
  const submitBtn = orderForm.querySelector('button[type="submit"]');
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

  /* Latest = no collections more than two weeks (14 days) ahead */
  const HORIZON_DAYS = 14;
  const latest = new Date();
  latest.setHours(0, 0, 0, 0);
  latest.setDate(latest.getDate() + HORIZON_DAYS);
  const latestISO = localISO(latest);

  /* ---- Dates we've closed (holidays / already full) ----
     Loaded from closed-dates.txt so they can be edited on GitHub without a deploy. */
  const closedDates = new Set();
  const closedRanges = [];
  const isClosed = (iso) =>
    closedDates.has(iso) || closedRanges.some(([a, b]) => iso >= a && iso <= b);

  async function loadClosedDates() {
    try {
      const res = await fetch("closed-dates.txt?t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return;
      const text = await res.text();
      closedDates.clear();
      closedRanges.length = 0;
      text.split(/\r?\n/).forEach((raw) => {
        const line = raw.trim();
        if (!line || line.startsWith("#")) return;
        const range = line.match(/^(\d{4}-\d{2}-\d{2})\s*\.\.\s*(\d{4}-\d{2}-\d{2})$/);
        const single = line.match(/^(\d{4}-\d{2}-\d{2})$/);
        if (range) closedRanges.push([range[1], range[2]].sort());
        else if (single) closedDates.add(single[1]);
        /* anything else (a typo) is ignored so the picker never breaks */
      });
    } catch (e) {
      /* fail open — if the list can't load, keep every date available */
    }
  }

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
      } else if (v > latestISO) {
        msg = "That’s too far ahead — please pick a date within the next two weeks.";
      } else if (isWeekend(new Date(v + "T00:00:00"))) {
        msg = "We only do collections Monday to Friday.";
      } else if (isClosed(v)) {
        msg = "Sorry, that date isn’t available — please pick another.";
      }
    }
    dateInput.setCustomValidity(msg);
    showError(dateError, msg);
    return !msg;
  }

  /* ---- Times: only the specific slots we offer ---- */
  const toMinutes = (hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const toLabel = (mins) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
  };
  const slotTimes = (slot) =>
    (slot.times || []).map((v) => ({ value: v, label: toLabel(toMinutes(v)) }));

  const selectedTime = () => {
    const r = orderForm.querySelector('input[name="time"]:checked');
    return r ? r.value : "";
  };
  const selectedTimeLabel = () => {
    const r = orderForm.querySelector('input[name="time"]:checked');
    return r ? r.dataset.label : "";
  };

  /* Offer weekdays that aren't closed, from the earliest allowed day up to the two-week horizon */
  function fillDates() {
    if (!dateInput) return;
    const keep = dateInput.value;
    const days = [];
    const d = new Date(earliest);
    while (localISO(d) <= latestISO) {
      const iso = localISO(d);
      if (!isWeekend(d) && !isClosed(iso)) days.push(iso);
      d.setDate(d.getDate() + 1);
    }
    if (days.length) {
      dateInput.innerHTML =
        '<option value="">Choose a date…</option>' +
        days.map((v) => `<option value="${v}">${prettyDate(v)}</option>`).join("");
      dateInput.value = days.includes(keep) ? keep : "";
    } else {
      dateInput.innerHTML = '<option value="">No dates available</option>';
      dateInput.value = "";
    }
    const noneAvailable = days.length === 0;
    if (closedNotice) closedNotice.hidden = !noneAvailable;
    if (submitBtn) submitBtn.disabled = noneAvailable;
  }

  function fillTimes() {
    if (!timeToggle) return;
    const keep = selectedTime();
    const times = slotTimes(currentSlot());
    timeToggle.innerHTML = times
      .map((t) => {
        const on = t.value === keep;
        return `<label class="time-opt${on ? " on" : ""}">
            <input type="radio" name="time" value="${t.value}" data-label="${t.label}"${on ? " checked" : ""} />
            <span>${t.label}</span>
          </label>`;
      })
      .join("");
  }

  function validateTime(reveal) {
    const has = !!selectedTime();
    showError(timeError, has || !reveal ? "" : "Please choose a time.");
    return has;
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
  if (timeToggle) {
    timeToggle.addEventListener("change", () => {
      timeToggle.querySelectorAll(".time-opt").forEach((l) =>
        l.classList.toggle("on", l.querySelector("input").checked)
      );
      validateTime();
    });
  }
  slotInputs.forEach((r) => r.addEventListener("change", syncSlot));
  syncSlot();

  /* Pull in the closed dates, then rebuild the picker without them */
  loadClosedDates().then(fillDates);

  orderForm.validateCollection = () => {
    const okDate = validateDate();
    const okTime = validateTime(true);
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
    const timeLabel = selectedTimeLabel() || "—";
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
    const okCollection = orderForm.validateCollection ? orderForm.validateCollection() : true;
    if (!orderForm.checkValidity()) {
      orderForm.reportValidity();
      return;
    }
    if (!okCollection) return;

    const msg = encodeURIComponent(buildMessage());
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`, "_blank", "noopener");
  });

  /* Initial paint */
  recalc();
}
