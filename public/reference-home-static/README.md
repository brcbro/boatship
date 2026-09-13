# CohortIX Website

Modern, high-performance web experience for **[CohortIX](https://www.cohortix.in/)** — Custom Software, SaaS, Web & Mobile App Development Studio based in Surat, Gujarat, India.

All frontend files, stylesheets, scripts, custom fonts, vector graphics, high-resolution imagery, and interactive motion systems are structured and self-contained.

---

## 📁 Project Structure

```
├── index.html                   # Main landing page with localized CohortIX copy & assets
├── 404.html                     # Standalone custom 404 error page
├── package.json                 # Dev & local server runner scripts
├── assets_manifest.json         # Mapping of remote CDN URLs to local file paths
├── css/
│   └── neutomni-*.css           # Core stylesheet with typography & layout utilities
├── js/
│   ├── jquery-3.5.1.min.*.js    # jQuery runtime
│   ├── neutomni-*.js            # Webflow core runtime & interaction chunks
│   ├── gsap.min.*.js            # GSAP animation engine
│   ├── MorphSVGPlugin.min.*.js  # GSAP SVG morphing plugin
│   ├── ScrollTrigger.min.*.js   # GSAP scroll animation controller
│   ├── SplitText.min.*.js       # GSAP text reveal plugin
│   ├── ScrollToPlugin.min.*.js  # GSAP scroll target plugin
│   ├── Observer.min.*.js        # GSAP gesture/interaction observer
│   ├── lenis.min.*.js           # Lenis smooth scrolling engine
│   ├── split-type.*.js          # SplitType typography helper
│   ├── circletype.min.*.js      # CircleType curved text helper
│   ├── slater-global.js         # Localized global interaction logic
│   └── slater-home.js           # Localized home page animations & drag physics
├── fonts/                       # Local web fonts (Editorial New, Fira Code, Vazirmatn)
├── images/                      # Brand assets, project imagery, and SVG graphics
├── videos/                      # Video demonstrations
└── assets/                      # Lottie animation JSON files
```

---

## 🚀 How to Run Locally

### Option 1: Python HTTP Server (Recommended)
```bash
python -m http.server 3000
```
Then open [http://localhost:3000](http://localhost:3000) in your browser.

### Option 2: Node / npx serve
```bash
npx serve .
```

### Option 3: VS Code / IDE Live Server
Right-click `index.html` and select **"Open with Live Server"**.

---

## ✨ Features

1. **Brand Identity**: Integrated official CohortIX brand logos, typography, case studies, packages, and technical services.
2. **GSAP Motion & SVG Morphing**: Scroll-triggered reveals, kinetic text splitting, interactive draggable CTA, and morphing geometry.
3. **Lenis Smooth Scroll**: Silky-smooth inertial scrolling throughout desktop and mobile viewports.
4. **Live Surat Time (IST / GMT+5:30)**: Real-time timezone calculation for client transparency.
5. **SEO & Structured Data**: Complete OpenGraph, Twitter Cards, Schema.org Organization, and LocalBusiness JSON-LD markup.
