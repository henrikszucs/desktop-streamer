---
name: beercss
description: The beercss class vocabulary, markup patterns and ui() API of the build vendored in this repo. Use when writing or changing markup under src/client/web - picking a class name, building a dialog, nav, field, menu, list or grid, theming, dark mode, or responsive layout.
---

# beercss

The CSS framework the whole web client is built on. It is **vendored**, not a
dependency: `src/client/web/libs/beercss/`, loaded by `index.html` and served
from `/libs/beercss/`. Nothing installs or updates it, so the file on disk is
the only thing that decides which class names work.

## The vendored file is the authority

The build here is **not a byte match of any upstream release**. Its font faces
were rewritten to the local `.woff2` files, leaving a stale
`beercss@3.11.33` CDN fallback that does *not* name its version; its class set
sits between upstream 4.0.23 and 5.0.2.

So **beercss.com documents a build this is not.** Upstream 5.0.3 carries
`h1`-`h6`, `indeterminate` and `wavy`, and names `.margin` and `.padding` as
selectors of their own; this build has none of those rules - though `margin` and
`padding` still work here, through the substring rule below. Read the docs for
concepts, never for class names.

Confirm any class you are not certain of against the file that ships - in two
steps, because beercss does not only select on class names:

```bash
# 1. is there a selector for it?
grep -oE "\.your-class([^-a-zA-Z0-9_]|$)" src/client/web/libs/beercss/beer.min.css | head -1

# 2. nothing? it may still be matched on a substring of the class attribute
grep -oE "\[class\*=[^]]*\]" src/client/web/libs/beercss/beer.min.css | sort -u
```

A class name is silent when it is wrong - no error, no warning, just markup
that does not style - which is why the check is worth it every time and why the
two lists below exist.

## The substring rule

Six families are matched on a **substring of the class attribute** rather than
by name:

```
[class*=blur]   [class*=padding]   [class*=margin]
[class*=round]  [class*=width]     [class*=divider]
```

Two consequences, and they cut in opposite directions:

- `blur`, `padding`, `margin` and `round` on their own are **real** and carry a
  1rem default, even though the file holds no `.padding` or `.blur` selector.
  Do not "fix" them. The named forms (`tiny-padding`, `large-blur`) only set a
  different amount for the same rule.
- The CSS-property order is caught by the substring rule but **not** by the
  side-only rule, whose `:not(...)` list names `top-padding` and its five
  siblings. So `padding-top` applies padding on **all four sides**: it looks
  like it works, and it is still wrong.

## Word order

beercss names a helper **modifier first**: `top-padding`, `bottom-margin`,
`small-round`, `large-text`.

In the repo today: `margin-top` and `margin-bottom` in `ui/new/view.html` put
1rem on all four sides where they mean top and bottom - they should be
`top-margin` and `bottom-margin`. Fix one when you are already editing its file.

A name matching neither a selector nor a substring does nothing at all: `gap`
is the one to watch for, since `.row` and `.grid` space their children with
`space` and its scale instead.

## The `ui()` API

`beer.min.js` assigns one global, `globalThis.ui`, and runs its own setup on
import: it sets `body` to `light`/`dark` from the system preference and starts a
`MutationObserver` that wires any `[data-ui]` element, including markup added
later.

| call | does |
| --- | --- |
| `ui()` | re-wire `[data-ui]` elements now |
| `ui("setup")` | start the MutationObserver (already done on import) |
| `ui("guid")` | returns a GUID string |
| `ui("mode")` | returns `"light"` or `"dark"` |
| `ui("mode", "light"\|"dark"\|"auto")` | sets it, swapping the class on `body`; returns the resolved mode |
| `ui("theme", "#rrggbb" \| imageUrl)` | **async** - generates an M3 palette and writes it as custom properties onto `body[style]` |
| `ui("theme", {light, dark})` | same, from a palette you already hold |
| `ui("#id")` | toggles that element - a `dialog` opens with its backdrop, a `menu`, `.snackbar` and `.page` get their own behaviour, anything else toggles `.active` |

`ui("theme", ...)` needs `material-dynamic-colors.min.js`, which `index.html`
loads beside it; without it the call falls back and changes nothing.

## How this repo drives it

- **`data-ui` is not used, anywhere.** `src/client/web/src/view.js` owns
  `.active` on dialogs and the overlay, and `src/router.js` owns which screen
  and segment is up. Add a dialog through the `Dialog` class and the registry,
  not by putting `data-ui` on a button - the router would not know it opened.
- **`.hide` is this repo's class**, defined in `index.css`, not beercss. It is
  `display: none !important`, which is why it beats beercss's own `.active`.
- **The palette is overridden** in `index.css` under `:root, body.light` and
  `body.dark`. `ui("theme", hex)` writes to `body[style]`, and an inline style
  beats a class rule - so a user-chosen colour silently replaces the whole
  green palette in `index.css`. That is `ui/settings/appearance/`.
- **`body` carries classes from three owners**: `light`/`dark` from beercss,
  `segment-management`/`segment-room` from the router. Match on the one you
  mean.
- **`beer.min.js` is loaded `async`**, so `globalThis.ui` can still be
  undefined when `index.js` runs. `index.js` defers the `ui("mode", ...)` call
  by a `setTimeout(..., 1)` for exactly this reason; the `ui("theme", ...)`
  call above it is not deferred and is a live race.

## The two references

- **[ELEMENTS.md](ELEMENTS.md)** - the markup a component needs: dialogs, navs,
  fields, menus, lists, grids, buttons, tabs, progress, selection controls.
  Read it before writing a component, because beercss reads **structure**, and
  the right classes in the wrong nesting render wrong.
- **[HELPERS.md](HELPERS.md)** - the full helper vocabulary of this build,
  grouped: spacing, size, shape, colour, position, responsive, typography.
  Read it when you are reaching for a class name rather than a component.
