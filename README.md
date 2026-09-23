# Play Drawing

A static basketball play-drawing app for GitHub Pages: draw plays on a
half-court, save them locally, and export as an image. No build step, no
runtime dependencies — plain HTML/CSS/JS.

See [`specs/engineering-plan.md`](specs/engineering-plan.md) for the
checkpoint roadmap.

## Run locally

```
python3 -m http.server 8000
```

Then open http://localhost:8000

## Run tests

```
npm install
npm test
```

## Deploy to GitHub Pages

1. Create a new GitHub repository.
2. Upload `index.html`, `styles.css`, the `js/` directory, and this README to the repository root.
3. In GitHub, open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select `main` and `/ (root)`, then save.
6. GitHub will publish the site at your Pages URL.
