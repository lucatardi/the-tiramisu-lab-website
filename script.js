/* ===========================================================
   The Tiramisu Lab — shared scripts
   =========================================================== */

/* ---- Config ---- */
const WHATSAPP_NUMBER = "353833311181"; // digits only, incl. country code (no +)
const CURRENCY = "€";

/* Point this at your deployed Cloudflare Worker to switch the order
   page over to on-site Stripe payment (card / Apple Pay / Google Pay).
   While it's empty the site keeps the original WhatsApp flow, so
   nothing breaks until the Worker is live.
   e.g. "https://tiramisu-lab.<your-subdomain>.workers.dev"          */
const CHECKOUT_API = "";

/* Minimum days' notice for collection.
   After the evening cut-off it's too late to start prep for a collection
   two days out, so the earliest jumps from 2 days to 3 days ahead. */
const ORDER_CUTOFF_HOUR = 20; // 8pm
const LEAD_DAYS = new Date().getHours() >= ORDER_CUTOFF_HOUR ? 3 : 2;

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

/* ---- Night mode: the baker (and the kitchen) is asleep ---- */
const NIGHT_START = 23; // 11pm
const NIGHT_END = 7; // 7am
const isNight = (() => {
  const h = new Date().getHours();
  return h >= NIGHT_START || h < NIGHT_END;
})();
if (orderForm && isNight) {
  orderForm.hidden = true;
  orderForm.style.display = "none"; // beats .order-layout { display: grid }
  const nc = document.getElementById("nightClosed");
  if (nc) nc.hidden = false;
}

if (orderForm && !isNight) {
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
      label: "Daytime", times: ["09:00", "18:00"], human: "9am or 6pm",
      where: "St Stephen’s Green, D2",
    },
    evening: {
      label: "Evening", times: ["21:00", "22:00"], human: "9pm or 10pm",
      where: "Clongriffin, D13",
    },
  };

  const dateInput = document.getElementById("date");
  const timeToggle = document.getElementById("timeToggle");
  const dateError = document.getElementById("dateError");
  const timeError = document.getElementById("timeError");
  const soldOutNotice = document.getElementById("soldOutNotice");
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

  /* ---- Sold-out dates (holidays / already full) ----
     Loaded from sold-out-dates.txt so they can be edited on GitHub without a deploy. */
  const soldOutDates = new Set();
  const soldOutRanges = [];
  const isSoldOut = (iso) =>
    soldOutDates.has(iso) || soldOutRanges.some(([a, b]) => iso >= a && iso <= b);

  async function loadSoldOutDates() {
    try {
      const res = await fetch("sold-out-dates.txt?t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return;
      const text = await res.text();
      soldOutDates.clear();
      soldOutRanges.length = 0;
      /* File uses DD-MM-YYYY; convert to YYYY-MM-DD internally for comparison */
      const toISO = (dmy) => {
        const [d, m, y] = dmy.split("-");
        return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
      };
      const D = "\\d{1,2}-\\d{1,2}-\\d{4}";
      const rangeRe = new RegExp(`^(${D})\\s*\\.\\.\\s*(${D})$`);
      const singleRe = new RegExp(`^(${D})$`);
      text.split(/\r?\n/).forEach((raw) => {
        const line = raw.trim();
        if (!line || line.startsWith("#")) return;
        const range = line.match(rangeRe);
        const single = line.match(singleRe);
        if (range) soldOutRanges.push([toISO(range[1]), toISO(range[2])].sort());
        else if (single) soldOutDates.add(toISO(single[1]));
        /* anything else (a typo) is ignored so the picker never breaks */
      });
    } catch (e) {
      /* fail open — if the list can't load, keep every date available */
    }
  }

  /* Days already at capacity (20 pots), from the Worker's counter.
     Returned as YYYY-MM-DD, so they drop straight into the same set
     and render as "Sold out" exactly like the manual list. */
  async function loadFullDates() {
    if (!CHECKOUT_API) return;
    try {
      const res = await fetch(CHECKOUT_API + "/full-dates", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      (data.full || []).forEach((iso) => soldOutDates.add(iso));
    } catch (e) {
      /* fail open */
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
      } else if (isSoldOut(v)) {
        msg = "That date is sold out — please pick another.";
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
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const ampm = h < 12 ? "am" : "pm";
    return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
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

  /* Show every weekday from tomorrow up to the two-week horizon.
     Days that are sold out OR too soon (inside the lead time) are shown
     but disabled and labelled "Sold out", so people can see they're taken. */
  function fillDates() {
    if (!dateInput) return;
    const keep = dateInput.value;
    const opts = [];
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 1); // start from tomorrow
    while (localISO(d) <= latestISO) {
      const iso = localISO(d);
      if (!isWeekend(d)) {
        const soldOut = iso < earliestISO || isSoldOut(iso);
        opts.push({ value: iso, label: prettyDate(iso), soldOut });
      }
      d.setDate(d.getDate() + 1);
    }
    dateInput.innerHTML =
      '<option value="">Choose a date…</option>' +
      opts
        .map((o) =>
          o.soldOut
            ? `<option value="${o.value}" disabled>${o.label} — Sold out</option>`
            : `<option value="${o.value}">${o.label}</option>`
        )
        .join("");
    /* Keep the selection only if it's still available (not sold out) */
    dateInput.value = opts.some((o) => o.value === keep && !o.soldOut) ? keep : "";

    const anyAvailable = opts.some((o) => !o.soldOut);
    if (soldOutNotice) soldOutNotice.hidden = anyAvailable;
    if (submitBtn) submitBtn.disabled = !anyAvailable;
  }

  function fillTimes() {
    if (!timeToggle) return;
    const keep = selectedTime();
    const times = slotTimes(currentSlot());
    /* If there's only one time, pre-select it so there's nothing to tap */
    const preselect = times.length === 1 ? times[0].value : keep;
    timeToggle.innerHTML = times
      .map((t) => {
        const on = t.value === preselect;
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

  /* Pull in the sold-out dates + any full days, then rebuild the picker */
  Promise.all([loadSoldOutDates(), loadFullDates()]).then(fillDates);

  /* In Stripe mode, relabel the primary action + reassure about payment */
  if (CHECKOUT_API) {
    if (submitBtn) submitBtn.textContent = "Continue to secure payment";
    const note = document.getElementById("submitNote");
    if (note)
      note.textContent =
        "You’ll pay securely by card, Apple Pay or Google Pay. We’ll email your confirmation and the exact collection spot right after.";
    const slotHint = document.querySelector(".slot-options + .hint");
    if (slotHint)
      slotHint.textContent =
        "We’ll send the exact meeting point in your confirmation, right after payment.";
  }

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
    lines.push("");
    lines.push(`Name: ${(data.get("name") || "").trim() || "—"}`);
    return lines.join("\n");
  }

  /* ---- Checkout helpers (Stripe mode) ---- */
  const checkoutError = document.getElementById("checkoutError");
  const setCheckoutError = (msg) => {
    if (!checkoutError) return;
    checkoutError.hidden = !msg;
    checkoutError.textContent = msg || "";
  };
  const savedLabel = submitBtn ? submitBtn.textContent : "";
  const setBusy = (b) => {
    if (!submitBtn) return;
    submitBtn.disabled = b;
    submitBtn.textContent = b ? "Redirecting…" : savedLabel;
  };

  async function startCheckout(items) {
    const data = new FormData(orderForm);
    const payload = {
      items: items.map((i) => ({ id: i.name.toLowerCase(), qty: i.qty })),
      date: data.get("date"),
      dateLabel: prettyDate(data.get("date")),
      time: selectedTimeLabel(),
      slot: (slotInputs.find((r) => r.checked) || {}).value || "daytime",
      name: (data.get("name") || "").trim(),
    };
    setCheckoutError("");
    setBusy(true);
    try {
      const res = await fetch(CHECKOUT_API + "/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 409) {
        setBusy(false);
        setCheckoutError("Sorry — that date just sold out. Please pick another.");
        loadFullDates().then(fillDates);
        return;
      }
      if (!res.ok) throw new Error("checkout failed");
      const { url } = await res.json();
      if (!url) throw new Error("no url");
      window.location = url; // → Stripe hosted checkout
    } catch (err) {
      setBusy(false);
      setCheckoutError(
        "Something went wrong starting checkout. Please try again, or message us on Instagram."
      );
    }
  }

  /* Submit → Stripe checkout if configured, else WhatsApp */
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

    if (CHECKOUT_API) {
      startCheckout(items);
      return;
    }

    /* Fallback: open WhatsApp with the order ready to send */
    const msg = encodeURIComponent(buildMessage());
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`, "_blank", "noopener");
  });

  /* Initial paint */
  recalc();
}

/* ===========================================================
   Thank-you page — reveal the paid order + collection spot
   =========================================================== */
(function () {
  const ty = document.getElementById("thankyou");
  if (!ty) return;

  const showTy = (id) =>
    ["tyLoading", "tyPaid", "tyError"].forEach((x) => {
      const el = document.getElementById(x);
      if (el) el.hidden = x !== id;
    });
  const setText = (id, t) => {
    const el = document.getElementById(id);
    if (el) el.textContent = t;
  };

  const sessionId = new URLSearchParams(location.search).get("session_id");
  if (!CHECKOUT_API || !sessionId) return showTy("tyError");

  fetch(CHECKOUT_API + "/session?id=" + encodeURIComponent(sessionId), {
    cache: "no-store",
  })
    .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
    .then(({ ok, data }) => {
      if (!ok || !data.paid) return showTy("tyError");
      setText("tyItems", data.items || "—");
      setText(
        "tyTotal",
        data.total != null ? "€" + Number(data.total).toFixed(2) : "—"
      );
      setText(
        "tyWhen",
        (data.dateLabel || "—") + (data.time ? " at " + data.time : "")
      );
      setText("tyWhere", data.where || "—");
      if (data.name)
        setText(
          "tyHeading",
          "Grazie, " + data.name.split(" ")[0] + "! Your tiramisu is booked."
        );
      showTy("tyPaid");
    })
    .catch(() => showTy("tyError"));
})();
