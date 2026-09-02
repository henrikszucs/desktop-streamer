# Helpers

Every helper class in the vendored build, extracted from
`libs/beercss/beer.min.css`. A name that is not on this page and does not
contain one of the six substrings below does not exist in this build -
including names that exist in upstream 5.x (`h1`-`h6`, `indeterminate`,
`wavy`).

**The lists below are selector names, and beercss also matches on a substring
of the class attribute**: `[class*=blur]`, `[class*=padding]`,
`[class*=margin]`, `[class*=round]`, `[class*=width]`, `[class*=divider]`. So
`padding`, `margin`, `round` and `blur` work on their own with a 1rem default
even though no rule names them, and every entry in those families below is that
same rule with a different amount.

Regenerate this list after any change to the vendored file:

```bash
node -e "const c=require('fs').readFileSync('src/client/web/libs/beercss/beer.min.css','utf8');\
const s=new Set();for(const m of c.matchAll(/\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g))s.add(m[1]);\
console.log([...s].sort().join(' '))"
```

## The scales are not the same width

This is where the guesses go wrong. The three spacing scales differ, and none
of them is complete:

| scale | values |
| --- | --- |
| `-padding`, `-margin` | bare `padding`/`margin` (1rem), then `tiny` `small` `large` `no` — **no `medium`, no `extra`** |
| `-space` | `tiny` `small` `medium` `large` `extra` `no`, plus bare `space` |
| `-round` | `small` `large` `no`, plus bare `round` — **no `medium`, no `tiny`** |
| component size | `tiny` `small` `medium` `large` `extra` |

## Spacing

Padding and margin take a size **or** a side, never both:

```
padding       tiny-padding  small-padding  large-padding  no-padding
top-padding  bottom-padding  left-padding  right-padding
horizontal-padding  vertical-padding

margin       tiny-margin   small-margin  large-margin  no-margin  auto-margin
top-margin  bottom-margin  left-margin  right-margin
horizontal-margin  vertical-margin
```

`space` is the gap **between** children of a `row`, `grid`, `nav`, `list`,
`menu` or `table`; on anything else it is vertical whitespace:

```
space  tiny-space  small-space  medium-space  large-space  extra-space  no-space
```

## Size

```
tiny  small  medium  large  extra           component size
small-width  medium-width  large-width      auto-width
small-height medium-height large-height     auto-height
max  min  responsive  wrap  no-wrap  truncate
```

`max` and `min` are context-dependent: on a flex child `max` takes the free
space (which is how the nav spacer and the list row label work), on a `badge`
`min` is the bare dot, on a `menu` it narrows it.

## Shape

```
round  small-round  large-round  no-round
top-round  bottom-round  left-round  right-round
circle  square  border  no-border  oval  pill  shape
```

The expressive shapes that pair with `shape` are listed in
[ELEMENTS.md](ELEMENTS.md).

## Layout

```
grid                    12-column grid
row                     flex row
s1..s12  m1..m12  l1..l12    column span per breakpoint
s  m  l                 visibility: present = shown at that breakpoint only
group  connected  split  tabbed
```

Breakpoints: `s` to 600px, `m` 601-992px, `l` 993px and up. `class="m l"` is
the idiom for "hidden on phones".

## Position and alignment

```
top  bottom  left  right  center  middle  front  back
top-align  bottom-align  left-align  right-align  center-align  middle-align
absolute  fixed  vertical  horizontal  scroll  no-scroll  page
```

## Colour

Material 3 roles, each also as `-text` (foreground only) and `-border`:

```
primary  secondary  tertiary  error        + -container, -text, -border
surface  surface-variant  surface-dim  surface-bright
surface-container  surface-container-low  surface-container-lowest
surface-container-high  surface-container-highest
inverse-surface  inverse-primary  inverse-link
background  transparent  white  black  link
```

Prefer these over the fixed palette below: they follow the light/dark mode and
whatever `ui("theme", ...)` generated, where the palette does not.

The fixed palette - each as the bare name, `-text`, `-border`, and tints `1`
through `10` (`red5`, `blue-grey2`):

```
amber  blue  blue-grey  brown  cyan  deep-orange  deep-purple  green  grey
indigo  light-blue  light-green  lime  orange  pink  purple  red  teal  yellow
```

## Typography

```
bold  italic  underline  overline  upper  lower  capitalize  truncate
small-text  medium-text  large-text
tiny-line  small-line  medium-line  large-line  extra-line  no-line
```

## Effects

```
elevate  small-elevate  medium-elevate  large-elevate  no-elevate
shadow  top-shadow  bottom-shadow  left-shadow  right-shadow
blur  small-blur  large-blur              bare blur is the 1rem default
opacity  small-opacity  medium-opacity  large-opacity  no-opacity
zoom  tiny-zoom  small-zoom  medium-zoom  large-zoom  extra-zoom
wave  no-wave  ripple  fast-ripple  slow-ripple  ripple-js
rotate  fast-rotate  slow-rotate
divider  small-divider  medium-divider  large-divider
```

## State and mode

```
active  invalid  fill  none
empty-state  loading-indicator
light  dark                     on <body>, set by ui("mode", ...)
```

`hide` is **not** beercss - this repo defines it in `index.css`.
