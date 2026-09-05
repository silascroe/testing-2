# EMBERLINE

EMBERLINE is a GitHub-only browser game: a single-player frontier colony simulator whose entire runtime is static HTML, CSS, and JavaScript served by GitHub Pages.

## Current vertical slice

- Seeded procedural world generation
- Terrain, iron, crystal, food, energy, population, morale, and core integrity
- Six buildable structures with terrain/resource rules
- Resource production and consumption simulation
- Three AI factions that send raiders toward the settlement
- Turret and wall defenses
- Pause and simulation speed controls
- Local browser save/load using `localStorage`
- Generated basin key art and transparent structure sprites bundled locally
- No external runtime services, APIs, assets, or backend

## Local development

Open `index.html` through a local static server. For example:

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

## GitHub Pages

The repository includes a GitHub Actions workflow under `.github/workflows/pages.yml`. Enable GitHub Pages with **GitHub Actions** as the source in the repository settings, then pushes to `main` will build and deploy the root static site.

## Design boundary

GitHub stores the code and serves the files. The browser owns simulation, rendering, and saves. GitHub Actions owns validation and deployment. There is deliberately no server-side state, authentication, database, or external API dependency.
