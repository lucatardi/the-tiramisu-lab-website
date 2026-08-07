/* ===========================================================
   The Tiramisu Lab — shared scripts
   =========================================================== */

/* ---- Config ---- */
const WHATSAPP_NUMBER = "353899525318"; // digits only, incl. country code (no +)
const CURRENCY = "€";

/* Point this at your deployed Cloudflare Worker to switch the order
   page over to on-site Stripe payment (card / Apple Pay / Google Pay).
   While it's empty the site keeps the original WhatsApp flow, so
   nothing breaks until the Worker is live.
   e.g. "https://tiramisu-lab.<your-subdomain>.workers.dev"          */
const CHECKOUT_API = "https://tiramisu-lab.thetiramisulab.workers.dev";

/* Direct Google "write a review" link (opens the star dialog).
   Kept here for later — the QR review banner is currently removed. */
const REVIEW_URL = "https://g.page/r/CcqYdAoQnAT0EAE/review";

/* Minimum days' notice for collection.
   After the evening cut-off it's too late to start prep for a collection
   two days out, so the earliest jumps from 2 days to 3 days ahead.
   The cut-off is measured in Dublin time, not the visitor's own timezone. */
const ORDER_CUTOFF_HOUR = 18; // 6pm Dublin time

/* Current hour (0–23) in Dublin, whatever timezone the visitor is in. */
function dublinHour() {
  const h = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Dublin",
    hour: "numeric",
    hourCycle: "h23",
  }).format(new Date());
  return parseInt(h, 10) || 0;
}
const LEAD_DAYS = dublinHour() >= ORDER_CUTOFF_HOUR ? 3 : 2;

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
  const capNote = document.getElementById("capNote");
  const flavourCap = document.getElementById("flavourCap");

  /* Most pots we'll take in one order — bigger jobs go through WhatsApp. */
  const MAX_ORDER = 20;
  /* Pots currently in the cart, optionally ignoring one input (the one
     being edited), so we can work out how much room is left. */
  const cartQty = (except) =>
    products.reduce(
      (s, p) => s + (p.input === except ? 0 : parseInt(p.input.value, 10) || 0),
      0
    );

  /* ---- Collection: weekdays only, LEAD_DAYS notice, location depends on slot ----
     Mobile date/time pickers ignore min/max, so we validate on change too. */
  const SLOTS = {
    daytime: {
      label: "Daytime", times: ["09:00", "13:30", "18:00"], human: "9am, 1:30pm or 6pm",
      where: "St Stephen’s Green, D2",
    },
    evening: {
      label: "Evening", times: ["21:00", "21:30", "22:00"], human: "9pm, 9:30pm or 10pm",
      where: "Clongriffin, D13",
    },
  };

  const dateInput = document.getElementById("date"); // hidden input holding the chosen ISO date
  const dateList = document.getElementById("dateList"); // card list container
  const cartNote = document.getElementById("cartNote");
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

  /* Weekdays we never collect on — shown as "Sold out" in the picker.
     Day numbers: 0=Sun, 1=Mon … 6=Sat. Currently: Mondays off. */
  const CLOSED_WEEKDAYS = new Set([1]);
  const isClosedDay = (d) => CLOSED_WEEKDAYS.has(d.getDay());

  /* Earliest = LEAD_DAYS away, rolled forward past the weekend */
  const earliest = new Date();
  earliest.setHours(0, 0, 0, 0);
  earliest.setDate(earliest.getDate() + LEAD_DAYS);
  while (isWeekend(earliest)) earliest.setDate(earliest.getDate() + 1);
  const earliestISO = localISO(earliest);

  /* No fixed booking window — the picker simply shows the next DATE_CARDS
     available dates, however far out they fall. This is only a safety cap so
     the search always terminates (e.g. if almost everything is booked). */
  const HORIZON_DAYS = 120;
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

  /* Pots still available per day, from the Worker. `dailyCap` is the per-day
     limit; `capLeft[iso]` holds the remaining pots for any day with orders
     (untouched days default to the full cap). */
  let dailyCap = null;
  const capLeft = {};
  /* Show "Only N left" once a day drops below this many pots. */
  const LOW_STOCK_AT = 5;
  /* How many date cards to show at once (the soonest available ones). */
  const DATE_CARDS = 5;
  const potsLeft = (iso) => {
    if (dailyCap == null) return null; // capacity unknown → don't restrict
    return capLeft[iso] != null ? capLeft[iso] : dailyCap;
  };

  /* How many pots this order can still add: the smaller of our per-order cap
     and whatever's left on the chosen day. With no day picked yet (or no
     capacity data), only the per-order cap applies. */
  const selectedISO = () => (dateInput && dateInput.value) || "";
  function orderLimit() {
    const left = selectedISO() ? potsLeft(selectedISO()) : null;
    if (left != null && left < MAX_ORDER) return { limit: left, reason: "day" };
    return { limit: MAX_ORDER, reason: "max" };
  }
  /* Trim the cart down so it never exceeds `limit` (used when the day changes
     to one with less room). Reduces from the last flavour upward. */
  function clampCart() {
    let over = cartQty() - orderLimit().limit;
    if (over <= 0) return false;
    for (let i = products.length - 1; i >= 0 && over > 0; i--) {
      const inp = products[i].input;
      const v = parseInt(inp.value, 10) || 0;
      const cut = Math.min(v, over);
      if (cut) {
        inp.value = v - cut;
        over -= cut;
      }
    }
    return true;
  }

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
      if (typeof data.cap === "number") dailyCap = data.cap;
      if (data.left) Object.assign(capLeft, data.left);
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

  /* `reveal` = show a "please choose a date" error when nothing is picked.
     We validate manually because the date now lives in a hidden input. */
  function validateDate(reveal) {
    if (!dateInput) return true;
    const v = dateInput.value;
    let msg = "";
    if (v) {
      if (v < earliestISO) {
        msg = `That’s too soon — the earliest we can do is ${prettyDate(earliestISO)}.`;
      } else if (isWeekend(new Date(v + "T00:00:00"))) {
        msg = "We only do collections Tuesday to Friday.";
      } else if (isSoldOut(v) || isClosedDay(new Date(v + "T00:00:00"))) {
        msg = "That date is sold out — please pick another.";
      }
    } else if (reveal) {
      msg = "Please choose a date.";
    }
    showError(dateError, msg);
    return !!v && !msg;
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

  /* Render the soonest DATE_CARDS available dates as a card list.
     "Available" = a weekday we open, past the lead time, not manually closed,
     and with pots left. Days that can't fit the current order still appear,
     but disabled with an explanation. Everything else is simply not shown. */
  function fillDates() {
    if (!dateInput || !dateList) return;
    const keep = dateInput.value;
    const need = cartQty();

    const cards = [];
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 1); // from tomorrow
    while (localISO(d) <= latestISO && cards.length < DATE_CARDS) {
      const iso = localISO(d);
      if (!isWeekend(d) && !isClosedDay(d)) {
        const tooSoon = iso < earliestISO;
        const manual = isSoldOut(iso); // includes worker "full" days
        const left = tooSoon || manual ? null : potsLeft(iso);
        const full = left != null && left <= 0;
        if (!tooSoon && !manual && !full) cards.push({ iso, left });
      }
      d.setDate(d.getDate() + 1);
    }

    const fits = (c) => !(c.left != null && need > c.left);

    dateList.innerHTML = cards
      .map((c) => {
        const dd = new Date(c.iso + "T00:00:00");
        const wd = dd.toLocaleDateString("en-IE", { weekday: "long" });
        const rest = dd.toLocaleDateString("en-IE", { day: "numeric", month: "long" });
        const notEnough = !fits(c);
        const selected = c.iso === keep && !notEnough;
        let right;
        if (notEnough) right = `<span class="pill gone">${c.left} left · need ${need}</span>`;
        else if (c.left != null && c.left < LOW_STOCK_AT)
          right = `<span class="pill ${c.left <= 2 ? "tight" : "low"}">Only ${c.left} left</span>`;
        else right = `<span class="chev" aria-hidden="true">›</span>`;
        return `<button type="button" class="datecard${selected ? " sel" : ""}${
          notEnough ? " off" : ""
        }" data-iso="${c.iso}"${notEnough ? " disabled" : ""} role="radio" aria-checked="${
          selected ? "true" : "false"
        }">
            <span class="radio" aria-hidden="true"></span>
            <span class="dc-main"><span class="dc-day">${wd}</span><span class="dc-date">${rest}</span></span>
            <span class="dc-right">${right}</span>
          </button>`;
      })
      .join("");

    /* Drop the selection if the chosen day disappeared or no longer fits. */
    if (!cards.some((c) => c.iso === keep && fits(c))) dateInput.value = "";

    /* Order-aware banner: only when the cart can't fit one of the shown days. */
    if (cartNote) {
      const anyTight = need > 0 && cards.some((c) => !fits(c));
      cartNote.hidden = !anyTight;
      if (anyTight)
        cartNote.innerHTML = `You’ve picked <strong>${need} pot${
          need === 1 ? "" : "s"
        }</strong> — dates that can’t fit are marked below.`;
    }

    if (soldOutNotice) soldOutNotice.hidden = cards.length > 0;
    if (submitBtn) submitBtn.disabled = !cards.some(fits);
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

  if (dateInput && dateList) {
    fillDates();
    dateList.addEventListener("click", (e) => {
      const card = e.target.closest(".datecard");
      if (!card || card.disabled || !card.dataset.iso) return;
      dateInput.value = card.dataset.iso;
      validateDate(true);
      clampCart(); // trim the order if the new day has less room
      recalc(); // re-renders the cards (selection) + summary
    });
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
    const okDate = validateDate(true);
    const okTime = validateTime(true);
    return okDate && okTime;
  };

  /* Quantity steppers */
  document.querySelectorAll("[data-qty]").forEach((qty) => {
    const input = qty.querySelector("input");
    qty.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const step = parseInt(btn.dataset.step, 10);
        const room = orderLimit().limit - cartQty(input); // room left for this flavour
        input.value = Math.max(0, Math.min(room, (parseInt(input.value, 10) || 0) + step));
        recalc();
      });
    });
    input.addEventListener("input", () => {
      let v = parseInt(input.value, 10);
      if (isNaN(v) || v < 0) v = 0;
      const room = orderLimit().limit - cartQty(input); // room left for this flavour
      if (v > room) v = room;
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

    /* Cap note: explain whichever limit we've hit — the per-order max, or the
       remaining pots for the chosen day. Shown next to the +/− (where the tap
       gets blocked) AND in the summary. */
    const { limit, reason } = orderLimit();
    const atCap = cartQty() >= limit;
    const capMsg = !atCap
      ? ""
      : reason === "day"
      ? `That’s all ${limit} left for ${prettyDate(selectedISO())}. Pick another day for more, or <a href="https://wa.me/353899525318" target="_blank" rel="noopener">message us on WhatsApp</a>.`
      : `That’s our max of ${MAX_ORDER} pots per order. For a bigger order, just <a href="https://wa.me/353899525318" target="_blank" rel="noopener">message us on WhatsApp</a>.`;
    [capNote, flavourCap].forEach((el) => {
      if (!el) return;
      el.hidden = !atCap;
      if (atCap) el.innerHTML = capMsg;
    });

    /* Keep the date picker in sync: days that can't fit the current cart get
       disabled. */
    fillDates();
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
    if (cartQty() > MAX_ORDER) {
      alert(`We can take up to ${MAX_ORDER} pots per order. For a bigger order, message us on WhatsApp.`);
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
      const tyInfo = document.getElementById("tyInfo");
      if (tyInfo && data.info) {
        tyInfo.textContent = data.info;
        tyInfo.hidden = false;
      }
      const tyMaps = document.getElementById("tyMaps");
      if (tyMaps && data.maps) {
        tyMaps.href = data.maps;
        tyMaps.hidden = false;
      }
      if (data.name)
        setText(
          "tyHeading",
          "Grazie, " + data.name.split(" ")[0] + "! Your tiramisu is booked."
        );
      showTy("tyPaid");
    })
    .catch(() => showTy("tyError"));
})();

/* ===========================================================
   Google reviews (home page) — live from the Worker, cached.
   The section stays hidden unless real reviews come back.
   =========================================================== */
(function () {
  const sec = document.getElementById("reviews");
  if (!sec || !CHECKOUT_API) return;

  const esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  const stars = (r) => {
    const n = Math.max(0, Math.min(5, Math.round(r)));
    return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n);
  };

  const card = (rv) => `<article class="review-card">
      <div class="review-top">
        ${
          rv.photo
            ? `<img class="review-avatar" src="${esc(rv.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
            : `<span class="review-avatar review-avatar--blank" aria-hidden="true">${esc(
                (rv.author || "?").charAt(0)
              )}</span>`
        }
        <div class="review-who">
          <div class="review-author">${esc(rv.author || "Google user")}</div>
          <div class="review-stars" aria-label="${rv.rating} out of 5">${stars(rv.rating)}</div>
        </div>
        ${rv.when ? `<span class="review-when">${esc(rv.when)}</span>` : ""}
      </div>
      <p class="review-text">${esc(rv.text)}</p>
    </article>`;

  fetch(CHECKOUT_API + "/reviews", { cache: "no-store" })
    .then((r) => r.json())
    .then((data) => {
      if (!data || !Array.isArray(data.reviews) || !data.reviews.length) return; // stay hidden
      const ratingEl = document.getElementById("reviewsRating");
      if (ratingEl && typeof data.rating === "number") {
        ratingEl.innerHTML = `<span class="stars">${stars(data.rating)}</span> ${data.rating.toFixed(
          1
        )} · ${data.total} Google review${data.total === 1 ? "" : "s"}`;
      }
      const more = document.getElementById("reviewsMore");
      if (more && data.mapsUri) more.href = data.mapsUri;
      const grid = document.getElementById("reviewsGrid");
      if (grid) grid.innerHTML = data.reviews.map(card).join("");
      sec.hidden = false;
    })
    .catch(() => {});
})();
