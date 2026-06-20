# The Tiramisu Lab — Website

The brand website for **The Tiramisu Lab** — handmade, small-batch tiramisu made the slow way in Dublin, Ireland.

A single-page static site (no build step), so it can be hosted anywhere.

## Structure

| File | Purpose |
| --- | --- |
| `index.html` | The page: hero, About us, Ingredients, footer |
| `styles.css` | Warm & artisanal theme (brand "Deep Cocoa" palette, Fraunces + DM Sans) |
| `script.js` | Footer year + mobile nav toggle |
| `favicon.svg` | Browser-tab icon |

## Run locally

It's plain HTML/CSS/JS — open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 4321
# then visit http://localhost:4321
```

## Deploy

Any static host works (GitHub Pages, Netlify, Vercel, Cloudflare Pages). Point it at this folder; no build command needed.

## To customise

- **Contact details** — email, phone, Instagram, address in the footer of `index.html` (marked with `TODO`).
- **Brand colours / fonts** — CSS variables at the top of `styles.css`.
