# three-effects playground

Vue + Vite demo for exercising **`Group`** and layer styles in the browser (WebGPU). Run from the **repository root**:

```bash
npm install
npm run dev
```

Root **`package.json`** scripts:

| Script                 | Purpose                                      |
| ---------------------- | -------------------------------------------- |
| `npm run dev`          | Vite dev server (this app)                   |
| `npm run build:playground` | Production build → `playground/dist`   |
| `npm run preview:playground` | Preview last build (see below)       |

## GitHub Pages

Deploy uses **`.github/workflows/deploy-playground.yml`**: on push to **`main`**, the build runs with `VITE_BASE=/<repo>/` and uploads **`playground/dist`**.

1. **Turn on Pages first** (one-time): repo **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions** (not “Deploy from a branch”). Save if prompted.
2. **Push** to **`main`** (or **Actions → Deploy playground → Re-run all jobs**). The deploy step will fail with **404 / “Creating Pages deployment failed”** if step 1 was skipped.
3. After a green run, open the **Pages** URL from the workflow summary, **Settings → Pages**, or **Environments → github-pages**.

### Troubleshooting

| Symptom | What to do |
| ------- | ---------- |
| **`deploy-pages` 404** / *Ensure GitHub Pages has been enabled* | Complete step 1 above, then re-run the failed workflow. |
| **Private repo** | GitHub Pages for private repos needs a **paid** plan on github.com (or use a public fork for the demo). |
| **Organization repo** | An org owner may need to allow **GitHub Pages** in org **Settings → Policies**. |

**Local production check** (replace `three-effects` with your repo name if different):

```bash
VITE_BASE=/three-effects/ npm run build:playground
npx vite preview --config playground/vite.config.ts --base /three-effects/
```

**Custom domain** (e.g. apex on `three-effects.mo1.app`): configure the domain under **GitHub Pages** and DNS, then set **`VITE_BASE`** to **`/`** in the workflow’s **Build playground** `env` so assets use root-relative URLs. Push or re-run the workflow to redeploy.
