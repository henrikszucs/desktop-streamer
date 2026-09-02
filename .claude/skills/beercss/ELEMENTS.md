# Elements

The markup each component needs in the vendored build. beercss selects on
**structure** as much as on class names (`.field > label`, `menu > li > menu`,
`nav > a > .badge`), so a component with the right classes in the wrong nesting
renders wrong and reports nothing.

Every pattern below was read out of `libs/beercss/beer.min.css`. When you need
one that is not here, pull its real selectors rather than guessing:

```bash
node -e "const c=require('fs').readFileSync('src/client/web/libs/beercss/beer.min.css','utf8');\
const s=[];let d=0,b='';for(const x of c){if(x==='{'){if(!d)s.push(b.trim());d++;b='';continue}\
if(x==='}'){d--;b='';continue}if(!d)b+=x}\
console.log(s.filter(x=>/\.slider([^-\w]|$)/.test(x)).join('\n'))"
```

## Sizes

Most elements take the same scale, and they mean size, not importance:
`tiny`, `small`, `medium`, `large`, `extra`. The helper scales are narrower and
uneven - there is no `medium-round`, and no `medium-padding` - and four helpers
(`padding`, `margin`, `round`, `blur`) work bare through a substring selector
rather than a rule of their own. See [HELPERS.md](HELPERS.md).

## Dialog

```html
<div class="overlay" id="dialog-overlay"></div>

<dialog id="dialog-example">
    <nav>
        <h5 class="max">Title</h5>
        <button class="circle transparent"><i>close</i></button>
    </nav>
    <p>Body.</p>
    <nav class="right-align">
        <button class="border">Cancel</button>
        <button>Confirm</button>
    </nav>
</dialog>
```

`dialog` and the overlay are shown by adding `active` to each. Sizes:
`small`, `medium`, `large`. Positions: `top`, `bottom`, `left`, `right`, `max`
(a `left` dialog is the side-sheet the `menu` module uses). A `header` or
`footer` child is styled as one, and `fixed` on it pins it while the body
scrolls.

**In this repo, do not toggle `active` yourself.** Extend `Dialog` from
`src/view.js` and let the router open and close it - `show()`/`hide()` there
already handle the overlay and the overlay click.

## Nav

```html
<nav class="top">                      <!-- top | bottom | left | right -->
    <button class="circle transparent"><i>menu</i></button>
    <div class="max"></div>            <!-- the spacer that pushes the rest over -->
    <button class="circle transparent"><i>settings</i></button>
</nav>

<nav class="left max">                 <!-- max = the wide rail, labels beside icons -->
    <header>...</header>
    <a data-route="devices">
        <div>                          <!-- a badge needs this wrapper -->
            <i>devices</i>
            <div class="badge min top left"></div>
        </div>
        <div>Devices</div>
    </a>
    <div class="max"></div>            <!-- pushes what follows to the bottom -->
    <a class="primary"><i>download</i><div>Download</div></a>
</nav>
```

`.max` on the rail is the wide/narrow switch, and it moves where the badge has
to sit: beercss matches `nav.left > a > .badge`, so in the narrow rail the badge
is a direct child of the `<a>` and in the wide one it has to be inside the
wrapper `<div>` beside the icon. `index.js` does exactly this re-parenting in
`switchMenu()` - keep new nav entries consistent with it.

Variants: `nav.tabbed` (underlined tabs, `> a.active` marks the current one),
`nav.toolbar` (a floating group of `<a>`), `nav.group` (a connected set of
buttons; add `split` or `connected`), `nav.vertical`.

## Field

```html
<div class="field label border">
    <input type="text" id="input-x"/>
    <label>Label</label>
    <span class="helper">Helper text</span>
</div>
```

The `<input>` comes **first** and the `<label>` after it - the label floats off
`:focus`/`:not(:placeholder-shown)` on the input before it. Modifiers on the
wrapper: `label`, `border`, `fill`, `round`, `small`/`large`/`extra`,
`prefix`/`suffix` (with an `<i>` before/after the input), `invalid`, `textarea`.
A `.helper` or `.error` child is the line under the field; `.field > i` is the
icon inside it, and `i.front` pins it to the leading edge.

`ui/new/view.html` uses `<output class="invalid error-text">` here instead of
`.helper`/`.error`, and `ui/new/index.js` reaches it as
`field.children.item(2)`. That index breaks the moment a child is added -
prefer `.error` and a query by class.

## Menu

```html
<button class="circle">
    <img src="/media/user.svg"/>
    <menu class="border left no-wrap">
        <li><i>login</i><span>Log in</span></li>
        <li>
            Submenu
            <menu>                      <!-- menu > li > menu nests -->
                <li>Item</li>
            </menu>
        </li>
    </menu>
</button>
```

The `<menu>` is a child of the element that opens it, and it stays open while
that element holds focus - which is why `router.blurMenu()` blurs the parent
after a `[data-route]` click inside one. Position with `left`, `right`, `top`,
`min` (and combinations, `menu.top.left`).

## List

```html
<ul class="list border">
    <li class="wave round"><i>devices</i><span class="max">Label</span><i>chevron_right</i></li>
    <li>
        <details>                       <!-- an expander is a details in a li -->
            <summary><i>tune</i><span class="max">More</span></summary>
            <div>Body.</div>
        </details>
    </li>
</ul>
```

beercss styles `.list > li`, `.list > li > a:only-child` and
`.list > li > details > summary` the same way, so a whole-row link must be the
`<li>`'s **only** child. `.max` on a child is what makes the row's text take the
free space.

## Grid and row

```html
<div class="grid">
    <div class="s12 m6 l4">...</div>    <!-- spans per breakpoint -->
</div>

<div class="row center-align wrap">...</div>
```

`grid` is a 12-column grid; `s1`-`s12`, `m1`-`m12`, `l1`-`l12` set the span at
each breakpoint (`s` up to 600px, `m` 601-992px, `l` 993px and up). `row` is a
flex row - `wrap`, `no-space`/`space`/`large-space`, and `.max` on a child to
let it take the rest. The same `s`/`m`/`l` used **alone** are visibility
classes: `class="m l"` is hidden on small screens, which is how `nav.left` is
hidden there.

## Button, chip

```html
<button class="circle transparent"><i>close</i></button>
<button class="large round"><i>cast</i><span>Join</span></button>
<a class="button border">Link that looks like a button</a>
<div class="chip small-round">Tag</div>
```

`button`, `.button` and `.chip` share their styling. Shape: `circle`, `square`,
`round`, `small-round`, `left-round`/`right-round` (how `ui/new/view.html`
welds a field to its button). Fill: default, `border`, `transparent`, `fill`,
plus any colour class. `extend` is the wide FAB; `responsive` makes it fill its
container; `vertical` stacks the icon over the label. Children are `<i>`,
`<span>`, `<img>`, `<svg>` - beercss sizes them itself, so an `<img>` that
should not be resized needs `responsive`.

## Progress

```html
<progress></progress>                   <!-- indeterminate bar -->
<progress class="circle large"></progress>
<progress value="40" max="100"></progress>
```

`circle` is the spinner, and it also works as `.field > progress.circle`.

## Selection controls

```html
<label class="checkbox">                <!-- checkbox | radio | switch -->
    <input type="checkbox"/>
    <span>Label</span>
</label>
```

The `<input>` first and a `<span>` after it, always - beercss draws the control
on the `span::before`, so a missing `span` renders nothing.

## Tabs

```html
<div class="tabs">
    <a class="active">One</a>
    <a>Two</a>
</div>
```

`.tabs > a.active` is the selected one. `nav.tabbed` is the same idea with the
navigation bar's styling. Neither switches anything by itself - in this repo the
panel behind a tab is a `Panel` from `src/view.js`.

## Card, snackbar, badge, tooltip

```html
<article class="round">
    <header>...</header>
    <p>Body.</p>
</article>

<div class="snackbar">Saved.</div>              <!-- add active to show -->
<div class="badge">3</div>                       <!-- min = the bare dot -->
<div class="tooltip right">Explanation</div>     <!-- inside the element it describes -->
```

`article` is the card and takes `small`/`medium`/`large`, `border`, `round`.
A `snackbar` shown through `ui("#id")` hides itself again; one shown by adding
`active` does not. `badge` takes `top`/`bottom`/`left`/`right` for its corner
and `min` for the dot with no number.

## Shapes

This build carries the Material 3 expressive shapes: `.shape` plus one of
`arch`, `boom`, `bun`, `burst`, `clamshell`, `diamond`, `fan`, `flower`, `gem`,
`ghost-ish`, `heart`, `leaf-clover4`, `leaft-clover8`, `oval`, `pentagon`,
`pill`, `pixel-circle`, `pixel-triangle`, `puffy`, `puffy-diamond`,
`semicircle`, `sided-cookie4`/`6`/`7`/`9`/`12`, `slanted`, `soft-boom`,
`soft-burst`, `sunny`, `very-sunny`, `triangle`, `arrow`, `net`, `stripes`.

`leaft-clover8` is spelled that way in beercss itself. The obvious spelling
does nothing.
