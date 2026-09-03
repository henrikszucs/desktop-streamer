# Client reference

Why the browser client is put together the way it is. `CLAUDE.md` has the layout
and the module contract; this holds the reasoning that used to sit in the source
comments, so the files themselves can stay thin. `src/client/web` unless a path
says otherwise.

## Boot

`index.js` is five stages and nothing else: the environment, the configuration,
the shell, the UI, then the connection. Everything that touches the document
lives in `ui/ui.js` — the appearance and language settings, the overlay, the
loading layer, the `ctx["ui"]` namespace, and the build that mounts every
module. Every screen and dialog is a module under `ui/`.

`ctx` is built before either the `ui` namespace or the router exists, and both
close over it, so each is filled in as soon as it is there and neither has to be
constructed first. Every call in `ctx["ui"]` reads `ctx["router"]` at the time of
the call rather than at the time it was defined.

The route is opened *under* the loading layer and the layer lifts once
`loadPath()` has it on screen, so the first thing a user sees is the screen
itself. When the connection drops the layer comes back over whichever segment is
open and the screen below is left untouched, so it is still there when the
socket returns.

## The size of the UI

`applyScale` writes the root font size on `<html>`. Every length in the shell is
a rem — beercss's own and this client's alike — so that one number is the size of
the whole UI. It is script rather than a stylesheet because only script can ask
what display it is on, and it is written again on a resize since a window dragged
onto a second monitor changes the pixel ratio under it.

CSS fixes an inch at 96 px, so `screen.width / 96` is how many inches the
platform *believes* the display measures — not what a ruler gives, because the
platform has already divided by the distance it assumes the display is viewed
from. A phone of 2.7 real inches hands out the four inches of CSS pixels a small
monitor would: the CSS pixel is a unit of angle, not of glass, and on a phone, a
tablet and a monitor the platform gets that angle about right on its own.

The one display it gets wrong is a television. It hands out the pixels of a
twenty inch monitor for a screen watched from three metres and never grew the
pixel to match the room, so text at the base size lands on the eye at a fraction
of it. `getRootFontSize` scales a set by `tvScale * (width / 1920)`, clamped, and
gives a desk display past 30 apparent inches a gentle ramp with a 1.25 cap.
Everything else keeps 16 px: scaling a phone would undo work the platform did
correctly.

A set is identified by its user agent alone (`tvAgents` in `src/env.js`). The
tempting alternative — `pointer: coarse` + `hover: none`, or a screen reporting
no pointer and no hover — is also what a browser with no input device reports,
headless Chrome at 1280×720 included, which is a television's resolution exactly.
No media query separates the two. Missing a set costs it the desk size; taking a
desk display for a set would double the UI on someone's monitor, so the guess
only ever goes one way.

## The shell: segments, chrome, layers

The UI is two segments and a layer over both:

```
loading                 boot, and every time the connection drops
management              the navigation bars and the main surface
    new                 create a connection
    devices, shares     manage the existing ones
    services
    downloads           get the desktop client
    login
room                    the stream, the whole window, no chrome
```

A segment is the layer above the screens: the chrome that is on screen while any
of its own screens is. Which chrome belongs to which segment is a `data-segment`
attribute in the markup, and a screen names the segment it opens in (`static
segment`), so **neither is listed in the router** — new chrome needs no router
change. The router puts a segment on screen by hiding the `[data-segment]`
elements of the other one, and `body` carries the open segment as a class for
styles that follow the segment rather than the screen.

The loading layer is not a segment: it covers whichever one is open and gives it
back untouched.

`buildUI` mounts **every** module before the router runs, one dot-depth of the
registry id at a time. The tree is small enough that per-module laziness bought
nothing and cost a wait on the first click of each; it is also what the router
needs, since it can only hide chrome that is already in the document. A module
that mounts into another's markup has to follow it, which is what the dot-depth
ordering is for — `settings` carries the markup `settings.appearance` mounts
into. A module that throws is logged and skipped rather than taking the boot
down with it.

## The overlay and the loading layer

Both the loading layer and every dialog raise and lower the one shared overlay,
and they overlap: a dialog that opens its first window asks the router for a
module, and the loading layer handed back at the end of that load would take the
overlay out from under the dialog that is still open. So the overlay is held **by
name** (`overlay.take(holder, isBlurred)` / `overlay.release(holder)`) and is on
screen while anything holds it, blurred while anything holding it asked for the
blur. It starts held by `"loading"`, which is the state `index.html` is written
in.

The loading layer holds its own named set for the same reason. Two things ask for
it and they overlap: the connection, which holds it from boot until the server
answers and takes it back the moment it drops, and a module slow to arrive (the
router takes it as `"module"` after `LOADING_DELAY`). A screen that finishes
loading while the socket is down must not hand the layer back. `dismiss()` is the
exception — the version mismatch is terminal, so it clears every holder and
leaves the overlay to the dialog that replaces it.

## Permissions

`ctx["ui"].permissions` is the `permissions` block of the `conf-get` answer,
asked as a question rather than read as a value. The server answers every flag
for every client whether its configuration sets it or not (`buildPublicConf` in
`src/server/ws/handlers/conf.js`), so a flag that is not there is *an answer that has not
arrived* rather than a client-side default — and nothing but the loading layer is
on screen until it has, so "not yet" and "no" are the same thing to a module.

What the server would refuse is taken off the screen rather than left to fail at
the point of use, and a notice in its place says why. The checks run on every
`open()` and again on every reconnect, so a server that comes back configured
differently is followed.

The guest flags are the permissions of the user this client *is*, so they only
hold while it is the guest — `isGuest()` is the one place that has to learn about
accounts later.

Where an entry is refused, prefer greying it over removing it: an entry that is
gone says nothing, and what the user needs to know is that it was refused by the
administrator and not by this client. `nav-top` greys the add-account entry,
shows the reason in its tooltip, and removes the `data-route` — which is what
stops the click, since the router's delegated handler walks past an element with
no `[data-route]`.

## Users

The client is always a user. It starts as the guest and signing in adds an
account *beside* it rather than replacing it, so there is no signed-out state and
no second menu for one. Every user's records are rows of the one `user` table in
IndexedDB keyed by the id of the user they belong to; the guest is the row under
the empty id (`GUEST_ID` in `src/conf.js`), since a client is only ever one guest
and the empty key collides with no account id. The `configuration` table is not a
user's row, which is why a guest reset leaves the theme and the language alone.

Sign out means `resetUser("")` for the guest — forget the local connection
records, there is no session to end on the server — and a server session for an
account. The guest's name is a localization key rather than a value, so its menu
row follows a language change like the rest of the bar.

`OLD_GUEST_TABLE` is dropped on every open; a client that ran the two-table build
still carries it. Dropping a table that is not there is free, so it costs a
database version only once.

## Navigation

One delegated click handler on `document` answers every `[data-route]` and
`[data-dialog]` in the shell and in every module, so adding a screen wires no
buttons by hand. `#navigation` is a counter: the newest navigation wins over one
still loading.

`blurMenu` walks *up* the menu nesting because a beercss menu stays open until
whatever holds it loses focus, and a submenu hangs on an `<li>` that cannot hold
any — the walk is what reaches the element that does, e.g. the user-menu button
for an entry of the switch-account submenu inside it.

Rows built in script rather than written in `view.html` (the account rows, the
device and share boxes) are built because there is one per record, and a name
that comes from the server goes in as `textContent`, never as markup.

## The transport

`src/server.js` is not a UI module: the shell builds one `Server` and hands it to
every module in `ctx`. Nothing goes online without the `conf-get` answer, and
`wait()` reports a failed call in `message.error` rather than throwing, so the
answer has to be *checked*, not caught.

The version check compares the build of this client against the build of the
server process answering it. They are allowed to differ — a browser tab or an
installed desktop client is as old as the day it was loaded — but nothing past
that point is, so the connection ends there and the shell says how to get the
matching build. An outdated client does not reconnect: it would fail the same
check every two seconds, and going offline would put the loading layer back over
the mismatch the shell just showed.

Nothing the server pushes on its own is served yet; `handleIncoming` reads the
message to its end so the communicator can close it, and logs it.

## The registry

Every `import()` specifier in the route table is a **literal**, on purpose: a
built specifier works at runtime but hides every path from
`tests/assets.test.js`, and a mistyped path is the one class of error the browser
reports badly. A module is its code, its markup, its styles and its strings in
one round trip; `html`, `css` and `localization` are omitted when a module has
none. **A registry id is not its path** — `room-create` lives at
`ui/room/create/` and the id is what the shell, the markup and the router know it
by.

The localization dictionary grows with the UI: `src/localization.js` holds only
the shell slice (the loading layer of `index.html`, and the strings the two bars
share with the menu dialog), and the registry hands each module's
`localization.json` to `add()` while the module loads.

## Odds and ends worth keeping

- **beercss nav badges** are read as `nav.left > a > .badge`, so the narrow rail
  wants the badge as a direct child of the entry and the wide one wants it inside
  the wrapper beside the icon. `nav-left` re-parents it when the width changes.
- **The theme is applied in two goes.** beercss derives the mode from the theme
  it just built, so `ui("theme", …)` and `ui("mode", …)` cannot be set in one
  tick — hence the `setTimeout(…, 1)` in `applyTheme`.
- **Media device lists** come back unnamed and id-less until the page has been
  granted access once, so `media-devices.js` asks again after a `getUserMedia`
  call.
- **The downloads screen** offers exactly the zips in the generated `index.json`
  it was served with (`buildConfFile` in `src/server/building.js`). `OS_NAMES`
  maps every spelling of the same platform — node's names, which the `bin/`
  folders follow, and the names a user reads — onto the one name the screen holds
  it under, so a zip is never dropped over the name it carries.
- **Download links** are root-absolute for the browser, which is served by that
  same HTTP server. The desktop shell is served by its own `local://` protocol,
  so it has to be told where the server is and hands the link to the system
  browser — the one link that leaves the app.
- **The version dialog** points a desktop client at the HTTP server it was built
  against, which serves the matching download. A browser tab has nothing to
  install, so it keeps its translated message and the user is sent to whoever
  runs the server.

## What is not wired yet

The server was cut back to the socket lifecycle and `conf-get`; the UI for what
went with it is present but inert, and each piece is planned under `dev/plans/`.
The previous client implementation is at commit `da3921d`, and it read message
types the server no longer serves — do not paste it back untouched.

| Module | Waiting on |
| --- | --- |
| `management/new` (both flows) | `dev/plans/ws-pairing-joins.md` |
| `room/create`, `room/joining`, `room/request` | `dev/plans/ws-pairing-joins.md` |
| `management/devices`, `management/shares` (and their `*-box.js`) | `dev/plans/ws-pairing-joins.md` |
| `management/account/*` (information, sessions, delete) | `dev/plans/ws-accounts.md` |
| `nav-top` `setAccounts()` — the list is the guest alone | `dev/plans/ws-accounts.md` |

`management/search` is a separate case: the field it mirrors and the button that
opens it are both still commented out in the shell markup, so nothing opens it.
