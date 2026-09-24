# Pumpkin Patch

A Halloween take on the Queens / Star Battle logic puzzle, built as a mobile-first web game.

An N×N grid is split into N coloured patches. Place exactly one pumpkin in every row, every column and every patch. Pumpkins can't touch each other, not even diagonally.

Plain HTML, CSS and ES modules. No build step, no runtime dependencies, no external fonts or images.

## Layout

```
www/
  index.html       page shell
  styles.css       dark theme, board, win animation
  game.js          UI: rendering, touch input, animation hooks, timer, storage
  fx.js            synthesized sound (Web Audio) and haptics (navigator.vibrate)
  puzzle.js        generator + solver (pure logic, no DOM, ES module exports)
  manifest.json    PWA manifest (install to home screen)
  sw.js            service worker for offline play
  icons/           app icons (icon.svg is the source; PNGs rendered from it)
scripts/serve.js   zero-dependency static server
tests/             node:test suite for the generator and solver
```

## Run locally

Needs Node 18 or newer.

```sh
npm start        # serves www/ on http://localhost:8080
npm test         # runs the puzzle tests with node --test
```

Set `PORT=3000 npm start` to use another port. Any static server works too, as long as it serves `www/` over HTTP (ES modules don't load from `file://`).

## Play on your phone over Wi-Fi

1. Put your phone and computer on the same Wi-Fi network.
2. Run `npm start`. It prints a `Network:` address such as `http://192.168.1.23:8080/`.
3. Open that address in the phone's browser.

If the page doesn't load, allow Node through your computer's firewall for private networks (Windows asks the first time; on macOS check System Settings > Network > Firewall).

Browsers only register service workers and offer a proper install on HTTPS or `localhost`, so over a plain LAN address you get the game but not offline mode. Use the GitHub Pages deploy to test installing.

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` runs the tests on every push and pull request. On a push to `main` it then publishes `www/` to GitHub Pages.

One-time setup: in the repo on GitHub, go to **Settings > Pages** and set **Source** to **GitHub Actions**. After the next push to `main` the site is live at `https://<user>.github.io/<repo>/`.

All paths in the app are relative, so it works from a project subpath without changes.

To install it on a phone, open the Pages URL, then use **Add to Home screen** (Android Chrome) or **Share > Add to Home Screen** (iOS Safari).

## Wrap for Android with Capacitor (later)

`www/` is already a self-contained web app, so Capacitor can use it as-is.

```sh
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "Pumpkin Patch" com.yourname.pumpkinpatch --web-dir www
npx cap add android
npx cap sync android
npx cap open android      # opens Android Studio; run on a device or build an APK/AAB
```

Run `npx cap sync android` after every change to `www/`. You need Android Studio and a JDK installed. Replace the generated launcher icons (in `android/app/src/main/res/`) with ones made from `www/icons/icon.svg`; Android Studio's **Image Asset** tool can do this. The service worker is harmless inside the app shell but isn't needed there, since the files ship with the APK.

Adding Capacitor brings in npm dependencies for the native build only. The game itself still loads nothing at runtime.

## How puzzles are generated

Everything happens in `www/puzzle.js`, in code, from a seed:

1. Place N pumpkins with one per row and column and none touching (randomised backtracking).
2. Grow N regions outward from those pumpkins, one cell at a time, until the grid is full. Each region gets a random growth weight so patch sizes vary; small patches make unique puzzles much more likely.
3. Run a backtracking solver (row by row, bitmasks for columns and regions) that stops at 2 solutions. Keep the puzzle only if it has exactly one. Otherwise try again.

The random generator is a seeded mulberry32, so `generatePuzzle({ size, seed })` always returns the same puzzle for the same inputs. The game puts the seed in the URL (`?size=8&seed=abc123`), so a link reproduces a puzzle; the **share** button copies it.

On a laptop, a 9×9 averages about 30 ms and needs a few hundred attempts. The tests fail if any 9×9 takes 2 seconds or more.

Exports: `generatePuzzle`, `solve`, `isValidSolution`, `findConflicts`, `checkRegions`, `regionAdjacency`, `createRng`, `SIZES`.

## Controls

- Tap a cell to cycle empty, X, pumpkin, empty.
- Drag across cells to paint X's. Starting a drag on an X erases instead.
- **Auto-X** fills X's in a new pumpkin's row, column, patch and 8 neighbours. Remove the pumpkin and those X's go too, unless another pumpkin still rules the cell out. X's you placed yourself are never removed.
- **Undo** (or Ctrl/Cmd+Z), **Clear**, **Hint** (places one correct pumpkin), **New**.
- Pumpkins that break a rule shake once and turn red.
- A row, column or patch sweeps with light when every cell in it is decided (one pumpkin, X's everywhere else, no clashes).

## Feel

Everything tactile is drawn and synthesized in code. There are no image or audio files and no libraries.

- The board is a wooden tray (CSS gradients plus an inline SVG `feTurbulence` noise) with an inner shadow. Tiles are bevelled and dip 1.5px while pressed.
- Pumpkins are layered SVG with gradients, ribs, a highlight and a flickering candle glow. They drop in with squash and stretch, and shrink away when removed. X marks are crossed bones (twigs on the pale patches) that pop in, rippling 20ms apart when you swipe.
- Sounds come from Web Audio: a wooden tick for X, a hollow thunk for a pumpkin, a low dissonant tone for a clash, and a chime when you win. Haptics use `navigator.vibrate` where the browser supports it (Android Chrome yes, iOS Safari no).
- Sound and haptics each have a toggle, and the header has a mute button. All three settings are remembered.
- With `prefers-reduced-motion`, animations become short fades and nothing shakes or flickers.

Animations only change `transform` and `opacity`. While you drag, hit-testing is plain arithmetic on the board's position (no `elementFromPoint`), and DOM updates are batched into one per animation frame.

The timer pauses when the tab is hidden. Best times are kept per grid size in `localStorage`; solves that used a hint don't count. An unfinished puzzle is saved and restored on reload. If storage is blocked (private browsing, disabled storage), the game still works, it just forgets.
