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

1. **Push** to **`main`**.
2. On GitHub: **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions** (not “Deploy from a branch”).
3. After a successful run, open the **Pages** URL from the workflow or **Environments**.

**Local production check** (replace `three-effects` with your repo name if different):

```bash
VITE_BASE=/three-effects/ npm run build:playground
npx vite preview --config playground/vite.config.ts --base /three-effects/
```

**Custom domain** (e.g. apex on `three-effects.mo1.app`): configure the domain under **GitHub Pages** and DNS, then set **`VITE_BASE`** to **`/`** in the workflow’s **Build playground** `env` so assets use root-relative URLs. Push or re-run the workflow to redeploy.
