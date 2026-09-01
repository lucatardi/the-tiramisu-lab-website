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
    /* Only one card open at a time: flipping one resets the rest. */
    const toggle = () => {
      const willFlip = !card.classList.contains("flipped");
      cards.forEach((c) => c.classList.remove("flipped"));
      if (willFlip) card.classList.add("flipped");
    };
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
  const flavourCap = document.getElementById("flavourCap");
  /* True only right after a "+" tap that couldn't add (order already at the
     day's remaining or the per-order max). Drives the cap explanation. */
  let blockedAdd = false;

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
  const firstNameInput = document.getElementById("firstName");
  const phoneInput = document.getElementById("phone");
  const phoneCC = document.getElementById("phoneCC");

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
  /* How many available dates to surface at once — capped to one week (Tue–Fri),
     so bookings don't open two weeks ahead while next week is still wide open.
     Only spills into the following week if next week is partly sold out. */
  const DATE_CARDS = 4;
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

  /* Show the next DATE_CARDS available dates, grouped by week. We always show
     the current week, then future weeks that have a bookable day, until we've
     surfaced DATE_CARDS available dates (completing the last shown week). Every
     shown week renders Tue–Fri; days that are past, sold out, or too small for
     the current cart are greyed. A week with nothing bookable shows a single
     "Sold out" card — this includes an upcoming week that's closed/sold out
     (e.g. the Sunday auto-close); only entirely-past weeks are skipped. */
  function fillDates() {
    if (!dateInput || !dateList) return;
    const keep = dateInput.value;
    const need = cartQty();

    const mondayOf = (d) => {
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
      return x;
    };
    const weekLabel = (o) =>
      o <= 0 ? "This week" : o === 1 ? "Next week" : `In ${o} weeks`;

    /* State of one Tue–Fri collection day. */
    const dayState = (d) => {
      const iso = localISO(d);
      const past = iso < earliestISO;
      const manual = isSoldOut(iso) || isClosedDay(d);
      const left = past || manual ? null : potsLeft(iso);
      const full = left != null && left <= 0;
      const tooSmall = left != null && left > 0 && need > 0 && need > left;
      let state = "open";
      if (past) state = "past";
      else if (manual || full) state = "soldout";
      else if (tooSmall) state = "tight";
      return {
        iso,
        wd: d.toLocaleDateString("en-IE", { weekday: "short" }),
        num: d.getDate(),
        mon: d.toLocaleDateString("en-IE", { month: "short" }),
        left,
        state,
      };
    };

    const chip = (day) => {
      const open = day.state === "open";
      const selected = open && day.iso === keep;
      let cls = "daychip",
        label = "Available";
      if (open) {
        if (day.left != null && day.left < LOW_STOCK_AT) {
          label = `${day.left} left`;
          cls += day.left <= 2 ? " crit" : " low";
        }
      } else if (day.state === "tight") {
        cls += " off";
        label = `${day.left} left`;
      } else {
        cls += " off";
        label = "Sold out"; // full, closed, or in the past
      }
      if (selected) cls += " sel";
      const tag = open ? "button" : "span";
      const attrs = open
        ? `type="button" data-iso="${day.iso}" role="radio" aria-checked="${selected ? "true" : "false"}"`
        : `aria-hidden="true"`;
      return `<${tag} class="${cls}" ${attrs}><span class="wd">${day.wd}</span><span class="num">${day.num}<small>${day.mon}</small></span><span class="st">${label}</span></${tag}>`;
    };

    const today0 = new Date();
    today0.setHours(0, 0, 0, 0);
    const curWeek = mondayOf(today0);
    const openIsos = [];
    let stockCount = 0,
      anyTight = false,
      html = "";

    for (let w = new Date(curWeek); localISO(w) <= latestISO; w.setDate(w.getDate() + 7)) {
      const offset = Math.round((w - curWeek) / (7 * 86400000));
      const days = [1, 2, 3, 4].map((i) => {
        const d = new Date(w);
        d.setDate(d.getDate() + i); // Tue..Fri
        return dayState(d);
      });
      /* "Stock" = a day with at least one pot free — bookable, or too small for
         the current cart but not sold out. We surface the next DATE_CARDS dates
         with any stock, then grey the ones the cart can't fit. */
      const weekStock = days.filter((x) => x.state === "open" || x.state === "tight").length;
      /* A week with nothing bookable: skip it if it's entirely in the past, but
         DO show an upcoming week that's fully sold out / closed as a single
         "Sold out" card (so customers can see next week is shut). Stop once
         we've already surfaced enough available dates. */
      if (weekStock === 0) {
        const allPast = days.every((x) => x.state === "past");
        if (allPast || stockCount >= DATE_CARDS) {
          if (stockCount >= DATE_CARDS) break;
          continue;
        }
      }
      /* A day is "dead" (unbookable) when it's sold out or in the past. Drop a
         whole row (Tue–Wed or Thu–Fri) when both its days are dead, and collapse
         a fully-dead week to a single "Sold out" card. We render row by row and
         stop after a complete pair once we've surfaced enough stock dates — so
         the list lands on up to one week of tidy two-per-row dates, never a lone card. */
      const dead = (x) => x.state === "soldout" || x.state === "past";
      let content = "",
        capped = false;
      if (days.every(dead)) {
        content = `<div class="week-empty">Sold out</div>`;
      } else {
        const rows = [[days[0], days[1]], [days[2], days[3]]].filter(
          (r) => !(dead(r[0]) && dead(r[1]))
        );
        const parts = [];
        for (const r of rows) {
          parts.push(chip(r[0]) + chip(r[1]));
          for (const x of r) {
            if (x.state === "open") openIsos.push(x.iso);
            if (x.state === "tight") anyTight = true;
            if (x.state === "open" || x.state === "tight") stockCount++;
          }
          if (stockCount >= DATE_CARDS - 1) {
            capped = true;
            break;
          }
        }
        content = parts.join("");
      }
      html += `<div class="week">
          <div class="week-head"><span class="week-title">${weekLabel(offset)}</span></div>
          <div class="week-days">${content}</div>
        </div>`;
      if (capped) break;
    }

    dateList.innerHTML = html;

    /* Drop the selection if the chosen day is no longer bookable. */
    if (openIsos.indexOf(keep) === -1) dateInput.value = "";

    if (cartNote) {
      const show = need > 0 && anyTight;
      cartNote.hidden = !show;
      if (show)
        cartNote.innerHTML = `You’ve picked <strong>${need} pot${
          need === 1 ? "" : "s"
        }</strong> — days that can’t fit are greyed out.`;
    }

    if (soldOutNotice) soldOutNotice.hidden = openIsos.length > 0;
    updateSubmitState();
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
    if (isToaster()) {
      showError(timeError, "");
      return true;
    }
    const has = !!selectedTime();
    showError(timeError, has || !reveal ? "" : "Please choose a time.");
    return has;
  }

  /* First name + a plausible phone for the person collecting. The number is a
     country-code dropdown + the local number; we store them combined, e.g.
     "+353 85 123 4567". Validity checks the local part (≥7 digits). */
  const contactName = () => (firstNameInput ? firstNameInput.value.trim() : "");
  const contactDial = () => (phoneCC ? phoneCC.value : "");
  const contactLocal = () => (phoneInput ? phoneInput.value.trim() : "");
  const contactPhone = () => {
    const local = contactLocal();
    return local ? (contactDial() ? contactDial() + " " : "") + local : "";
  };
  const contactOk = () =>
    contactName().length > 0 && contactLocal().replace(/\D/g, "").length >= 7;

  /* ---- "Toast" mode ----
     Colleagues at Toast put "Toast"/"Toaster" in their name. Their tiramisù is
     left in the Local fridge for collection at St Stephen's Green, so there's no
     pick-up time or place to choose — we lock the location to daytime (St
     Stephen's Green) and disable both the place and time fields, showing a note
     instead. (The 10% colleague discount is gated on the same keyword
     server-side.) */
  const isToaster = () => /toaster/i.test(contactName());
  const SLOT_HINT_DEFAULT =
    "We’ll send the exact meeting point in your confirmation, right after payment.";
  const SLOT_HINT_TOASTER =
    "Your tiramisù will be ready to be collected waiting for you in the fridge in the Local at the office.";
  function applyToaster() {
    const on = isToaster();

    /* Place: default + lock to St Stephen's Green (daytime). */
    if (on) {
      const day = slotInputs.find((r) => r.value === "daytime");
      if (day && !day.checked) {
        day.checked = true;
        syncSlot();
      }
    }
    slotInputs.forEach((r) => {
      r.disabled = on;
    });
    const slotBox = document.querySelector(".slot-options");
    if (slotBox) slotBox.classList.toggle("slot-options--off", on);
    const slotHint = document.querySelector(".slot-options + .hint");
    if (slotHint) slotHint.textContent = on ? SLOT_HINT_TOASTER : SLOT_HINT_DEFAULT;

    /* Time: none — it waits in the Local fridge. */
    if (timeToggle) {
      timeToggle.classList.toggle("time-toggle--off", on);
      timeToggle.querySelectorAll("input").forEach((r) => {
        r.disabled = on;
      });
      const field = timeToggle.closest(".field");
      if (field) {
        let note = document.getElementById("toasterNote");
        if (!note) {
          note = document.createElement("p");
          note.id = "toasterNote";
          note.className = "hint toaster-note";
          note.textContent =
            "🧊 The tiramisù will be in the Local fridge waiting for you to be collected.";
          field.appendChild(note);
        }
        note.hidden = !on;
      }
    }
    if (on) showError(timeError, "");
    updateSubmitState();
  }

  /* Enable the submit button only once the order is actually placeable:
     at least one pot, a collection date, a time (unless Toaster mode), and
     who's collecting. */
  function updateSubmitState() {
    if (!submitBtn) return;
    const timeOk = isToaster() || !!selectedTime();
    submitBtn.disabled = !(cartQty() > 0 && !!selectedISO() && timeOk && contactOk());
  }

  function syncSlot() {
    slotInputs.forEach((r) => {
      const card = r.closest(".slot");
      if (card) card.classList.toggle("slot--on", r.checked);
    });
    fillTimes();
    validateTime();
    updateSubmitState();
  }

  /* ---- Keep the selection across a Stripe round-trip ----
     We hand off to Stripe with a full-page navigation, so hitting "back"
     reloads this page fresh and would otherwise wipe the order. Stash the
     choice in sessionStorage just before redirecting and pull it back on load.
     sessionStorage is per-tab and clears when the tab closes, so it never
     leaks a stale order into a brand-new visit. */
  const ORDER_STATE_KEY = "tl_order_v1";
  function saveState() {
    try {
      const qty = {};
      products.forEach((p) => {
        const v = parseInt(p.input.value, 10) || 0;
        if (v) qty[p.name] = v;
      });
      sessionStorage.setItem(
        ORDER_STATE_KEY,
        JSON.stringify({
          qty,
          slot: (slotInputs.find((r) => r.checked) || {}).value || "",
          date: dateInput ? dateInput.value : "",
          time: selectedTime(),
          name: contactName(),
          cc: contactDial(),
          phone: contactLocal(),
        })
      );
    } catch (e) {
      /* storage disabled (private mode / quota) — just skip persistence */
    }
  }
  function restoreState() {
    let s;
    try {
      s = JSON.parse(sessionStorage.getItem(ORDER_STATE_KEY) || "null");
    } catch (e) {
      return null;
    }
    if (!s) return null;
    if (s.qty) products.forEach((p) => { if (s.qty[p.name]) p.input.value = s.qty[p.name]; });
    if (s.slot) {
      const r = slotInputs.find((x) => x.value === s.slot);
      if (r) r.checked = true;
    }
    if (s.date && dateInput) dateInput.value = s.date;
    if (s.name && firstNameInput) firstNameInput.value = s.name;
    if (s.cc && phoneCC) phoneCC.value = s.cc;
    if (s.phone && phoneInput) phoneInput.value = s.phone;
    return s;
  }

  /* ---- Remember the collector across visits (returning customers) ----
     Unlike the sessionStorage order above (one Stripe round-trip), this uses
     localStorage so it survives closing the tab — a repeat customer doesn't
     retype their name + number. Front-end only for now; it stays on their own
     device and is written only when they actually place an order. */
  const CONTACT_KEY = "tl_contact_v1";
  function saveContact() {
    try {
      localStorage.setItem(
        CONTACT_KEY,
        JSON.stringify({ name: contactName(), cc: contactDial(), phone: contactLocal() })
      );
    } catch (e) {
      /* storage disabled — skip */
    }
  }
  function loadContact() {
    let c;
    try {
      c = JSON.parse(localStorage.getItem(CONTACT_KEY) || "null");
    } catch (e) {
      return;
    }
    if (!c) return;
    /* Only fill fields that are still empty, so a Stripe-return restore wins. */
    if (firstNameInput && !firstNameInput.value && c.name) firstNameInput.value = c.name;
    if (phoneInput && !phoneInput.value && c.phone) {
      phoneInput.value = c.phone;
      if (phoneCC && c.cc) phoneCC.value = c.cc;
    }
  }

  /* Bring back any order saved just before a Stripe redirect. Must run before
     the first paint so slot/date/qty are already in place. The time radios are
     rendered by fillTimes (below), so we re-check the saved time afterwards. */
  const restored = restoreState();
  loadContact(); // prefill name/phone for returning customers (empties only)

  if (dateInput && dateList) {
    fillDates();
    dateList.addEventListener("click", (e) => {
      const card = e.target.closest(".daychip");
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
      updateSubmitState();
    });
  }
  slotInputs.forEach((r) => r.addEventListener("change", syncSlot));
  syncSlot();
  applyToaster(); // in case a "Toaster" name was restored

  /* Name/phone: no inline error — just keep the submit button state live.
     A name change may toggle Toaster mode, so re-apply it on name input. */
  [firstNameInput, phoneInput].forEach((el) => {
    if (el) el.addEventListener("input", applyToaster);
  });
  if (phoneCC) phoneCC.addEventListener("change", updateSubmitState);


  /* Re-check the saved time now that syncSlot/fillTimes has rendered the
     radios for the restored slot. */
  if (restored && restored.time && timeToggle) {
    timeToggle.querySelectorAll(".time-opt").forEach((l) => {
      const inp = l.querySelector("input");
      const on = inp.value === restored.time;
      inp.checked = on;
      l.classList.toggle("on", on);
    });
  }

  /* Pull in the sold-out dates + any full days, then rebuild the picker.
     A restored date can't be validated until this data is in, and the first
     (data-less) fillDates may have dropped it — so re-apply it here and let
     recalc validate it against real capacity (clearing it only if it's now
     genuinely sold out). */
  Promise.all([loadSoldOutDates(), loadFullDates()]).then(() => {
    if (restored && restored.date && dateInput && !dateInput.value) {
      dateInput.value = restored.date;
    }
    recalc();
  });

  /* In Stripe mode, relabel the primary action + hide the WhatsApp note */
  if (CHECKOUT_API) {
    if (submitBtn) submitBtn.textContent = "Continue to payment";
    const note = document.getElementById("submitNote");
    if (note) note.hidden = true;
    const slotHint = document.querySelector(".slot-options + .hint");
    if (slotHint) slotHint.textContent = SLOT_HINT_DEFAULT;
    applyToaster(); // re-apply after resetting the hint (handles a restored Toaster name)
  }

  orderForm.validateCollection = () => {
    const okDate = validateDate(true);
    const okTime = validateTime(true);
    return okDate && okTime && contactOk();
  };

  /* Quantity steppers */
  document.querySelectorAll("[data-qty]").forEach((qty) => {
    const input = qty.querySelector("input");
    qty.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const step = parseInt(btn.dataset.step, 10);
        const cur = parseInt(input.value, 10) || 0;
        const room = orderLimit().limit - cartQty(input); // room left for this flavour
        const next = Math.max(0, Math.min(room, cur + step));
        /* Only flag a hit when they actually tried to add and couldn't — so
           landing exactly on the day's remaining count stays quiet. */
        blockedAdd = step > 0 && next === cur;
        input.value = next;
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

    /* Cap banner (below the flavours): shown whenever the order has hit the
       limit for what you can still add — the selected day's remaining pots, or
       our per-order max. Cleared as soon as the order drops below it. */
    const { limit, reason } = orderLimit();
    const n = cartQty();
    const showCap = n > 0 && n >= limit;
    const capMsg = !showCap
      ? ""
      : reason === "day"
      ? `You’ve picked ${n} pot${n === 1 ? "" : "s"} — that’s all we have left for ${prettyDate(
          selectedISO()
        )}. Pick another day for more.`
      : `You’ve picked ${MAX_ORDER} pots — that’s the most we take per order. For a bigger order, just <a href="https://wa.me/353899525318" target="_blank" rel="noopener">message us on WhatsApp</a>.`;
    if (flavourCap) {
      flavourCap.hidden = !showCap;
      if (showCap) flavourCap.innerHTML = capMsg;
    }

    /* Grey out the steppers at their edges: − when a flavour is at 0, and +
       once the whole order has reached the limit (the day's pots or the max). */
    const atLimit = cartQty() >= limit;
    products.forEach((p) => {
      const box = p.input.closest("[data-qty]");
      if (!box) return;
      const v = parseInt(p.input.value, 10) || 0;
      const minus = box.querySelector('[data-step="-1"]');
      const plus = box.querySelector('[data-step="1"]');
      if (minus) minus.disabled = v <= 0;
      if (plus) plus.disabled = atLimit;
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
    const timeLabel = isToaster() ? "Local fridge" : selectedTimeLabel() || "—";
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
      time: isToaster() ? "Local fridge" : selectedTimeLabel(),
      slot: isToaster()
        ? "daytime"
        : (slotInputs.find((r) => r.checked) || {}).value || "daytime",
      name: contactName(),
      phone: contactPhone(),
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
      saveState(); // so "back" from Stripe restores the order
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

    saveContact(); // remember name/phone for their next visit

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
      /* Order went through — drop the stashed selection so it won't be
         restored if the order page is reopened in this tab. */
      try { sessionStorage.removeItem("tl_order_v1"); } catch (e) {}
      setText("tyOrderId", data.orderId ? "#" + data.orderId : "—");
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
      if (data.fridge) {
        const tyNote = document.getElementById("tyNote");
        if (tyNote)
          tyNote.innerHTML =
            "🧊 It’ll be waiting for you in the fridge in the Local at the office — ready whenever you are on the day. 🤎";
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

/* Reviews are now hardcoded in index.html, each linked to Google to verify —
   so there's no live fetch here anymore. */
