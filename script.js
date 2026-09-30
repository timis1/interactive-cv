// The page content comes from data/public.json (always visible) and data/private.enc.json (encrypted, opened with a
// personal access link) and is rendered through the <template> blocks in index.html.
// You don't need to edit this file to add experience, certifications, projects or skills. See README.md.

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => root.querySelectorAll(s);

const ACCESS_STORAGE_KEY = "cv-access";
const REQUEST_SENT_KEY = "cv-access-requested";

// ---------- Tiny template engine ----------
const isEmpty = (v) => v === undefined || v === null || v === "" || v === false || (Array.isArray(v) && v.length === 0);
const valueOf = (item, key) => (key === "." ? item : item?.[key]);

// Fills one cloned template element (and its children) with the values of `item`.
function fill(el, item) {
  const d = el.dataset;
  if (d.if !== undefined && isEmpty(valueOf(item, d.if))) return el.remove(), null;
  if (d.unless !== undefined && !isEmpty(valueOf(item, d.unless))) return el.remove(), null;
  if (d.field) el.textContent = valueOf(item, d.field) ?? "";
  if (d.class && !isEmpty(valueOf(item, d.class))) el.classList.add(...String(valueOf(item, d.class)).split(/\s+/));
  if (d.attr)
    d.attr.split(";").forEach((pair) => {
      const [attr, key] = pair.split("=").map((s) => s.trim());
      const v = valueOf(item, key);
      if (!isEmpty(v)) el.setAttribute(attr, v);
    });
  if (d.icon) {
    const icon = document.getElementById("icon-" + valueOf(item, d.icon)) || document.getElementById("icon-link");
    el.appendChild(icon.content.cloneNode(true));
  }
  const each = d.each;
  ["field", "class", "attr", "icon", "if", "unless", "each"].forEach((k) => el.removeAttribute("data-" + k));

  if (each) {
    const proto = el.firstElementChild;
    el.replaceChildren();
    if (proto)
      (valueOf(item, each) || []).forEach((sub) => {
        const node = fill(proto.cloneNode(true), sub);
        if (node) el.appendChild(node);
      });
  } else {
    [...el.children].forEach((child) => fill(child, item));
  }
  return el;
}

function render(container, templateId, items) {
  const tpl = document.getElementById(templateId);
  $(container).replaceChildren(...items.map((item) => fill(tpl.content.firstElementChild.cloneNode(true), item)).filter(Boolean));
}
// ---------- Helpers ----------
const waLink = (phone, text = "") => `https://wa.me/${phone.replace(/\D/g, "")}${text ? "?text=" + encodeURIComponent(text) : ""}`;
const fmtPhone = (p) => p.replace(/^\+40(\d{3})(\d{3})(\d{3})$/, "+40 $1 $2 $3").replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "+1 ($1) $2-$3");
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-");

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2200);
}

function setupFilters(container, values, onChange) {
  render(container, "tpl-filter", values);
  const box = $(container);
  box.firstElementChild?.classList.add("active");
  box.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    $$("button", box).forEach((b) => b.classList.toggle("active", b === btn));
    onChange(btn.dataset.value);
  });
}

// ---------- Load data ----------
class AccessError extends Error {}

async function fetchJson(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw Object.assign(new Error(`${path}: HTTP ${res.status}`), { status: res.status });
  try { return await res.json(); }
  catch (err) { throw new Error(`${path} is not valid JSON (${err.message})`); }
}

const fromBase64 = (s) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(s + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
};
async function aesDecrypt(rawKey, { iv, data }) {
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, key, fromBase64(data)));
}

// Accepts a full personal link, "#access=…" or the bare "id.code".
function parseAccessCode(text) {
  const m = String(text).trim().match(/(?:access=)?([0-9a-f]{12}\.[A-Za-z0-9_-]{43})(?![\w-])/);
  return m ? m[1] : null;
}

// The access code decrypts this person's copy of the content key, which then decrypts the private CV.
async function openPrivateCV(accessCode) {
  if (!crypto.subtle) throw new Error("This page must be opened over https to show the private CV.");
  const [id, code] = accessCode.split(".");
  let grants, content;
  try { [grants, content] = await Promise.all([fetchJson("data/access.json"), fetchJson("data/private.enc.json")]); }
  catch (err) { if (err.status === 404) throw new AccessError("The private CV hasn't been published yet."); throw err; }
  const grant = grants.find((g) => g.id === id);
  if (!grant) throw new AccessError("This access link is invalid or has been revoked.");
  let contentKey;
  try { contentKey = await aesDecrypt(fromBase64(code), grant); }
  catch { throw new AccessError("This access link is invalid or has been revoked."); }
  return JSON.parse(new TextDecoder().decode(await aesDecrypt(contentKey, content)));
}

function showLoadError(err) {
  console.error(err);
  const local = location.protocol === "file:";
  document.body.insertAdjacentHTML("afterbegin", `<div class="load-error"><strong>Could not load CV data.</strong> ${
    local ? "Browsers block data files on pages opened directly from disk. Run <code>py -m http.server</code> in this folder and open <code>http://localhost:8000</code>." : ""
  }<br /><small></small></div>`);
  $(".load-error small").textContent = err.message;
}

async function boot() {
  let pub;
  try { pub = await fetchJson("data/public.json"); }
  catch (err) { return showLoadError(err); }
  initPublic(pub);

  const fromLink = parseAccessCode(location.hash);
  if (fromLink) history.replaceState(null, "", location.pathname + location.search);
  const code = fromLink || localStorage.getItem(ACCESS_STORAGE_KEY);
  if (code) {
    try { return await unlock(pub, code); }
    catch (err) {
      console.error(err);
      if (!fromLink) localStorage.removeItem(ACCESS_STORAGE_KEY);
      return showLocked(pub, err instanceof AccessError ? err.message : `Could not open the CV: ${err.message}`);
    }
  }
  showLocked(pub);
}

async function unlock(pub, code) {
  const priv = await openPrivateCV(code);
  localStorage.setItem(ACCESS_STORAGE_KEY, code);
  document.body.classList.remove("locked");
  init({ ...pub, ...priv.profile, skills: priv.skills, experience: priv.experience, certifications: priv.certifications, projects: priv.projects, photo: priv.photo });
}

boot();

// ---------- Locked view: access request & access code ----------
function showLocked(pub, error = "") {
  const box = $("#unlock");
  box.hidden = false;
  $("#unlock-error").textContent = error;
  const linkedin = pub.links.find((l) => l.icon === "linkedin");
  if (linkedin) { $("#request-linkedin").href = linkedin.url; $("#linkedin-note").hidden = false; }

  const formUrl = /^https:\/\/formspree\.io\/f\/[\w-]+$/.test(pub.accessRequestForm || "") ? pub.accessRequestForm : null;
  const form = $("#request-form");
  if (!formUrl) form.hidden = true;
  else if (localStorage.getItem(REQUEST_SENT_KEY)) showRequestSent();
  const captcha = formUrl && pub.recaptchaSiteKey ? loadCaptcha(pub.recaptchaSiteKey) : null;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (captcha && !window.grecaptcha?.getResponse(captcha.widget)) {
      $("#unlock-error").textContent = "Please tick \"I'm not a robot\" first.";
      return;
    }
    const btn = $("button", form);
    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
      const data = new FormData(form);
      data.append("_subject", `CV access request from ${data.get("name")}`);
      const res = await fetch(formUrl, { method: "POST", body: data, headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).errors?.map((x) => x.message).join(", ") || `HTTP ${res.status}`);
      localStorage.setItem(REQUEST_SENT_KEY, "1");
      $("#unlock-error").textContent = "";
      showRequestSent();
    } catch (err) {
      $("#unlock-error").textContent = `The request could not be sent (${err.message}). Please try again later or use LinkedIn.`;
      if (captcha) window.grecaptcha?.reset(captcha.widget);
    } finally {
      btn.disabled = false;
      btn.textContent = "Request access";
    }
  });

  $("#code-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = parseAccessCode($("#access-code").value);
    if (!code) return ($("#unlock-error").textContent = "That doesn't look like a valid access link.");
    try { await unlock(pub, code); }
    catch (err) { $("#unlock-error").textContent = err instanceof AccessError ? err.message : `Could not open the CV: ${err.message}`; }
  });
}

$("#lockBtn").addEventListener("click", () => {
  localStorage.removeItem(ACCESS_STORAGE_KEY);
  location.replace(location.pathname);
});

function showRequestSent() {
  $("#request-form").hidden = true;
  $("#request-done").hidden = false;
}
$("#request-again").addEventListener("click", () => {
  localStorage.removeItem(REQUEST_SENT_KEY);
  $("#request-form").hidden = false;
  $("#request-done").hidden = true;
});

// Google reCAPTCHA v2 checkbox, verified by Formspree with your secret key (see README).
function loadCaptcha(siteKey) {
  const state = { widget: null };
  window.onCaptchaReady = () => {
    state.widget = grecaptcha.render("captcha", {
      sitekey: siteKey,
      theme: document.documentElement.dataset.theme,
      size: window.innerWidth < 420 ? "compact" : "normal",
    });
  };
  const s = document.createElement("script");
  s.src = "https://www.google.com/recaptcha/api.js?onload=onCaptchaReady&render=explicit";
  s.async = true;
  document.head.appendChild(s);
  return state;
}

// ---------- Page ----------
function initPublic(pub) {
  const parts = pub.name.split(" ");
  document.title = `${pub.name} — ${pub.roles[0]}`;
  $("#logo").textContent = parts[0][0] + parts[parts.length - 1][0];
  $("#name").textContent = pub.name;
  $("#typed").dataset.roles = pub.roles.join(" · ");
  $("#footer").textContent = `© ${new Date().getFullYear()} ${pub.name}`;
  render("#hero-social", "tpl-social", pub.links);
  startTyping(pub.roles);
}

function init(CV) {
  window.CV = CV;
  const works = CV.experience.filter((x) => x.type === "work");

  // Hero & about
  if (CV.photo) $("#photo").src = CV.photo;
  $("#about-text").textContent = CV.about;
  $("#footer").innerHTML = `© ${new Date().getFullYear()} <span></span> · Press <kbd>\`</kbd> to open the terminal`;
  $("#footer span").textContent = CV.name;

  render("#hero-social", "tpl-social", [
    ...CV.links,
    { name: "Email", url: `mailto:${CV.email}`, icon: "email" },
    ...CV.phones.slice(0, 1).map((p) => ({ name: "WhatsApp", url: waLink(p), icon: "whatsapp", cls: "wa" })),
  ]);

  const years = Math.floor((Date.now() - new Date(CV.careerStart)) / (365.25 * 24 * 3600 * 1000));
  const companies = new Set(works.map((x) => x.company.split(" · ")[0]));
  render("#stats", "tpl-stat", [
    { value: years, suffix: "+", label: "Years of experience" },
    { value: CV.certifications.length, label: "Certifications" },
    { value: companies.size, label: "Companies" },
    { value: CV.projects.length, label: "Projects & hackathons" },
  ]);
  render("#languages", "tpl-language", CV.languages);
  render("#soft-skills", "tpl-chip", CV.softSkills);
  render("#community", "tpl-text-item", CV.community);

  // Skills
  render("#skill-list", "tpl-skill-group", CV.skills);
  setupFilters("#skill-filters", [{ label: "All", value: "*" }, ...CV.skills.map((s) => ({ label: s.category, value: s.category }))], (cat) =>
    $$(".skill-group").forEach((el) => el.classList.toggle("hide", cat !== "*" && el.dataset.cat !== cat))
  );
  $("#skill-list").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (chip) showSkillUsage(chip);
  });
  $("#skill-usage").addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    e.preventDefault();
    if (a.dataset.exp) focusExperience(+a.dataset.exp);
    else searchProjects(a.dataset.proj, true);
  });

  // Timeline
  render("#timeline", "tpl-experience", CV.experience);
  $$("#timeline .item").forEach((el, i) => (el.dataset.idx = i));
  $("#timeline").addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    e.target.closest(".item")?.classList.toggle("open");
  });
  const types = [...new Set(CV.experience.map((x) => x.type))];
  const typeLabel = (t) => ({ work: "Work", education: "Education" }[t] || t[0].toUpperCase() + t.slice(1));
  setupFilters("#timeline-filters", [{ label: "All", value: "*" }, ...types.map((t) => ({ label: typeLabel(t), value: t }))], (type) =>
    $$("#timeline .item").forEach((el) => el.classList.toggle("hide", type !== "*" && el.dataset.type !== type))
  );
  $("#expandAll").addEventListener("click", (e) => {
    e.preventDefault();
    const items = [...$$("#timeline .item")];
    const open = !items.every((i) => i.classList.contains("open"));
    items.forEach((i) => i.classList.toggle("open", open));
    e.target.textContent = open ? "Collapse all" : "Expand all";
  });

  // Certifications
  render("#cert-list", "tpl-certification", CV.certifications.map((c) => ({
    ...c,
    initial: c.issuer[0].toUpperCase(),
    issuerKey: slug(c.issuer),
    badgeStyle: c.color ? `background:${c.color}` : "",
  })));
  const issuers = [...new Set(CV.certifications.map((c) => c.issuer))];
  setupFilters("#cert-filters", [
    { label: "All", value: "*" },
    ...issuers.map((i) => ({ label: `${i} (${CV.certifications.filter((c) => c.issuer === i).length})`, value: i })),
  ], (iss) => $$(".cert").forEach((el) => el.classList.toggle("hide", iss !== "*" && el.dataset.issuer !== iss)));

  // Projects
  renderProjects();
  $("#project-search").addEventListener("input", (e) => renderProjects(e.target.value));
  $("#project-list").addEventListener("click", (e) => {
    const tag = e.target.closest(".tag");
    if (tag) searchProjects(tag.dataset.tag);
  });
  $("#project-list").addEventListener("mousemove", (e) => {
    const card = e.target.closest(".card");
    if (!card) return;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    card.style.transform = `perspective(600px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg) translateY(-4px)`;
  });
  $("#project-list").addEventListener("mouseout", (e) => {
    const card = e.target.closest(".card");
    if (card && !card.contains(e.relatedTarget)) card.style.transform = "";
  });

  // Contact
  render("#contact-cards", "tpl-contact-card", [
    { title: "Email", subtitle: CV.email, icon: "email", url: "#", action: "copy-email" },
    ...CV.phones.map((p) => ({ title: "WhatsApp", subtitle: fmtPhone(p), icon: "whatsapp", url: waLink(p), cls: "wa" })),
    ...CV.links.map((l) => ({ title: l.name, subtitle: "View profile ↗", icon: l.icon, url: l.url })),
  ]);
  $('[data-action="copy-email"]').removeAttribute("target");
  $('[data-action="copy-email"]').title = "Click to copy";
  $("#contact-cards").addEventListener("click", (e) => {
    if (e.target.closest('[data-action="copy-email"]')) { e.preventDefault(); copyEmail(); }
  });
  $("#contact-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    location.href = `mailto:${CV.email}?subject=${encodeURIComponent(f.get("subject"))}&body=${encodeURIComponent(f.get("message"))}`;
    toast("Opening your email client…");
  });
  $("#sendWhatsapp").addEventListener("click", () => {
    const form = $("#contact-form");
    if (!form.reportValidity()) return;
    const f = new FormData(form);
    window.open(waLink(CV.phones[0], `${f.get("subject")}\n\n${f.get("message")}`), "_blank");
  });

  setupScroll();
  setupTerminal(CV);

  // Content is loaded asynchronously, so jump to a #section link only once it exists.
  if (location.hash.length > 1) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

// ---------- Skills usage ----------
function showSkillUsage(chip) {
  const box = $("#skill-usage");
  const wasActive = chip.classList.contains("active");
  $$("#skill-list .chip").forEach((c) => c.classList.remove("active"));
  if (wasActive) return box.classList.remove("show");
  chip.classList.add("active");

  const skill = chip.dataset.skill;
  const has = (tags = []) => tags.some((t) => t.toLowerCase() === skill.toLowerCase());
  const makeLink = (text, attr, value) => {
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = text;
    a.setAttribute(attr, value);
    return a;
  };
  const links = [
    ...CV.experience.map((x, i) => ({ x, i })).filter(({ x }) => has(x.tags))
      .map(({ x, i }) => makeLink(`💼 ${x.title} · ${x.company.split(" · ")[0]}`, "data-exp", i)),
    ...CV.projects.filter((p) => has(p.tags)).map((p) => makeLink(`🚀 ${p.title}`, "data-proj", p.title)),
  ];

  const title = document.createElement("strong");
  title.textContent = skill;
  const text = document.createTextNode(links.length ? " was used in:" : " is part of my toolbox from studies and personal learning.");
  const list = document.createElement("div");
  list.className = "usage-list";
  list.append(...links);
  box.replaceChildren(title, text, list);
  box.classList.add("show");
}

function focusExperience(i) {
  const el = $(`#timeline .item[data-idx="${i}"]`);
  el.classList.remove("hide");
  el.classList.add("open", "flash");
  el.scrollIntoView({ block: "center" });
  setTimeout(() => el.classList.remove("flash"), 1600);
}

// ---------- Projects ----------
function renderProjects(q = "") {
  q = q.toLowerCase().trim();
  const list = CV.projects.filter((p) => [p.title, p.description, ...(p.tags || [])].some((f) => f.toLowerCase().includes(q)));
  if (list.length) render("#project-list", "tpl-project", list);
  else {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = `No projects match "${q}".`;
    $("#project-list").replaceChildren(p);
  }
}
function searchProjects(text, scroll = false) {
  $("#project-search").value = text;
  renderProjects(text);
  if (scroll) $("#projects").scrollIntoView();
}

async function copyEmail() {
  try {
    await navigator.clipboard.writeText(CV.email);
    toast("Email copied to clipboard ✔");
  } catch {
    toast(CV.email);
  }
}

// ---------- Typing effect ----------
function startTyping(roles) {
  (function type(i = 0, j = 0, deleting = false) {
    const word = roles[i];
    $("#typed").textContent = word.slice(0, j);
    if (!deleting && j === word.length) return setTimeout(() => type(i, j, true), 1500);
    if (deleting && j === 0) return setTimeout(() => type((i + 1) % roles.length, 0, false), 300);
    setTimeout(() => type(i, j + (deleting ? -1 : 1), deleting), deleting ? 40 : 90);
  })();
}

// ---------- Scroll: reveal, counters, progress, active nav, back to top ----------
function animateCounters() {
  $$(".stat-num").forEach((el) => {
    const target = +el.dataset.value;
    const start = performance.now();
    (function step(now) {
      const p = Math.min(1, (now - start) / 1200);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))) + (p === 1 ? el.dataset.suffix || "" : "");
      if (p < 1) requestAnimationFrame(step);
    })(start);
  });
}

function setupScroll() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add("visible");
      if (en.target.id === "about") animateCounters();
      observer.unobserve(en.target);
    });
  }, { threshold: 0.1 });
  $$(".reveal").forEach((s) => observer.observe(s));

  window.addEventListener("scroll", () => {
    const h = document.documentElement;
    $("#progress").style.width = (h.scrollTop / (h.scrollHeight - h.clientHeight)) * 100 + "%";
    $("#toTop").classList.toggle("show", h.scrollTop > 600);
    let current = "";
    $$("section").forEach((s) => { if (h.scrollTop >= s.offsetTop - 120) current = s.id; });
    $$(".nav-links a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + current));
  });
}
$("#toTop").addEventListener("click", () => window.scrollTo({ top: 0 }));
function setMenuOpen(open) {
  $("#nav-links").classList.toggle("open", open);
  $("#menuBtn").setAttribute("aria-expanded", String(open));
}
$("#menuBtn").addEventListener("click", () => setMenuOpen(!$("#nav-links").classList.contains("open")));
$("#nav-links").addEventListener("click", () => setMenuOpen(false));
window.addEventListener("resize", () => {
  if (window.innerWidth > 860) setMenuOpen(false);
});

// ---------- Theme ----------
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  $("#themeBtn").textContent = t === "dark" ? "☀" : "☾";
  localStorage.setItem("theme", t);
}
setTheme(localStorage.getItem("theme") || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
const toggleTheme = () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
$("#themeBtn").addEventListener("click", toggleTheme);

// ---------- Save as PDF (browser print dialog) ----------
// Filters, search and collapsed entries are reset for printing so the PDF contains the full CV.
let beforePrintState = null;
function preparePrint() {
  if (beforePrintState || !window.CV) return;
  beforePrintState = {
    title: document.title,
    search: $("#project-search").value,
    open: [...$$("#timeline .item")].map((i) => i.classList.contains("open")),
  };
  document.title = `${CV.name.replace(/\s+/g, "-")}-CV`;
  $$(".reveal").forEach((s) => s.classList.add("visible"));
  $$("#timeline .item").forEach((i) => i.classList.add("open"));
  if (beforePrintState.search) renderProjects();
}
function restoreAfterPrint() {
  if (!beforePrintState) return;
  const s = beforePrintState;
  beforePrintState = null;
  document.title = s.title;
  $$("#timeline .item").forEach((i, idx) => i.classList.toggle("open", s.open[idx]));
  if (s.search) renderProjects(s.search);
}
window.addEventListener("beforeprint", preparePrint);
window.addEventListener("afterprint", restoreAfterPrint);
function printCV() {
  preparePrint();
  toast("Choose \"Save as PDF\" as the printer");
  setTimeout(() => window.print(), 300);
}
$("#pdfBtn").addEventListener("click", printCV);

// ---------- Animated particle background ----------
(function particles() {
  const c = $("#bg"), ctx = c.getContext("2d");
  let pts = [], mouse = { x: -999, y: -999 };
  function resize() {
    c.width = c.offsetWidth; c.height = c.offsetHeight;
    pts = Array.from({ length: Math.min(90, Math.floor(c.width / 15)) }, () => ({
      x: Math.random() * c.width, y: Math.random() * c.height,
      vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.5) * 0.6,
    }));
  }
  c.parentElement.addEventListener("mousemove", (e) => {
    const r = c.getBoundingClientRect();
    mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
  });
  c.parentElement.addEventListener("mouseleave", () => (mouse = { x: -999, y: -999 }));
  window.addEventListener("resize", resize);
  resize();
  (function draw() {
    const color = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = ctx.strokeStyle = color;
    for (const p of pts) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > c.width) p.vx *= -1;
      if (p.y < 0 || p.y > c.height) p.vy *= -1;
      const dm = Math.hypot(p.x - mouse.x, p.y - mouse.y);
      if (dm < 120 && dm > 0) { p.x += (p.x - mouse.x) / dm; p.y += (p.y - mouse.y) / dm; }
      ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fill();
    }
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
        if (d < 110) {
          ctx.globalAlpha = 1 - d / 110;
          ctx.lineWidth = 0.5;
          ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke();
        }
      }
    requestAnimationFrame(draw);
  })();
})();

// ---------- Mini terminal ----------
function setupTerminal(CV) {
  const term = $("#terminal"), out = $("#terminal-out"), input = $("#terminal-input");
  const history = [];
  let hIdx = 0;
  const print = (txt) => { out.textContent += txt + "\n"; out.scrollTop = out.scrollHeight; };
  const linkKey = (l) => l.name.split(" ")[0].toLowerCase();
  const commands = {
    help: () => [
      "whoami         short bio",
      "skills         skills by category",
      "experience     work history",
      "education      degrees",
      "certs          certifications",
      "projects       projects & hackathons",
      "contact        email & WhatsApp",
      "whatsapp       open a WhatsApp chat",
      "email          copy email address",
      "open <name>    open " + CV.links.map(linkKey).join(" | "),
      "goto <section> scroll to a section",
      "pdf            save this page as a PDF",
      "theme | print | clear | exit",
    ].join("\n"),
    whoami: () => `${CV.name} — ${CV.roles.join(" · ")}\n${CV.about}`,
    about: () => commands.whoami(),
    skills: () => CV.skills.map((g) => `${g.category.padEnd(16)} ${g.items.join(", ")}`).join("\n"),
    experience: () => CV.experience.filter((x) => x.type === "work").map((x) => `${x.period.padEnd(22)} ${x.title} @ ${x.company}`).join("\n"),
    education: () => CV.experience.filter((x) => x.type === "education").map((x) => `${x.period.padEnd(22)} ${x.title}\n${"".padEnd(23)}${x.company}`).join("\n"),
    certs: () => CV.certifications.map((c) => `✔ ${c.name} (${c.issuer})`).join("\n"),
    projects: () => CV.projects.map((p) => `• ${p.title} — ${p.description}`).join("\n"),
    contact: () => [`Email:    ${CV.email}`, ...CV.phones.map((p) => `WhatsApp: ${fmtPhone(p)}`), ...CV.links.map((l) => `${l.name}: ${l.url}`)].join("\n"),
    whatsapp: () => { window.open(waLink(CV.phones[0]), "_blank"); return "Opening WhatsApp…"; },
    email: () => { copyEmail(); return CV.email; },
    open: (arg) => {
      const link = arg && CV.links.find((l) => linkKey(l).startsWith(arg.toLowerCase()));
      if (!link) return `Usage: open <${CV.links.map(linkKey).join("|")}>`;
      window.open(link.url, "_blank");
      return `Opening ${link.name}…`;
    },
    goto: (arg) => {
      const el = arg && document.getElementById(arg);
      if (!el || el.tagName !== "SECTION") return "Sections: " + [...$$("main section")].map((s) => s.id).join(", ");
      el.scrollIntoView();
      return `Navigating to #${arg}…`;
    },
    theme: () => { toggleTheme(); return `Theme: ${document.documentElement.dataset.theme}`; },
    print: () => { printCV(); return "Opening print dialog…"; },
    pdf: () => { printCV(); return "Opening print dialog. Choose \"Save as PDF\"."; },
    clear: () => { out.textContent = ""; return null; },
    exit: () => { toggleTerminal(false); return null; },
    sudo: () => "Nice try 😄 — but you can hire me instead: type 'contact'",
  };
  function toggleTerminal(show = term.classList.contains("hidden")) {
    term.classList.toggle("hidden", !show);
    if (show) {
      if (!out.textContent) print(`Welcome to ${CV.name}'s CV terminal. Type 'help' to begin.`);
      setTimeout(() => input.focus(), 50);
    }
  }
  $("#terminalBtn").addEventListener("click", () => toggleTerminal());
  $("#closeTerminal").addEventListener("click", () => toggleTerminal(false));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const raw = input.value.trim();
      input.value = "";
      if (!raw) return;
      history.push(raw); hIdx = history.length;
      print(`$ ${raw}`);
      const [cmd, ...args] = raw.split(/\s+/);
      const fn = commands[cmd.toLowerCase()];
      const res = fn ? fn(args.join(" ")) : `Command not found: ${cmd}. Type 'help'.`;
      if (res) print(res);
    } else if (e.key === "Tab") {
      e.preventDefault();
      const match = input.value && Object.keys(commands).find((c) => c.startsWith(input.value.toLowerCase()));
      if (match) input.value = match;
    } else if (e.key === "ArrowUp" && hIdx > 0) {
      input.value = history[--hIdx];
    } else if (e.key === "ArrowDown") {
      hIdx = Math.min(history.length, hIdx + 1);
      input.value = history[hIdx] || "";
    } else if (e.key === "Escape") {
      toggleTerminal(false);
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "`" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
      e.preventDefault();
      toggleTerminal();
    }
  });
}
