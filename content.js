(() => {
  "use strict";

  const dates = new Map();
  const catalogs = new Map();
  const lookups = new Map();
  const records = new Map();
  const statuses = new Map();
  const requests = [];
  let activeRequests = 0;
  let scanScheduled = false;

  const FAILED_STATES = new Set(["CANCELLED", "ERROR", "FAILURE", "STARTUP_FAILURE", "TIMED_OUT"]);
  const PASSED_STATES = new Set(["SUCCESS", "COMPLETED"]);
  const SETTLED_STATES = new Set([...FAILED_STATES, ...PASSED_STATES, "SKIPPED", "NEUTRAL", "STALE"]);
  const STATUS_REFRESH_MS = 60 * 1000;
  // Checks can be registered a little after a push, so an empty pending summary is polled only for recent commits.
  const EMPTY_CHECKS_WINDOW_MS = 60 * 60 * 1000;

  function pullRequest() {
    const match = location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/);
    if (location.hostname !== "github.com" || !match) return null;
    const [, owner, repo, number] = match;
    const repository = `${owner}/${repo}`;
    return { repository, number, key: `${repository}/pull/${number}` };
  }

  function hashTarget(anchor, context) {
    let url;
    try {
      url = new URL(anchor.getAttribute("href"), location.origin);
    } catch {
      return null;
    }
    if (url.origin !== location.origin) return null;
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:commit|pull\/(\d+)\/(?:commits|changes))\/([a-f0-9]{40})\/?$/i);
    if (!match || `${match[1]}/${match[2]}`.toLowerCase() !== context.repository.toLowerCase()) return null;
    if (match[3] && match[3] !== context.number) return null;
    const sha = match[4].toLowerCase();
    const code = [...anchor.querySelectorAll("code")].find((node) => /^[a-f0-9]{7,40}$/i.test(node.textContent.trim()));
    const node = code || anchor;
    const label = node.textContent.trim().toLowerCase();
    if (!/^[a-f0-9]{7,40}$/.test(label) || !sha.startsWith(label)) return null;
    return { anchor, node, sha, key: `${context.repository.toLowerCase()}/${sha}` };
  }

  function validDate(value) {
    if (typeof value !== "string") return false;
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/);
    if (!match) return false;
    const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match;
    const calendar = new Date(`${year}-${month}-${day}T00:00:00Z`);
    return Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 &&
      calendar.getUTCDate() === Number(day) && Number(hour) < 24 &&
      Number(minute) < 60 && Number(second) < 60 &&
      (!offsetHour || (Number(offsetHour) < 24 && Number(offsetMinute) < 60)) &&
      Number.isFinite(Date.parse(value));
  }

  function readDates(documentSource, context, expectedSha = null) {
    for (const script of documentSource.querySelectorAll('script[type="application/json"][data-target="react-app.embeddedData"]')) {
      try {
        const payload = JSON.parse(script.textContent).payload;
        const commits = expectedSha
          ? [payload?.commitRoute?.commit]
          : (payload?.pullRequestsCommitsRoute?.commitGroups || []).flatMap((group) => group.commits || []);
        for (const commit of commits) {
          if (!commit || !/^[a-f0-9]{40}$/i.test(commit.oid) || !validDate(commit.committedDate)) continue;
          const sha = commit.oid.toLowerCase();
          if (expectedSha && sha !== expectedSha) continue;
          const key = `${context.repository.toLowerCase()}/${sha}`;
          if (!dates.has(key)) dates.set(key, commit.committedDate);
        }
      } catch {}
    }
  }

  function drainRequests() {
    while (activeRequests < 3 && requests.length) {
      const { path, type, resolve } = requests.shift();
      activeRequests += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const accept = type === "json" ? "application/json" : "text/html";
      fetch(path, { credentials: "same-origin", signal: controller.signal, headers: { Accept: accept } })
        .then(async (response) => {
          if (!response.ok || new URL(response.url).origin !== location.origin) return null;
          if (type === "json") return response.json();
          return new DOMParser().parseFromString(await response.text(), "text/html");
        })
        .catch(() => null)
        .then(resolve)
        .finally(() => {
          clearTimeout(timeout);
          activeRequests -= 1;
          drainRequests();
        });
    }
  }

  function fetchDocument(path, type = "html") {
    return new Promise((resolve) => {
      requests.push({ path, type, resolve });
      drainRequests();
    });
  }

  function checkUrl(value) {
    if (typeof value !== "string" || !value) return null;
    try {
      const url = new URL(value, location.origin);
      return url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  }

  function readStatus(data, iso) {
    if (!data || !Array.isArray(data.checkRuns)) return null;
    const runs = { failed: [], running: [], passed: [] };
    const age = iso ? Date.now() - Date.parse(iso) : Infinity;
    let settled = !(data.checkRuns.length === 0 &&
      String(data.checksHeaderState || "").toUpperCase() === "PENDING" && age < EMPTY_CHECKS_WINDOW_MS);
    for (const run of data.checkRuns) {
      if (!run || typeof run !== "object") continue;
      const state = String(run.state || "").toUpperCase();
      const group = FAILED_STATES.has(state) ? "failed" : PASSED_STATES.has(state) ? "passed" :
        SETTLED_STATES.has(state) ? null : "running";
      if (group === "running") settled = false;
      if (!group) continue;
      const label = [run.name, run.additionalContext].filter((part) => typeof part === "string" && part.trim());
      const name = label.length ? label.map((part) => part.trim()).join(" ") : "Check";
      runs[group].push({ name, state, url: checkUrl(run.targetUrl) });
    }
    // A failure is shown as soon as it happens, even while other checks are still running.
    const state = runs.failed.length ? "failed" : runs.running.length ? "running" : runs.passed.length ? "passed" : null;
    return { state, runs: state ? runs[state] : [], settled };
  }

  function checkStatus(context, target, refresh = false) {
    const entry = statuses.get(target.key);
    if (entry && !(refresh && entry.result && !entry.result.settled && Date.now() - entry.at >= STATUS_REFRESH_MS)) {
      return entry.promise;
    }
    const next = { at: Date.now(), result: null, promise: null };
    next.promise = fetchDocument(`/${context.repository}/commit/${target.sha}/status-details`, "json")
      .then((data) => readStatus(data, dates.get(target.key)))
      .then((result) => {
        next.result = result;
        next.at = Date.now();
        return result;
      });
    statuses.set(target.key, next);
    return next.promise;
  }

  function committedDate(context, target) {
    if (dates.has(target.key)) return Promise.resolve(dates.get(target.key));
    if (!lookups.has(target.key)) {
      lookups.set(target.key, (async () => {
        if (!catalogs.has(context.key)) {
          catalogs.set(context.key, fetchDocument(`/${context.key}/commits`).then((doc) => {
            if (doc) readDates(doc, context);
          }));
        }
        await catalogs.get(context.key);
        if (!dates.has(target.key)) {
          const doc = await fetchDocument(`/${context.repository}/commit/${target.sha}`);
          if (doc) readDates(doc, context, target.sha);
        }
        return dates.get(target.key) || null;
      })());
    }
    return lookups.get(target.key);
  }

  function formatDate(iso) {
    const date = new Date(iso);
    const age = Date.now() - date.getTime();
    const pad = (number) => String(number).padStart(2, "0");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const localDate = `${months[date.getMonth()]} ${date.getDate()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    if (age >= 0 && age < 60 * 60 * 1000) {
      const minutes = Math.floor(age / (60 * 1000));
      return `${minutes} min ago, ${localDate}`;
    }
    if (age >= 0 && age < 24 * 60 * 60 * 1000) {
      const hours = Math.floor(age / (60 * 60 * 1000));
      return `${hours} hr ago, ${localDate}`;
    }
    return localDate;
  }

  function removeRecord(record) {
    record.time?.remove();
    record.status?.remove();
    if (record.group?.parentNode) {
      const parent = record.group.parentNode;
      while (record.group.firstChild) parent.insertBefore(record.group.firstChild, record.group);
      record.group.remove();
    }
    records.delete(record.anchor);
  }

  function isCurrent(record) {
    const context = pullRequest();
    if (!record.anchor.isConnected || context?.key !== record.context.key || records.get(record.anchor) !== record) return false;
    const target = hashTarget(record.anchor, context);
    return target?.sha === record.sha && target.node === record.node;
  }

  function annotate(record, iso) {
    if (!iso || record.time || !isCurrent(record)) return;
    const time = document.createElement("time");
    time.className = "github-pr-commit-date";
    time.dateTime = iso;
    time.title = `Committer date: ${iso}`;
    time.textContent = formatDate(iso);
    if (record.node.tagName === "CODE") {
      const group = document.createElement("span");
      group.className = "github-pr-commit-date-group";
      record.node.before(group);
      group.append(record.node, time);
      record.group = group;
    } else {
      record.anchor.after(time);
    }
    record.time = time;
  }

  const STATUS_ICONS = {
    failed: "M2.343 13.657A8 8 0 1 1 13.658 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042L6.94 8 4.97 9.97a.749.749 0 0 0 .326 1.275.749.749 0 0 0 .734-.215L8 9.06l1.97 1.97a.749.749 0 0 0 1.275-.326.749.749 0 0 0-.215-.734L9.06 8l1.97-1.97a.749.749 0 0 0-.326-1.275.749.749 0 0 0-.734.215L8 6.94Z",
    running: "M8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z",
    passed: "M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm3.78-9.72a.751.751 0 0 0-.018-1.042.751.751 0 0 0-1.042-.018L6.75 9.19 5.28 7.72a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042l2 2a.75.75 0 0 0 1.06 0Z"
  };
  const STATUS_TITLES = { failed: "Failed checks", running: "Running checks", passed: "Passed checks" };

  function statusIcon(state) {
    const namespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(namespace, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(namespace, "path");
    path.setAttribute("d", STATUS_ICONS[state]);
    path.setAttribute("fill", "currentColor");
    svg.append(path);
    return svg;
  }

  function annotateStatus(record, result) {
    // Compare the shown checks too, so the tooltip and link follow checks that finish while the state stays the same.
    const signature = result?.state ? JSON.stringify([result.state, result.runs]) : null;
    if (!isCurrent(record) || (record.status && record.statusSignature === signature)) return;
    record.status?.remove();
    record.status = null;
    record.statusSignature = null;
    if (!signature) return;
    const { state, runs } = result;
    const first = runs.find((run) => run.url) || runs[0];
    const lines = runs.map((run) => `${run.name}: ${run.state.toLowerCase().replace(/_/g, " ")}`);
    const element = document.createElement(first.url ? "a" : "span");
    element.className = `github-pr-commit-ci github-pr-commit-ci-${state}`;
    element.title = `${STATUS_TITLES[state]}:\n${lines.join("\n")}`;
    element.setAttribute("aria-label", `${runs.length} ${STATUS_TITLES[state].toLowerCase()}: ${runs.map((run) => run.name).join(", ")}`);
    if (first.url) {
      element.href = first.url;
      element.target = "_blank";
      element.rel = "noopener noreferrer";
    }
    element.append(statusIcon(state));
    // A <code> hash sits inside its link, so the icon goes after the link to avoid nesting links.
    const after = record.node.tagName === "CODE" ? record.anchor : (record.time || record.anchor);
    after.after(element);
    record.status = element;
    record.statusSignature = signature;
  }

  function loadStatus(record, refresh = false) {
    return checkStatus(record.context, record, refresh).then((result) => annotateStatus(record, result));
  }

  function scan() {
    scanScheduled = false;
    const context = pullRequest();
    for (const record of records.values()) {
      if (!context || !isCurrent(record) || (record.time && !record.time.isConnected) ||
        (record.status && !record.status.isConnected)) removeRecord(record);
    }
    if (!context) return;
    readDates(document, context);
    for (const anchor of document.querySelectorAll("a[href]")) {
      const target = hashTarget(anchor, context);
      if (!target) continue;
      const existing = records.get(anchor);
      if (existing) {
        if (!existing.time && dates.has(target.key)) annotate(existing, dates.get(target.key));
        continue;
      }
      const record = { ...target, context, time: null, group: null, status: null, statusSignature: null };
      records.set(anchor, record);
      committedDate(context, target)
        .then((iso) => annotate(record, iso))
        .then(() => loadStatus(record));
    }
  }

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(scan, 50);
  }

  function refreshDates() {
    if (document.visibilityState !== "visible") return;
    for (const record of records.values()) {
      if (!isCurrent(record) || (record.time && !record.time.isConnected) ||
        (record.status && !record.status.isConnected)) {
        removeRecord(record);
        continue;
      }
      loadStatus(record, true);
      if (!record.time) continue;
      const label = formatDate(record.time.dateTime);
      if (record.time.textContent !== label) record.time.textContent = label;
    }
  }

  new MutationObserver(scheduleScan).observe(document.documentElement, {
    childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["href"]
  });
  for (const event of ["turbo:load", "turbo:render", "pjax:end", "soft-nav:end", "popstate"]) {
    addEventListener(event, scheduleScan);
  }
  window.navigation?.addEventListener("navigatesuccess", scheduleScan);
  setInterval(refreshDates, 60 * 1000);
  document.addEventListener("visibilitychange", refreshDates);
  scheduleScan();
})();
