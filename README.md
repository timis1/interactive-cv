# Interactive CV

A static, interactive CV site for GitHub Pages. Only the name, roles, LinkedIn and Java Code Geeks links are public. The rest of the CV is **encrypted**, and each approved person opens it with their own **personal access link**. All content lives in JSON files, so you can add a new job, certification, project or skill without touching any JavaScript.

## Project structure
```
index.html            page layout and the <template> blocks used to render each entry
style.css             styles
script.js             loads the data, decrypts the private part and fills the templates (no content in here)
data/                 PUBLISHED
  public.json         name, roles, public links, siteUrl, accessRequestForm, recaptchaSiteKey
  private.enc.json    the encrypted private CV (generated, don't edit)
  access.json         one encrypted key per person with access (generated, don't edit)
private/              NOT PUBLISHED (git-ignored). Edit your CV here.
  profile.json        photo file name, careerStart, about, email, phones, languages, soft skills, community
  experience.json     jobs and education (timeline)
  certifications.json certifications
  projects.json       projects and hackathons
  skills.json         skill groups
  profile.jpg         profile photo
  keys.json           content key + list of people with access (generated). BACK IT UP.
tools/                PowerShell 7 scripts: encrypt, grant, revoke, list-access
```

## Private CV and access links
Visitors see the public part and a **Request access** form. The requests arrive in your email through Formspree. When you approve someone, you send them a personal link that opens the full CV. The link is remembered in their browser, and the 🔒 button locks the page again.

### One-time setup
1. Create a free form at [formspree.io](https://formspree.io) (50 requests/month) and copy its endpoint, e.g. `https://formspree.io/f/abcdwxyz`.
2. In `data/public.json`, set `"accessRequestForm"` to that endpoint and `"siteUrl"` to your Pages URL, e.g. `https://<user>.github.io/<repo>/`. Until the form is set, visitors are pointed to LinkedIn instead.
3. Install [PowerShell 7](https://aka.ms/powershell) (`pwsh`) if you don't have it, then run:
   ```
   pwsh .\tools\encrypt.ps1
   ```

### Protecting the request form from spam and quota abuse
The Formspree free plan accepts 50 requests a month, and spam counts toward that limit. Nobody is ever charged: if the limit is reached, the form stops accepting requests until next month. Visitors then see an error that points them to LinkedIn. To make abuse hard:
1. **Restrict to domain** (Formspree → project **Settings**): enter `<user>.github.io`. Requests sent from anywhere else go to spam.
2. **reCAPTCHA** (recommended; stops scripts that post directly to Formspree):
   - At https://www.google.com/recaptcha/admin, create a **v2 "I'm not a robot" checkbox** key for your `<user>.github.io` domain (add `localhost` for testing).
   - In Formspree → form **Settings** → Spam protection, enable CAPTCHA, choose **Custom reCAPTCHA**, and paste the **secret key**.
   - Put the **site key** in `data/public.json` → `"recaptchaSiteKey"`. Leave it `""` to turn the checkbox off.
3. Built in: a hidden honeypot field (`_gotcha`) catches simple bots. Each browser also sends one request, then sees "request sent" instead of the form.

### Daily use
| Task | Command | Then |
|---|---|---|
| Approve a request | `pwsh .\tools\grant.ps1 -Name "Jane Doe, Acme"` | push, then email the printed link |
| See who has access / resend a link | `pwsh .\tools\list-access.ps1` | |
| Remove someone's access | `pwsh .\tools\revoke.ps1 -Name "Jane Doe, Acme"` | push |
| Publish CV edits made in `private/` | `pwsh .\tools\encrypt.ps1` | push |

"Push" means commit and push the `data/` folder. `private/` is never committed.

### The access flow, step by step
Each request is handled on its own. Every approved person gets a personal link, and approving or removing one person never affects the others.

**1. A visitor asks for access** (e.g. Jane from Acme)
- She opens the site and sees the name, roles, LinkedIn and Java Code Geeks, plus the request form.
- She fills in name, company, email and an optional reason, ticks the reCAPTCHA box if it's enabled, and clicks **Request access**.
- The request goes to Formspree and she sees "✔ Request sent". Nothing on the site changes.

**2. You receive an email**
- Formspree emails you "CV access request from Jane Doe" with her details. Requests also appear in the Formspree dashboard.
- Several requests arrive as separate emails. Each one waits until you act on it.

**3. You approve (or ignore) the request**
- On your PC, run:
  ```
  pwsh .\tools\grant.ps1 -Name "Jane Doe, Acme" -Note "Java role"
  ```
- The script:
  - creates a random code for Jane
  - adds her locked copy of the content key to `data/access.json`
  - records her in `private/keys.json` (never pushed)
  - prints her personal link, e.g. `https://<user>.github.io/<repo>/#access=3f2a9c1e07d4.Xk9pQ2…`
- Run it once per person you approve. The CV itself isn't re-encrypted.
- To reject a request, simply don't grant it (or reply saying no).

**4. You publish the approvals**
- Commit and push `data/access.json`. One push covers everyone you approved.
- GitHub Pages usually updates within 1–2 minutes (sometimes up to ~10 because of caching).

**5. You send each person their own link**
- Reply to the Formspree email with the link printed for that person. Send it only after the site has updated.
- If someone opens the link too early, it shows "invalid or revoked". Opening it again a few minutes later works.

**6. The visitor opens the CV**
- Jane clicks her link. Her browser takes the code from the part after `#`, which is never sent to GitHub.
- The code unlocks her copy of the content key, and that key decrypts the CV.
- The full CV appears. The code is removed from the address bar and remembered in her browser, so she doesn't need the link again on that device.
- The 🔒 button locks the page again. On another device, she just opens the link again.

**Afterwards**
| Situation | What you do | Effect on others |
|---|---|---|
| You update your CV | edit `private/`, run `encrypt.ps1`, push | all existing links show the new version |
| Someone lost their link | run `list-access.ps1` and resend it | none |
| Remove someone | `revoke.ps1 -Name "Jane Doe, Acme"`, push | Jane's link stops working; all other links keep working |
| Same person asks twice | `grant.ps1` notices and prints their existing link | none |

### Why the public files can't be used to unlock the CV
Think of the CV as a safe opened by one **master key** (the content key):
- For every approved person, a copy of the master key is put in a small box locked with **that person's code**.
- All the boxes are public (`data/access.json`), but each can only be opened with its own code.
- The code travels only in the personal link you email, and a copy stays in `private/keys.json` on your PC.

```
Jane's link:   #access=3f2a9c1e07d4.Xk9pQ2vL8sT...(43 random characters)
                       └─ id ──────┘ └─ code: only in her email ─┘

access.json:   { "id": "3f2a9c1e07d4", "iv": "...", "data": "vuBCs0f1Z8..." }
                   └─ same id           └─ master key, locked with Jane's code
```

| Item | Where it is | Can it unlock the CV? |
|---|---|---|
| Jane's code | her email and your PC only | ✅ yes, it's her personal key |
| Her entry in `data/access.json` | public repo | ❌ no, it's a locked box |
| `data/private.enc.json` | public repo | ❌ no, it's the locked safe |

- The **id** is only a label that tells the page which box to try. It can't open anything.
- Guessing a code means trying up to 2²⁵⁶ possibilities, which is impossible in practice.
- Codes are different for every person, so Jane's code opens only Jane's box. That's also why revoking works: `revoke.ps1` removes her box, changes the master key and re-locks it for everyone else.

### How it works and its limits
- The content is encrypted with AES-256-GCM using a random key. That key is encrypted separately for every person with their own random 256-bit code. Names are never published, only random ids.
- The code is in the part of the link after `#`, which browsers never send to GitHub.
- Revoking creates a new content key, so the old link stops working and everyone else's link keeps working. Someone who already opened the CV could still have saved or printed it. That applies to any CV you share.
- Anyone with a link can forward it. If you see that, revoke it.
- **Back up `private/keys.json`** somewhere safe (password manager, private cloud). If you lose it, run `encrypt.ps1` again to start fresh, but every existing link stops working.
- Git history is permanent: never commit the `private/` folder or an unencrypted version of the CV.

## Adding content
Edit the files in `private/`, then run `pwsh .\tools\encrypt.ps1` and push. Copy an existing entry in the right JSON file, paste it where you want it, and change the values. Entries are shown in the order they appear in the file, so put the newest first.

**New job or degree** (`private/experience.json`):
```json
{
  "type": "work",
  "period": "Jan 2027 — Present",
  "title": "Senior Software Engineer",
  "company": "Company Name",
  "url": "https://company.com",
  "summary": "One-line description shown before expanding.",
  "details": ["What you did…", "Another achievement…"],
  "tags": ["Java", "Kubernetes"]
}
```
- `type` is `work` or `education`. Any other value, such as `volunteering`, automatically gets its own filter button.
- `url` and `summary` are optional.
- `tags` feed the "click a skill to see where I used it" feature. Use the same spelling as in `skills.json`.

**New certification** (`private/certifications.json`):
```json
{ "name": "CKA: Certified Kubernetes Administrator", "issuer": "CNCF", "url": "https://verify-link", "date": "2027" }
```
- `date` is optional.
- `color` is optional and sets the badge color, e.g. `"color": "#326ce5"`. Microsoft, GitLab and HashiCorp already have colors.
- The certification count and the issuer filters update automatically.

**New project** (`private/projects.json`):
```json
{ "title": "My Project", "description": "What it does.", "tags": ["Java"], "url": "https://github.com/…" }
```
`url` is optional.

**New skill:** add it to the `items` list of a group in `private/skills.json`, or add a new `{ "category": "...", "items": [...] }` group.

**New public profile link** (`data/public.json` → `links`): `{ "name": "GitHub", "url": "https://github.com/…", "icon": "github" }`.
Available icons: `linkedin`, `github`, `article`, `email`, `whatsapp`, `link`. To add one, create a `<template id="icon-NAME">` with an SVG in `index.html`.

> JSON rules: use double quotes, put commas between entries, and no comma after the last entry. If a file is invalid, `encrypt.ps1` stops and names that file.

## Changing the layout of an entry
Edit the matching `<template>` in `index.html`. The attributes are:

| Attribute | Effect |
|---|---|
| `data-field="key"` | element text = value (`.` = the item itself) |
| `data-attr="href=url; title=name"` | sets attributes from values |
| `data-class="key"` | adds the value as a CSS class |
| `data-if="key"` / `data-unless="key"` | keeps the element only if the value is (or isn't) set |
| `data-each="key"` | repeats the single child element for each value in a list |
| `data-icon="key"` | inserts the `icon-<value>` template |

## Features
- Public view with the name, roles and public links, plus an access-request form. The full CV opens with a personal link.
- Hero with a photo, typing effect, social icons (WhatsApp included) and a particle background that reacts to the mouse
- Animated stats calculated from the data: years of experience from `careerStart`, certifications, companies and projects
- Skills grouped by category. Click a skill to see which jobs and projects used it.
- Timeline with type filters and expand/collapse all
- Certifications filterable by issuer, with verification links
- Project search with clickable tags
- Contact cards (copy email, WhatsApp, profiles) and a form that sends by email or WhatsApp
- ⤓ button (or the terminal's `pdf` command) turns the page into a PDF CV: it opens the browser's print dialog with a clean A4 layout and every section expanded. Choose "Save as PDF".
- Dark and light theme, progress bar, back-to-top button and mobile navigation on the unlocked CV. On phones, the request and access-link forms stack vertically, reCAPTCHA uses its compact widget, and CV cards fit the screen.
- Mini terminal: press `` ` `` or click `>_`, then type `help`

## Run locally
Browsers block loading JSON files from pages opened directly from disk, so use a local server:
```
py -m http.server
```
Then open http://localhost:8000.

## Deploy to GitHub Pages
1. Push the files to a GitHub repository. Use `<username>.github.io` if you want it at the root URL.
2. Go to **Settings → Pages**, set **Source** to "Deploy from a branch", and choose `main` / `(root)`.

> Only `data/public.json` is readable by everyone. The email, phones, photo and the rest of the CV are only visible to people with an access link.
