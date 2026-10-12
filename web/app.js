/* Afterglow web foundation.
 *
 * Components and the interaction controller are production code. Data flows
 * through one adapter with the shape below; the fixture adapter at the bottom
 * demonstrates states and is replaced by the Builder's API adapter.
 *
 *   adapter.list({ mood, max_duration })  -> Promise<Activity[]>
 *   adapter.create(fields)                -> Promise<Activity>
 *   adapter.update(id, patch)             -> Promise<Activity>
 *   adapter.remove(id)                    -> Promise<void>
 *
 * Rejections are AdapterError { message, status, fields } — mirror the API
 * error envelope {error: {message, fields?}}.
 */
"use strict";

(() => {
  // ---------- Shared contract ----------
  const LIMITS = { title: 120, place: 160, note: 1000 };
  const MOODS = [
    { value: "quiet", label: "Quiet" },
    { value: "social", label: "Social" },
    { value: "outdoors", label: "Outdoors" },
  ];
  const DURATIONS = [
    { value: 30, label: "30 min", short: "30", unit: "min", span: 0.25 },
    { value: 60, label: "1 hour", short: "60", unit: "min", span: 0.5 },
    { value: 120, label: "2 hours", short: "120", unit: "min", span: 1 },
  ];
  const STATUSES = [
    { value: "saved", label: "Saved", done: "Back on the saved list." },
    { value: "planned", label: "Planned", done: "Planned. Enjoy the evening." },
    { value: "tried", label: "Tried", done: "Marked as tried." },
  ];

  const byValue = (list, value) => list.find((item) => item.value === value);
  const codePoints = (text) => Array.from(text).length;

  class AdapterError extends Error {
    constructor(message, { status = 0, fields = null } = {}) {
      super(message);
      this.name = "AdapterError";
      this.status = status;
      this.fields = fields;
    }
  }

  /** Client-side mirror of the API rules for immediate feedback; the server stays authoritative. */
  function validateDraft(raw) {
    const value = {
      title: String(raw.title ?? "").trim(),
      mood: raw.mood || "",
      duration: Number(raw.duration) || 0,
      place: String(raw.place ?? "").trim(),
      note: String(raw.note ?? "").trim(),
    };
    const fields = {};
    if (!value.title) fields.title = "Give this evening a title.";
    else if (codePoints(value.title) > LIMITS.title) fields.title = `Keep the title to ${LIMITS.title} characters or fewer.`;
    if (!byValue(MOODS, value.mood)) fields.mood = "Choose the mood it suits.";
    if (!byValue(DURATIONS, value.duration)) fields.duration = "Choose how long it takes.";
    if (codePoints(value.place) > LIMITS.place) fields.place = `Keep the place to ${LIMITS.place} characters or fewer.`;
    if (codePoints(value.note) > LIMITS.note) fields.note = `Keep the note to ${LIMITS.note} characters or fewer.`;
    return { value, fields, ok: Object.keys(fields).length === 0 };
  }

  const matchesFilters = (activity, filters) =>
    (!filters.mood || activity.mood === filters.mood) &&
    (!filters.maxDuration || activity.duration <= filters.maxDuration);

  // ---------- DOM references ----------
  const $ = (selector, root = document) => root.querySelector(selector);
  const dom = {
    add: $("#add-activity"),
    moodFilter: $("#mood-filter"),
    timeFilter: $("#time-filter"),
    horizon: $(".horizon"),
    clear: $("#clear-filters"),
    count: $("#result-count"),
    heading: $("#programme-title"),
    list: $("#activity-list"),
    listState: $("#list-state"),
    template: $("#evening-template"),
    toast: $("#toast"),
    dialog: $("#editor"),
    form: $("#editor-form"),
  };

  // ---------- Toast (polite announcements) ----------
  const toast = {
    timer: 0,
    show(message, { tone = "success", action = null, sticky = false } = {}) {
      const el = dom.toast;
      clearTimeout(this.timer);
      el.dataset.tone = tone;
      $(".toast-icon use", el).setAttribute("href", tone === "error" ? "#i-alert" : "#i-check");
      $(".toast-text", el).textContent = message;
      const actionBtn = $(".toast-action", el);
      actionBtn.hidden = !action;
      actionBtn.textContent = action ? action.label : "";
      actionBtn.onclick = action ? () => { this.hide(); action.run(); } : null;
      el.hidden = false;
      if (!sticky && !action) this.timer = setTimeout(() => this.hide(), 5000);
    },
    hide() {
      clearTimeout(this.timer);
      dom.toast.hidden = true;
    },
  };
  $(".toast-close", dom.toast).addEventListener("click", () => toast.hide());

  // ---------- Evening row component ----------
  function createRow(activity) {
    const row = dom.template.content.firstElementChild.cloneNode(true);
    row.dataset.id = String(activity.id);
    fillRow(row, activity);
    return row;
  }

  function fillRow(row, activity) {
    const duration = byValue(DURATIONS, activity.duration);
    const mood = byValue(MOODS, activity.mood);
    row.dataset.mood = activity.mood;
    row.dataset.status = activity.status;
    $(".evening-minutes", row).textContent = duration.short;
    $(".evening-unit", row).textContent = duration.unit;
    $(".evening-span", row).style.setProperty("--span", duration.span);
    $(".evening-title", row).textContent = activity.title;
    $(".mood-name", row).textContent = mood.label;
    $(".evening-length", row).textContent = `, ${duration.label}`;
    const place = $(".evening-place", row);
    place.hidden = !activity.place;
    $("span", place).textContent = activity.place;
    const note = $(".evening-note", row);
    note.hidden = !activity.note;
    note.textContent = activity.note;
    note.title = activity.note.length > 140 ? activity.note : "";

    const group = $(".status-switch", row);
    group.setAttribute("aria-label", `Status of ${activity.title}`);
    for (const option of group.querySelectorAll(".status-option")) {
      option.setAttribute("aria-pressed", String(option.dataset.status === activity.status));
    }
    $(".evening-edit", row).setAttribute("aria-label", `Edit ${activity.title}`);
    $(".evening-edit", row).title = "Edit";
  }

  function setRowPending(row, status) {
    const group = $(".status-switch", row);
    const feedback = $(".status-feedback", row);
    for (const option of group.querySelectorAll(".status-option")) {
      const isTarget = status && option.dataset.status === status;
      option.toggleAttribute("data-pending", Boolean(isTarget));
      if (status) option.setAttribute("aria-disabled", "true");
      else option.removeAttribute("aria-disabled");
    }
    if (status) {
      group.setAttribute("aria-busy", "true");
      feedback.dataset.tone = "pending";
      feedback.textContent = `Saving as ${byValue(STATUSES, status).label.toLowerCase()}…`;
    } else {
      group.removeAttribute("aria-busy");
    }
  }

  function setRowFeedback(row, message, { tone = "info", retry = null } = {}) {
    const feedback = $(".status-feedback", row);
    feedback.dataset.tone = tone;
    feedback.textContent = message;
    if (retry) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "link-btn";
      button.textContent = "Retry";
      button.dataset.retryStatus = retry;
      feedback.append(" ", button);
    }
  }

  // ---------- Controller state ----------
  const state = {
    activities: [],
    filters: { mood: "", maxDuration: 0 },
    phase: "loading", // loading | ready | error
    requestSeq: 0,
    statusPending: new Map(),
  };
  let adapter = null;

  const findActivity = (id) => state.activities.find((a) => a.id === id);
  const visibleActivities = () => state.activities.filter((a) => matchesFilters(a, state.filters));
  const filtersActive = () => Boolean(state.filters.mood || state.filters.maxDuration);
  const rowFor = (id) => dom.list.querySelector(`.evening[data-id="${id}"]`);

  function apiFilters() {
    const query = {};
    if (state.filters.mood) query.mood = state.filters.mood;
    if (state.filters.maxDuration) query.max_duration = state.filters.maxDuration;
    return query;
  }

  // ---------- Render ----------
  function render() {
    const items = visibleActivities();

    // Keyed reconciliation keeps focus and pending state on surviving rows.
    const existing = new Map([...dom.list.children].map((row) => [Number(row.dataset.id), row]));
    let cursor = dom.list.firstElementChild;
    for (const activity of items) {
      let row = existing.get(activity.id);
      if (row) {
        fillRow(row, activity);
        existing.delete(activity.id);
      } else {
        row = createRow(activity);
      }
      if (row !== cursor) dom.list.insertBefore(row, cursor);
      else cursor = cursor.nextElementSibling;
      const pending = state.statusPending.get(activity.id);
      if (pending) setRowPending(row, pending);
    }
    for (const row of existing.values()) row.remove();

    renderListState(items);
    renderCount(items);
    dom.clear.setAttribute("aria-disabled", String(!filtersActive()));
  }

  function renderListState(items) {
    let panel = "";
    if (state.phase === "loading" && state.activities.length === 0) panel = "loading";
    else if (state.phase === "error" && state.activities.length === 0) panel = "error";
    else if (state.phase === "ready" && items.length === 0) panel = filtersActive() ? "filtered" : "empty";

    dom.listState.hidden = !panel;
    for (const el of dom.listState.querySelectorAll(".state-panel")) el.hidden = el.dataset.state !== panel;
    if (panel === "filtered") {
      const mood = byValue(MOODS, state.filters.mood);
      const duration = byValue(DURATIONS, state.filters.maxDuration);
      const what = mood ? `Nothing ${mood.label.toLowerCase()}` : "Nothing";
      $("[data-filtered-title]", dom.listState).textContent = `${what} fits ${duration ? `in ${duration.label}` : "tonight"}.`;
    }
  }

  function renderCount(items) {
    if (state.phase === "loading" && state.activities.length === 0) {
      dom.count.textContent = "Loading…";
      return;
    }
    if (state.phase === "error" && state.activities.length === 0) {
      dom.count.textContent = "Not loaded";
      return;
    }
    const planned = items.filter((a) => a.status === "planned").length;
    const noun = items.length === 1 ? "evening" : "evenings";
    dom.count.textContent = `${items.length} ${noun}${planned ? ` · ${planned} planned` : ""}`;
  }

  // ---------- Loading & filters ----------
  async function load() {
    const seq = ++state.requestSeq;
    dom.list.setAttribute("aria-busy", "true");
    if (state.activities.length === 0) {
      state.phase = "loading";
      render();
    }
    try {
      const items = await adapter.list(apiFilters());
      if (seq !== state.requestSeq) return; // a newer filter won
      mergeLoaded(items);
      state.phase = "ready";
      render();
    } catch (error) {
      if (seq !== state.requestSeq) return;
      if (state.activities.length === 0) {
        state.phase = "error";
        render();
      } else {
        toast.show("Couldn’t refresh the list. Showing what you had.", {
          tone: "error",
          action: { label: "Retry", run: load },
        });
      }
    } finally {
      if (seq === state.requestSeq) dom.list.removeAttribute("aria-busy");
    }
  }

  /** The server returns only filtered rows; keep everything else we already know so clearing filters is instant. */
  function mergeLoaded(items) {
    const incoming = new Map(items.map((a) => [a.id, a]));
    const kept = state.activities.filter((a) => !incoming.has(a.id) && !matchesFilters(a, state.filters));
    state.activities = [...kept, ...items].sort((a, b) => a.id - b.id);
  }

  function syncFilterControls() {
    for (const input of dom.moodFilter.querySelectorAll("input")) input.checked = input.value === state.filters.mood;
    const time = state.filters.maxDuration ? String(state.filters.maxDuration) : "";
    for (const input of dom.timeFilter.querySelectorAll("input")) input.checked = input.value === time;
    dom.horizon.dataset.fill = time || "any";
  }

  function setFilters(next) {
    state.filters = { ...state.filters, ...next };
    syncFilterControls();
    render(); // instant local preview from known rows
    load(); // authoritative refresh; stale responses are ignored
  }

  function clearFilters({ focusHeading = false } = {}) {
    if (!filtersActive()) return;
    setFilters({ mood: "", maxDuration: 0 });
    if (focusHeading) dom.heading.focus();
    toast.show("Showing every evening.");
  }

  dom.moodFilter.addEventListener("change", (event) => setFilters({ mood: event.target.value }));
  dom.timeFilter.addEventListener("change", (event) => setFilters({ maxDuration: Number(event.target.value) || 0 }));
  dom.clear.addEventListener("click", () => clearFilters());

  dom.listState.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "retry-load") {
      dom.heading.focus();
      load();
    } else if (action === "add") {
      editor.open({ mode: "create", trigger: dom.add });
    } else if (action === "clear-filters") {
      clearFilters({ focusHeading: true });
    }
  });

  // ---------- Status changes ----------
  async function changeStatus(id, status) {
    const activity = findActivity(id);
    const row = rowFor(id);
    if (!activity || !row || state.statusPending.has(id) || activity.status === status) return;
    state.statusPending.set(id, status);
    setRowPending(row, status);
    try {
      const updated = await adapter.update(id, { status });
      Object.assign(activity, updated);
      state.statusPending.delete(id);
      render();
      const current = rowFor(id);
      if (current) {
        setRowPending(current, null);
        setRowFeedback(current, byValue(STATUSES, updated.status).done, { tone: "success" });
      }
    } catch (error) {
      state.statusPending.delete(id);
      const current = rowFor(id);
      if (current) {
        setRowPending(current, null);
        setRowFeedback(current, "Couldn’t change the status.", { tone: "error", retry: status });
      }
    }
  }

  dom.list.addEventListener("click", (event) => {
    const row = event.target.closest(".evening");
    if (!row) return;
    const id = Number(row.dataset.id);
    const option = event.target.closest(".status-option");
    const retry = event.target.closest("[data-retry-status]");
    if (option) {
      if (option.getAttribute("aria-disabled") === "true") return; // pending: explained in feedback
      changeStatus(id, option.dataset.status);
    } else if (retry) {
      // Move focus onto the status option before the retry link is replaced.
      const target = row.querySelector(`.status-option[data-status="${retry.dataset.retryStatus}"]`);
      target.focus();
      changeStatus(id, retry.dataset.retryStatus);
    } else if (event.target.closest("[data-action='edit']")) {
      editor.open({ mode: "edit", activity: findActivity(id), trigger: event.target.closest("button") });
    }
  });

  /** Where focus goes when the opener vanished: next visible row, else previous, else Add. */
  function focusFallback(removedIndex) {
    const rows = [...dom.list.children];
    const target = rows[removedIndex] || rows[removedIndex - 1];
    (target ? $(".evening-edit", target) : dom.add).focus();
  }

  // ---------- Editor component ----------
  const editor = (() => {
    const { dialog, form } = dom;
    const alert = $("#editor-alert", form);
    const pendingLine = $("#editor-pending", form);
    const title = $("#editor-title", form);
    const submit = $(".btn-submit", form);
    const askDelete = $("[data-action='ask-delete']", form);
    const confirmDelete = $("[data-action='confirm-delete']", form);
    const groups = {
      main: $("[data-group='main']", form),
      confirm: $("[data-group='confirm']", form),
    };
    const textFields = ["title", "place", "note"];
    const session = { mode: "create", id: null, trigger: null, triggerIndex: -1, pending: false, failedOnce: false };

    function readForm() {
      const data = new FormData(form);
      return {
        title: data.get("title") ?? "",
        mood: data.get("mood") ?? "",
        duration: data.get("duration") ?? "",
        place: data.get("place") ?? "",
        note: data.get("note") ?? "",
      };
    }

    function writeForm(activity) {
      form.elements.title.value = activity?.title ?? "";
      form.elements.place.value = activity?.place ?? "";
      form.elements.note.value = activity?.note ?? "";
      for (const input of form.querySelectorAll("input[name='mood']")) input.checked = input.value === activity?.mood;
      for (const input of form.querySelectorAll("input[name='duration']")) input.checked = Number(input.value) === activity?.duration;
      textFields.forEach(updateCounter);
    }

    function updateCounter(name) {
      const counter = $(`[data-counter='${name}']`, form);
      const length = codePoints(form.elements[name].value.trim());
      counter.textContent = `${length} / ${LIMITS[name]}`;
      counter.toggleAttribute("data-over", length > LIMITS[name]);
    }

    function setFieldError(name, message) {
      const field = $(`[data-field='${name}']`, form);
      $(`#error-${name}`, form).textContent = message || "";
      field.toggleAttribute("data-invalid", Boolean(message));
      const control = textFields.includes(name) ? form.elements[name] : null;
      if (control) control.setAttribute("aria-invalid", String(Boolean(message)));
      else field.setAttribute("aria-invalid", String(Boolean(message)));
    }

    function showErrors(fields = {}, message = "") {
      for (const name of ["title", "mood", "duration", "place", "note"]) setFieldError(name, fields[name]);
      alert.hidden = !message;
      $(".form-alert-text", alert).textContent = message;
    }

    function focusFirstProblem(fields, preferAlert) {
      if (preferAlert && !alert.hidden) return alert.focus();
      const first = ["title", "mood", "duration", "place", "note"].find((name) => fields[name]);
      if (!first) return alert.hidden ? null : alert.focus();
      if (textFields.includes(first)) form.elements[first].focus();
      else ($(`[data-field='${first}'] input:checked`, form) || $(`[data-field='${first}'] input`, form)).focus();
    }

    function showGroup(name) {
      groups.main.hidden = name !== "main";
      groups.confirm.hidden = name !== "confirm";
    }

    function setPending(pending, label = "") {
      session.pending = pending;
      form.toggleAttribute("data-pending", pending);
      for (const name of textFields) form.elements[name].readOnly = pending;
      for (const button of form.querySelectorAll("button")) {
        if (pending) button.setAttribute("aria-disabled", "true");
        else button.removeAttribute("aria-disabled");
      }
      const busy = groups.confirm.hidden ? submit : confirmDelete;
      busy.toggleAttribute("aria-busy", pending);
      if (pending) busy.dataset.label = busy.textContent;
      busy.textContent = pending ? label : busy.dataset.label || busy.textContent;
      pendingLine.textContent = pending ? "Hold on — your changes are being saved. Closing is paused until it finishes." : "";
    }

    function open({ mode, activity = null, trigger }) {
      Object.assign(session, {
        mode,
        id: activity?.id ?? null,
        trigger,
        triggerIndex: trigger?.closest(".evening") ? [...dom.list.children].indexOf(trigger.closest(".evening")) : -1,
        pending: false,
        failedOnce: false,
      });
      title.textContent = mode === "create" ? "Add an evening" : "Edit evening";
      submit.textContent = mode === "create" ? "Save evening" : "Save changes";
      submit.dataset.label = submit.textContent;
      confirmDelete.textContent = "Delete";
      confirmDelete.dataset.label = "Delete";
      askDelete.hidden = mode === "create";
      showGroup("main");
      showErrors();
      setPending(false);
      writeForm(activity);
      dialog.showModal();
      form.elements.title.focus();
    }

    function close({ focus } = {}) {
      if (session.pending) return;
      dialog.close();
      const target = focus || (session.trigger?.isConnected ? session.trigger : null);
      if (target) target.focus();
      else focusFallback(Math.max(session.triggerIndex, 0));
    }

    function failureMessage(error, verb) {
      if (error instanceof AdapterError && error.fields) return error.message || "Some details need another look.";
      return `Couldn’t ${verb} — nothing was lost. Check the connection and try again.`;
    }

    async function save() {
      if (session.pending) return;
      const { value, fields, ok } = validateDraft(readForm());
      if (!ok) {
        showErrors(fields, "");
        focusFirstProblem(fields, false);
        return;
      }
      showErrors();
      setPending(true, "Saving…");
      try {
        const saved = session.mode === "create" ? await adapter.create(value) : await adapter.update(session.id, value);
        upsertActivity(saved);
        setPending(false);
        render();
        const visible = matchesFilters(saved, state.filters);
        const row = visible ? rowFor(saved.id) : null;
        const editButton = row ? $(".evening-edit", row) : null;
        if (session.mode === "create") {
          close({ focus: editButton || dom.add });
        } else {
          close({ focus: editButton || undefined });
        }
        if (row) row.scrollIntoView({ block: "nearest" });
        toast.show(
          visible ? `Saved “${saved.title}”.` : `Saved “${saved.title}”. It’s hidden by the current filters.`,
          visible ? {} : { action: { label: "Show all", run: () => clearFilters() } },
        );
      } catch (error) {
        setPending(false);
        session.failedOnce = true;
        submit.textContent = "Retry save";
        submit.dataset.label = "Retry save";
        const fieldErrors = (error instanceof AdapterError && error.fields) || {};
        showErrors(fieldErrors, failureMessage(error, "save"));
        focusFirstProblem(fieldErrors, !Object.keys(fieldErrors).length);
      }
    }

    async function remove() {
      if (session.pending) return;
      showErrors();
      setPending(true, "Deleting…");
      try {
        await adapter.remove(session.id);
        const removedTitle = findActivity(session.id)?.title ?? "evening";
        state.activities = state.activities.filter((a) => a.id !== session.id);
        setPending(false);
        render();
        dialog.close();
        focusFallback(Math.max(session.triggerIndex, 0));
        toast.show(`Deleted “${removedTitle}”.`);
      } catch (error) {
        setPending(false);
        confirmDelete.textContent = "Retry delete";
        confirmDelete.dataset.label = "Retry delete";
        showErrors({}, failureMessage(error, "delete"));
        alert.focus();
      }
    }

    // Keep focus inside the editor (showModal makes the page inert; this also wraps Tab).
    dialog.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const focusables = [...dialog.querySelectorAll("button, input, textarea, [tabindex='0']")].filter(
        (el) => !el.hidden && !el.closest("[hidden]") && el.offsetParent !== null && !(el.type === "radio" && !el.checked && form.querySelector(`input[name='${el.name}']:checked`)),
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    dialog.addEventListener("cancel", (event) => {
      event.preventDefault(); // Escape: close through our path so focus returns and pending is respected
      if (!groups.confirm.hidden && !session.pending) {
        showGroup("main");
        askDelete.focus();
        return;
      }
      close();
    });

    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) close(); // backdrop
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      save();
    });

    form.addEventListener("click", (event) => {
      if (session.pending && event.target.closest("input[type='radio']")) {
        event.preventDefault(); // values are locked while saving
        return;
      }
      const action = event.target.closest("button")?.dataset.action;
      if (!action || session.pending) return;
      if (action === "close") close();
      else if (action === "ask-delete") {
        showErrors();
        showGroup("confirm");
        $("[data-action='keep']", form).focus();
      } else if (action === "keep") {
        showGroup("main");
        askDelete.focus();
      } else if (action === "confirm-delete") remove();
    });

    form.addEventListener("input", (event) => {
      const name = event.target.name;
      if (textFields.includes(name)) updateCounter(name);
      if (name && $(`[data-field='${name}']`, form)?.hasAttribute("data-invalid")) setFieldError(name, "");
    });

    return { open, close };
  })();

  function upsertActivity(saved) {
    const index = state.activities.findIndex((a) => a.id === saved.id);
    if (index === -1) state.activities.push(saved);
    else state.activities[index] = saved;
    state.activities.sort((a, b) => a.id - b.id);
  }

  dom.add.addEventListener("click", () => editor.open({ mode: "create", trigger: dom.add }));

  // ---------- Fixture adapter (demo only; Builder replaces with the API adapter) ----------
  // URL options: ?latency=900  ?fail=load,save,status,delete,fields (each fails once)  ?empty=1
  function createFixtureAdapter() {
    const params = new URLSearchParams(location.search);
    const latency = Number(params.get("latency") ?? 450);
    const failures = new Set((params.get("fail") || "").split(",").filter(Boolean));
    let store = null;
    let nextId = 1;
    const copy = (a) => ({ ...a });
    const wait = () => new Promise((resolve) => setTimeout(resolve, latency));
    const failOnce = (op, error) => {
      if (failures.delete(op)) throw error;
    };
    async function ensureStore() {
      if (store) return;
      const response = await fetch("fixtures.json", { cache: "no-store" });
      if (!response.ok) throw new AdapterError("Fixture unavailable", { status: response.status });
      const data = await response.json();
      store = params.has("empty") ? [] : data.activities.map(copy);
      nextId = Math.max(0, ...data.activities.map((a) => a.id)) + 1;
    }
    const unavailable = () => new AdapterError("Service unavailable", { status: 503 });
    const fieldProblem = () =>
      new AdapterError("Some details need another look.", { status: 400, fields: { place: "That place couldn’t be saved. Try a shorter name." } });

    return {
      async list(filters) {
        await wait();
        failOnce("load", unavailable());
        await ensureStore();
        const f = { mood: filters.mood || "", maxDuration: Number(filters.max_duration) || 0 };
        return store.filter((a) => matchesFilters(a, f)).map(copy);
      },
      async create(fields) {
        await wait();
        failOnce("fields", fieldProblem());
        failOnce("save", unavailable());
        const activity = { id: nextId++, ...fields, status: "saved" };
        store.push(activity);
        return copy(activity);
      },
      async update(id, patch) {
        await wait();
        const statusOnly = Object.keys(patch).length === 1 && "status" in patch;
        if (!statusOnly) failOnce("fields", fieldProblem());
        failOnce(statusOnly ? "status" : "save", unavailable());
        const activity = store.find((a) => a.id === id);
        if (!activity) throw new AdapterError("That evening no longer exists.", { status: 404 });
        Object.assign(activity, patch);
        return copy(activity);
      },
      async remove(id) {
        await wait();
        failOnce("delete", unavailable());
        store = store.filter((a) => a.id !== id);
      },
    };
  }

  // ---------- Boot ----------
  window.Afterglow = { LIMITS, MOODS, DURATIONS, STATUSES, AdapterError, validateDraft, codePoints };
  adapter = createFixtureAdapter();
  syncFilterControls();
  load();
})();
