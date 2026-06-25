/* SkillAudit - artifacts page client */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const fmt = {
    pct: (v) => v == null ? "-" : `${(v * 100).toFixed(0)}%`,
    pp:  (v) => v == null ? "-" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)} pp`,
    num: (v, d = 0) => v == null ? "-" : Number(v).toFixed(d),
    int: (v) => v == null ? "-" : Number(v).toLocaleString("en-US"),
    score: (v) => v == null ? "-" : Math.round(v),
    time: (v) => v == null ? "-" : `${v.toFixed(1)}s`,
  };

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const state = {
    index: null,         // { runs, skills, schema, frozen }
    stats: null,
    skillCache: new Map(),
    activeSkill: null,
    activeRunId: null,   // for the task viewer
  };

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  const fetchJson = async (url) => {
    const r = await fetch(url, { credentials: "omit" });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
    try {
      return await r.json();
    } catch (e) {
      throw new Error(`Malformed JSON from ${url}: ${e.message}`);
    }
  };

  async function boot() {
    try {
      const [index, stats] = await Promise.all([
        fetchJson("data/index.json"),
        fetchJson("data/stats.json"),
      ]);
      state.index = index;
      state.stats = stats;
    } catch (e) {
      console.error("Failed to load data", e);
      const el = $("#lens-empty");
      if (el) el.textContent = `Failed to load index/stats: ${e.message}`;
      return;
    }

    renderHeroStats();
    renderRunMatrix();
    wireLookup();
    wireBibtexCopy();
    handleHash(); // open from #skill=...
    window.addEventListener("hashchange", handleHash);
  }

  // ---------------------------------------------------------------------------
  // Hero stats
  // ---------------------------------------------------------------------------
  function renderHeroStats() {
    const s = state.stats;
    $("#m-skills").textContent = fmt.int(s.n_skills);
    $("#m-reports").textContent = fmt.int(s.n_reports);
    $("#m-runs").textContent = fmt.int(s.n_runs);
    $("#m-cats").textContent = fmt.int(s.n_categories);
    $("#m-judge").textContent = fmt.int(s.n_judge_items);
  }

  // ---------------------------------------------------------------------------
  // Run matrix
  // ---------------------------------------------------------------------------
  function renderRunMatrix() {
    const root = $("#run-matrix");
    root.innerHTML = "";
    state.index.runs.forEach((run, i) => {
      const tile = document.createElement("div");
      tile.className = "run-tile";
      const axisLabel = run.axis === "both" ? "utility + security" : run.axis;
      tile.innerHTML = `
        <span class="id">run #${String(i+1).padStart(2,"0")}</span>
        <div class="title">
          <span class="stack">${esc(run.harness)} × ${esc(run.model)}</span>
          <span class="axis-pill ${esc(run.axis)}">${esc(axisLabel)}</span>
        </div>
        <span class="meta-row"><code>${esc(run.id)}</code></span>
      `;
      root.appendChild(tile);
    });
    root.removeAttribute("aria-busy");
  }

  // ---------------------------------------------------------------------------
  // Lookup form (with debounce + keyboard navigation)
  // ---------------------------------------------------------------------------
  function wireLookup() {
    const form = $("#lookup-form");
    const input = $("#lookup-input");
    const opts = $("#lookup-options");

    const allSkills = state.index.skills;
    let currentMatches = [];
    let activeIdx = -1;
    let debounceTimer = null;

    const findMatches = (q) => {
      q = q.trim().toLowerCase();
      if (!q) return [];
      const exact = [], prefix = [], sub = [];
      for (const s of allSkills) {
        const n = s.name.toLowerCase();
        if (n === q) exact.push(s);
        else if (n.startsWith(q)) prefix.push(s);
        else if (n.includes(q)) sub.push(s);
      }
      return [...exact, ...prefix, ...sub].slice(0, 12);
    };

    const renderOptions = (matches) => {
      currentMatches = matches;
      activeIdx = matches.length ? 0 : -1;
      if (!matches.length) {
        opts.classList.remove("show");
        opts.innerHTML = "";
        input.setAttribute("aria-expanded", "false");
        input.removeAttribute("aria-activedescendant");
        return;
      }
      opts.innerHTML = matches.map((s, i) => `
        <div class="lookup-option${i === activeIdx ? " is-active" : ""}"
             id="lookup-opt-${i}"
             role="option"
             aria-selected="${i === activeIdx}"
             data-skill="${esc(s.name)}">
          <span class="name">${esc(s.name)}</span>
          <span class="meta">${esc(s.category || "-")} · ${esc(s.owner || "-")} · ${s.n_runs} runs</span>
        </div>
      `).join("");
      opts.classList.add("show");
      input.setAttribute("aria-expanded", "true");
      if (activeIdx >= 0) input.setAttribute("aria-activedescendant", `lookup-opt-${activeIdx}`);
    };

    const updateActive = (delta) => {
      if (!currentMatches.length) return;
      activeIdx = (activeIdx + delta + currentMatches.length) % currentMatches.length;
      $$(".lookup-option", opts).forEach((el, i) => {
        const on = i === activeIdx;
        el.classList.toggle("is-active", on);
        el.setAttribute("aria-selected", on);
      });
      input.setAttribute("aria-activedescendant", `lookup-opt-${activeIdx}`);
      const el = opts.children[activeIdx];
      if (el) el.scrollIntoView({ block: "nearest" });
    };

    const debouncedRender = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => renderOptions(findMatches(input.value)), 120);
    };

    input.addEventListener("input", debouncedRender);
    input.addEventListener("focus", () => { if (input.value) debouncedRender(); });
    input.addEventListener("blur", () => setTimeout(() => {
      opts.classList.remove("show");
      input.setAttribute("aria-expanded", "false");
    }, 120));

    input.addEventListener("keydown", (e) => {
      if (!opts.classList.contains("show") && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        debouncedRender();
        return;
      }
      switch (e.key) {
        case "ArrowDown": e.preventDefault(); updateActive(+1); break;
        case "ArrowUp":   e.preventDefault(); updateActive(-1); break;
        case "Enter":
          if (activeIdx >= 0 && currentMatches[activeIdx]) {
            e.preventDefault();
            selectSkill(currentMatches[activeIdx].name);
            opts.classList.remove("show");
            input.blur();
          }
          break;
        case "Escape":
          opts.classList.remove("show");
          input.setAttribute("aria-expanded", "false");
          input.blur();
          break;
      }
    });

    opts.addEventListener("mousedown", (e) => {
      // mousedown (not click) so we beat the input blur handler
      const tgt = e.target.closest(".lookup-option");
      if (tgt) {
        e.preventDefault();
        selectSkill(tgt.dataset.skill);
        opts.classList.remove("show");
        input.blur();
      }
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const matches = findMatches(input.value);
      if (matches[0]) selectSkill(matches[0].name);
    });

    $("#lookup-suggest").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-skill]");
      if (btn) selectSkill(btn.dataset.skill);
    });
  }

  // ---------------------------------------------------------------------------
  // Hash-based deep linking
  // ---------------------------------------------------------------------------
  function handleHash() {
    const skillMatch = location.hash.match(/^#skill=([^&]+)/);
    if (skillMatch) {
      selectSkill(decodeURIComponent(skillMatch[1]));
      return;
    }
    const qMatch = location.hash.match(/^#q=([^&]+)/);
    if (qMatch) {
      const q = decodeURIComponent(qMatch[1]).trim();
      if (!q) return;
      const exact = state.index.skills.find(s => s.name.toLowerCase() === q.toLowerCase());
      if (exact) {
        selectSkill(exact.name);
        return;
      }
      const input = $("#lookup-input");
      if (input) {
        input.value = q;
        input.focus();
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const form = $("#lookup-form");
        if (form) form.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Selecting a skill
  // ---------------------------------------------------------------------------
  async function selectSkill(name) {
    const meta = state.index.skills.find(s => s.name === name);
    if (!meta) {
      $("#lens-view").dataset.state = "empty";
      $("#lens-view").innerHTML = `<div class="lens-empty">No skill named "${esc(name)}" found in the artifact set.</div>`;
      return;
    }
    $("#lens-view").dataset.state = "loading";
    $("#lens-view").setAttribute("aria-busy", "true");
    $("#lens-view").innerHTML = `<div class="lens-empty">Loading ${esc(name)} …</div>`;

    let skill;
    if (state.skillCache.has(name)) {
      skill = state.skillCache.get(name);
    } else {
      try {
        skill = await fetchJson(meta.file);
        state.skillCache.set(name, skill);
      } catch (e) {
        $("#lens-view").innerHTML = `<div class="lens-empty">Failed to load ${esc(meta.file)} - ${esc(e.message)}</div>`;
        return;
      }
    }
    state.activeSkill = skill;

    // Pick first run that has utility_details for the task viewer
    const firstWithDetails = Object.entries(skill.runs).find(([, r]) => r.utility_details);
    state.activeRunId = firstWithDetails ? firstWithDetails[0]
                       : Object.keys(skill.runs)[0] || null;

    renderLens(skill);
    renderTask(skill);
    if (location.hash !== `#skill=${encodeURIComponent(name)}`) {
      history.replaceState(null, "", `#skill=${encodeURIComponent(name)}`);
    }
    document.getElementById("explorer").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------------------------------------------------------------------------
  // Lens view: per-run cards
  // ---------------------------------------------------------------------------
  function renderLens(skill) {
    const root = $("#lens-view");
    root.dataset.state = "ready";
    root.setAttribute("aria-busy", "false");

    const runEntries = state.index.runs
      .map(r => skill.runs[r.id] ? { meta: r, data: skill.runs[r.id] } : null)
      .filter(Boolean);

    const head = `
      <div class="lens-head">
        <div>
          <span class="name">${esc(skill.skill_name)}</span>
        </div>
        <div class="meta">
          <span class="pill">category <b>${esc(skill.category || "-")}</b></span>
          <span class="pill">owner <b>${esc(skill.owner || "-")}</b></span>
          <span class="pill">runs <b>${runEntries.length}</b></span>
        </div>
      </div>
    `;

    const cards = runEntries.map(({ meta, data }) => renderRunCard(meta, data)).join("");
    root.innerHTML = head + `<div class="lens-runs-grid">${cards}</div>`;
  }

  function renderRunCard(meta, data) {
    const u = data.utility;
    const s = data.security;

    let body = "";
    if (u) {
      const total = u.total_items || 0;
      const woPct = total ? Math.round((u.wo_passed || 0) / total * 100) : 0;
      const wiPct = total ? Math.round((u.wi_passed || 0) / total * 100) : 0;
      const tone = (u.pass_rate_gain ?? 0) > 0.05 ? "good"
                 : (u.pass_rate_gain ?? 0) < -0.05 ? "bad"
                 : "neutral";
      body += `
        <div class="rc-chart">
          <div class="rc-bar"><span class="k">without</span><span class="track"><i style="width:${woPct}%"></i></span><b>${woPct}%</b></div>
          <div class="rc-bar"><span class="k">with skill</span><span class="track wi"><i style="width:${wiPct}%"></i></span><b>${wiPct}%</b></div>
          <div class="rc-gain tone-${tone}"><b>${fmt.pp(u.pass_rate_gain)}</b><span>gain · ${fmt.int(u.wi_passed)}/${fmt.int(total)} vs ${fmt.int(u.wo_passed)}/${fmt.int(total)} passed</span></div>
        </div>
        <div class="rc-sub">efficiency ${u.efficiency_score == null ? "n/a" : fmt.num(u.efficiency_score, 2)} · ${fmt.time(u.wi_time)} with / ${fmt.time(u.wo_time)} without</div>
      `;
    }
    const sBs = s ? (s.by_severity || {}) : {};
    const sTotalFindings = (sBs.H || 0) + (sBs.M || 0) + (sBs.L || 0);
    const sHasData = s && (s.score != null || sTotalFindings > 0 || (s.dynamic && s.dynamic.total > 0));
    if (sHasData) {
      const tone = (s.score ?? 100) >= 90 ? "good"
                 : (s.score ?? 100) >= 60 ? "warn"
                 : "bad";
      const bs = sBs;
      const totalFindings = sTotalFindings;
      const score = s.score == null ? 0 : Math.round(s.score);
      const dots = ["H", "M", "L"].map(k => (bs[k] || 0) ? `<span class="fd fd-${k}">${bs[k]} ${k}</span>` : "").join("");
      body += `
        <div class="rc-chart" style="margin-top:${u ? "12px" : "0"};">
          <div class="rc-bar"><span class="k">security</span><span class="track"><i class="tone-${tone}" style="width:${score}%"></i></span><b>${score}/100</b></div>
          <div class="rc-find">${totalFindings === 0
            ? `<span class="fd clean">No findings</span>`
            : `${dots} <span class="fdl">flagged · ${s.dynamic?.total ?? 0} dynamic tests</span>`}</div>
        </div>
      `;
    }
    if (!u && !sHasData) {
      body = `<div class="rc-none">No measurements in this run.</div>`;
    }

    const axisLabel = meta.axis === "both" ? "utility + security" : meta.axis;
    return `
      <div class="run-card">
        <div class="run-head">
          <span class="stack">${esc(meta.harness)} × ${esc(meta.model)}</span>
          <span class="axis-pill ${esc(meta.axis)}">${esc(axisLabel)}</span>
        </div>
        ${body}
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Task view
  // ---------------------------------------------------------------------------
  function renderTask(skill) {
    const root = $("#task-view");
    root.dataset.state = "ready";

    const runsWithDetails = Object.entries(skill.runs).filter(([, r]) => r.utility_details);
    if (!runsWithDetails.length) {
      root.dataset.state = "empty";
      root.innerHTML = `<div class="task-empty">No utility task data for "${esc(skill.skill_name)}" - only security runs evaluated this skill.</div>`;
      return;
    }

    if (!runsWithDetails.find(([id]) => id === state.activeRunId)) {
      state.activeRunId = runsWithDetails[0][0];
    }

    const runOptions = runsWithDetails.map(([id, r]) =>
      `<option value="${esc(id)}" ${id === state.activeRunId ? "selected" : ""}>${esc(r.harness)} × ${esc(r.model)}</option>`
    ).join("");

    const activeRun = skill.runs[state.activeRunId];
    const scenariosHTML = (activeRun.utility_details || []).map(scn => renderScenario(scn)).join("");

    root.innerHTML = `
      <div class="task-shell">
        <div class="task-shell-head">
          <span class="left">Judge sheet · <b>${esc(skill.skill_name)}</b></span>
          <span>
            run
            <select id="task-run-select" aria-label="Switch run">
              ${runOptions}
            </select>
          </span>
        </div>
        <div class="task-scenarios">${scenariosHTML}</div>
      </div>
    `;
    $("#task-run-select").addEventListener("change", (e) => {
      state.activeRunId = e.target.value;
      renderTask(state.activeSkill);
    });
  }

  function renderScenario(scn) {
    const total = scn.total_items ?? (scn.items?.length ?? 0);
    const wi = scn.wi_passed_items ?? 0;
    const wo = scn.wo_passed_items ?? 0;
    const delta = wi - wo;
    const woPct = total ? Math.round(wo / total * 100) : 0;
    const wiPct = total ? Math.round(wi / total * 100) : 0;
    const tag = delta > 0 ? `<span class="delta-tag gain">+${delta} fixed</span>`
              : delta === 0 ? `<span class="delta-tag tied">no change</span>`
              : `<span class="delta-tag loss">${delta} regression${delta===-1?"":"s"}</span>`;
    const items = (scn.items || []).map(it => renderJudgeItem(it)).join("");
    return `
      <div class="scenario-block">
        <div class="scenario-block-head">
          <span class="id">${esc(scn.scenario_id || "U?")}</span>
          <div class="scn-bars">
            <div class="scn-bar"><span class="k">without</span><span class="track"><i style="width:${woPct}%"></i></span><b>${wo}/${total}</b></div>
            <div class="scn-bar"><span class="k">with skill</span><span class="track wi"><i style="width:${wiPct}%"></i></span><b>${wi}/${total}</b></div>
          </div>
          ${tag}
        </div>
        <div class="judge-list">${items}</div>
      </div>
    `;
  }

  function renderJudgeItem(it) {
    const wiPass = it.wi_score === 1;
    const woPass = it.wo_score === 1;
    const changed = wiPass !== woPass;
    const dot = (pass, muted) => `<span class="jdot ${muted ? "mut" : (pass ? "pass" : "fail")}">${pass ? "✓" : "✗"}</span>`;
    const label = !changed ? (wiPass ? "kept" : "fails") : (wiPass ? "fixed" : "regression");
    const labelCls = !changed ? "mut" : (wiPass ? "gain" : "loss");
    return `
      <details class="ji">
        <summary class="ji-row">
          <span class="jid">${esc(it.item_id || "")}</span>
          <span class="ji-trans">${dot(woPass, !changed)}<span class="ji-arrow">→</span>${dot(wiPass, !changed)}</span>
          <span class="ji-crit">${esc(it.criterion || "")}</span>
          <span class="ji-tag ${labelCls}">${label}</span>
          <span class="ji-chev"></span>
        </summary>
        <div class="ji-detail">
          <div class="ji-side">
            <div class="ji-side-h">with skill <span class="ji-badge ${wiPass ? "pass" : "fail"}">${wiPass ? "pass" : "fail"}</span></div>
            <div class="ji-reason">${esc(it.wi_reason || "")}</div>
          </div>
          <div class="ji-side">
            <div class="ji-side-h">without <span class="ji-badge ${woPass ? "pass" : "fail"}">${woPass ? "pass" : "fail"}</span></div>
            <div class="ji-reason">${esc(it.wo_reason || "")}</div>
          </div>
        </div>
      </details>
    `;
  }

  // ---------------------------------------------------------------------------
  // Bibtex copy
  // ---------------------------------------------------------------------------
  function wireBibtexCopy() {
    const btn = $("#copy-bib");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      const text = $("#bibtex").textContent;
      try {
        await navigator.clipboard.writeText(text);
        const orig = btn.textContent;
        btn.textContent = "Copied ✓";
        setTimeout(() => { btn.textContent = orig; }, 1400);
      } catch {
        btn.textContent = "Copy failed";
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Util
  // ---------------------------------------------------------------------------
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  // ---------------------------------------------------------------------------
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
