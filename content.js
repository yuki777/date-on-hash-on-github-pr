(() => {
  "use strict";

  const dates = new Map();
  const catalogs = new Map();
  const lookups = new Map();
  const records = new Map();
  const requests = [];
  let activeRequests = 0;
  let scanScheduled = false;

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
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:commit|pull\/(\d+)\/commits)\/([a-f0-9]{40})\/?$/i);
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
      const { path, resolve } = requests.shift();
      activeRequests += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      fetch(path, { credentials: "same-origin", signal: controller.signal, headers: { Accept: "text/html" } })
        .then(async (response) => {
          if (!response.ok || new URL(response.url).origin !== location.origin) return null;
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

  function fetchDocument(path) {
    return new Promise((resolve) => {
      requests.push({ path, resolve });
      drainRequests();
    });
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

  function scan() {
    scanScheduled = false;
    const context = pullRequest();
    for (const record of records.values()) {
      if (!context || !isCurrent(record) || (record.time && !record.time.isConnected)) removeRecord(record);
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
      const record = { ...target, context, time: null, group: null };
      records.set(anchor, record);
      committedDate(context, target).then((iso) => annotate(record, iso));
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
      if (!isCurrent(record) || (record.time && !record.time.isConnected)) {
        removeRecord(record);
        continue;
      }
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
