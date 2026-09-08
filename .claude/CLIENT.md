# Client reference

Why the browser client is put together the way it is. `CLAUDE.md` has the layout
and the module contract; this holds the reasoning that used to sit in the source
comments, so the files themselves can stay thin. `src/client/web` unless a path
says otherwise.

## Boot

`index.js` is five stages and nothing else: the environment, the configuration,
the shell, the UI, then the connection. Everything that touches the document
lives in `ui/ui.js` — the appearance and language settings, the overlay, the
loading layer, the snackbar, the `ctx["ui"]` namespace, and the build that mounts every
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

## The snackbar

`ctx["ui"].snackbar.show(message, isError)` is the one place a call that failed
says so out loud. It is built in script rather than written into `index.html`,
because unlike the loading layer nothing needs it before the first module, and
beercss already puts a `.snackbar` at the bottom of the window — under the
loading layer and over the dialogs, which is the order `index.css` writes down.
The message is set as `textContent`: it is a string a module chose, and the
reason inside it came from a server.

It takes itself off screen after six seconds and on a click, and a second
message restarts that clock rather than inheriting what is left of the first
one's. The text belongs to the module that shows it — the shell slice carries no
strings for it.

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

The room's own wait (`room-loading`) is **not** a holder of this layer and never
takes it: it waits for the other device rather than for the server, and it is a
dialog *under* the layer, so a socket that drops replaces it — see The room.

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
that comes from the server goes in as `textContent`, never as markup. Their own
labels carry `data-localization` like any other markup, but nothing translates
them on their own — a card is built long after the module it belongs to was
translated — so the screen hands each one to `translate(lang, box.el)` as it
builds it. A label that changes with the record's state (a card's *Connect* and
*Offline*) is two spans and a `hide`, not a string set from script, so the card
is translated once and never again.

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

What the server says on its own arrives at `handleIncoming`, which reads the
message to its end so the communicator can close it and hands it on as an event
of the same name — `PUSH_EVENTS` is the list, and a type outside it is logged
rather than dispatched. The pairing flow is the whole of that list today, and a
module listens for the ones it is in the middle of rather than the transport
holding state about them.

`createPairCode`/`deletePairCode` are the connection code the share flow hands
out, and `pairRequest`/`pairAccept`/`pairReject` are the join attempt it
introduces. `createPairCode` hands back the code and nothing else: it has no
lifetime to report. What they throw carries the *reason* as the message — the server's
own error name (`not-allowed`, `busy`, `unknown-code`), or the transport's when
the call never got an answer — because turning a reason into something a user
reads is the caller's job, not the transport's.

## The pairing flow

Three dialogs and one code. `room/create` holds the code and steps aside;
`room/joining` is the wait on the peer; `room/request` is the decision on the
host. Each owns its own half of the conversation, and none of them holds state
the server does not.

The one clock is the server's, not the client's: `conf-get` carries
`pairing.answerTimeout` and the answer to a request repeats it. That is what
makes both bars mean something — a bar drawn against a number the client invented
would be a spinner with extra steps. The code itself has no clock at all: it
stands while the share dialog is offering it, so nothing on either side
refreshes it, and only a refusal replaces one. Until the server has answered, `room/joining` shows the *indeterminate*
bar (a `<progress>` with no `value`), because at that moment there is genuinely
no length to draw.

On the host, the bar runs across the reject button rather than beside the pair of
them: rejecting is what happens if nothing is clicked, so the button that fills
up is the button that will act, and the line under it says so. The dialog answers
half a second before the server's own clock, so the other side hears the host's
decision rather than a timeout the host was never told about.

Two orderings are load-bearing, and both were bugs first:

- **The accept has to leave before the flow is torn down.** Closing the share
  dialog gives the code back (`pair-delete`), and a code given back while a
  request is pending *is* a rejection — so `room/request` dispatches its `done`
  event only once `pairAccept()` has returned, and `room/create` tears down on
  that event rather than on the click.
- **`close()` never talks to the server.** A dialog of this flow is also closed
  *for* it — the request ended from the other side, or the shell dropped every
  dialog when the socket did — so only the explicit paths (the close button, the
  countdown, the two answers) send anything. Closing on an answer that already
  arrived would answer it back.

A rejected code is replaced by the server, and the new one arrives as a
`pair-code` push into the field the old one was in. Nothing on the host asks for
it: the dialog that shows a code takes whichever code it is given.

## Remembered devices

The host may add two things to a yes, and `room/request` is where both live.
**Remember** writes a join: a row on the server and a record on each side of it,
each holding its own code. **Unattended** appears only once remember is ticked,
because it says something about a device you are keeping - that it may come back
without anybody being asked - and means nothing about one you are not.

`src/joins.js` (`ctx["joins"]`) is this client's half of that, and the local
record is the whole of it: there is no account behind a join, so **the code is
the credential** and a client that loses its records has lost the devices. They
live in the guest row of the local database (`getJoins`/`setJoin`/`removeJoin` in
`src/conf.js`), which is why signing the guest out drops them with everything
else.

`connectAll()` runs on every `online`, before the screen is even up: a host is
only reachable on the joins it has connected, and nothing on screen asks for
that. A code the server does not know is dropped locally on the spot - the other
side deleted it while this one was away. The devices and shares screens then read
the local records and ask the server only for who is online, which is the one
thing a local record cannot know.

**A connection has a name, and it is this side's own.** `join-rename` writes it
to the caller's own column on the row (`peer_name` for a host, `host_name` for a
peer) and nothing is pushed to the other end, which keeps whatever it called this
one. It is on the row rather than only in the local record so a device presenting
the same code again is handed it back: `rename()` writes both, and `connectAll()`
adopts what `join-connect` answers when that is not empty - an empty one is a
connection nobody has named, not a name somebody cleared, so the local record
stands. `management/connection` is the dialog, and a rename made while the socket
is down is local only, since the call cannot be made.

Who is on the other side of a join arrives the same way: `join-online` is pushed
to each side as the other's first socket appears and its last one goes, so
presence is the server's answer rather than the age of the last screen that
looked. `ctx["joins"]` keeps it on the record, drops all of it on `offline` -
nobody is reachable until `connectAll()` has presented the codes on the next
socket - and fires `change` for whatever draws it.

**The shares entry of the two bars is what draws it today.** `countOnline(true)`
is the devices on the host side of this client that are there right now, and the
badge is shown while that is not zero: a machine sharing its screen is one whose
user is looking at something else, so the bar says it is not alone and the screen
behind the entry says who. It is a dot rather than a count - a beercss badge is
`var(--error)` and `min` clips it to one - which is also why `nav-left` and the
`menu` dialog of the small layout carry the same two lines against their own
badge.

**A device that comes back is answered wherever the shell happens to be.** That
is the difference between a join request and a pair request: the pairing dialog
is open by definition, a returning device arrives at a client that may be
anywhere. So `room/request` listens for `join-request` from `mount()` and opens
itself, rather than being opened by something that has to be open already. One
request is answered at a time - a second is refused rather than queued behind the
dialog - and an unsupervised join never arrives at all, which is exactly what the
host agreed to.

Asking to come back in is the same wait as a first pairing, so it is the same
dialog: `room/joining` takes a `mode` and sends either `pair-request` or
`join-request` itself. An unsupervised join is answered by the server in that
first call, so that one is over before the bar has moved.

The code is the server's to make - six digits, so it can be read out loud - and
it belongs to the socket it was asked on: the server drops it when the connection
goes, which is why the share dialog asks for one when it opens and gives it back
when it closes. `createPairCode` hands back the code and nothing else, so nothing
on either side refreshes it.

## The connection

`ctx["room"]` (`src/room.js`) is the live connection between this device and the
other one, and it is the shell's rather than the room screen's: **the host holds
one while it is on its own screens**, so a screen cannot own it.

Nothing opens it by hand. The server puts the two sockets in a room when a
request is accepted and tells them both (`room-open`), so an accepted pairing, a
remembered device let back in and an unsupervised one nobody was asked about all
arrive here down the same path - and the same message says which side this
socket is. **Which side decides who offers**: the peer asked for the connection,
so the peer opens it and the host answers. One rule, rather than a negotiation
about who negotiates.

What crosses the server is SDP and ICE and nothing else, one message per call
(`room-signal`), so the server holds nothing between two of them. Three details
are worth keeping, and two of them are the same mistake at different heights:

- an ICE candidate that arrives **before the description it belongs to** is held
  until one is set - both ends start gathering at once and the messages cross;
- a signal that arrives **before this side's own `room-open`** is held by room id
  and replayed when it comes. The two ends are told about the room in two
  separate messages and the offer chases them, so on a slow or backgrounded
  socket the first signal can land first - and a dropped offer is a negotiation
  that never starts, which is a wait that never ends;
- the *null* candidate that ends gathering is not sent, since it says nothing the
  other end needs.

A description that cannot be *sent* ends the attempt (`leave("failed")`) rather
than leaving a connection nobody is negotiating: there is nothing after it to
recover with. Every step logs one line - `Room <id> open as peer`, `sent offer`,
`is connecting`, `is connected`, `closed (reason)` - so a connection that does not
come up says how far it got, on both machines.

**There is no TURN server in this project: the WebSocket server is the relay.**
A connection that cannot be made directly is carried by the same socket both ends
already hold, if the server allows one. ICE is given `DIRECT_TIMEOUT` (12 s, and an ICE `failed` before that), and
then what would have crossed between the two devices crosses the server instead
(`room-data`). Three things are worth keeping straight:

- **the clock is the client's, not ICE's.** A connection that never gathers a
  usable candidate reports nothing at all, so waiting for `failed` is waiting for
  a message that may never come;
- **both ends have to give up together**, and they will not do it at the same
  moment: whoever gets there first sends a `relay` signal and the other follows
  on the spot. A first relayed message is taken as the same statement, for the
  case where that signal is the one that went missing;
- **a fallback that is not allowed is not waited for.** `guestAllowRelay` is
  answered to every client in `permissions` (it is off unless the configuration
  says otherwise, since it spends the server's own bandwidth), and where it is
  off a failed direct attempt ends the room rather than hanging on one;
- **a direct connection that is *lost* is the same case as one that was never
  made.** A channel that closes mid-room says nothing about why - the other end
  leaving and the path between them breaking look identical from there, and what
  tells them apart arrives on the socket rather than on the channel - so the room
  is given `CLOSE_GRACE` (1 s) to hear a `room-close`, and what is still a room
  afterwards moves onto the relay instead of ending. The screen does not blink:
  the state stays `connected` and only the indicator appears.

`send()` is the same call in both modes and `message` the same event, so nothing
above the transport knows which it is on. **On the relay it has no size limit**:
whatever is handed in becomes a binary frame (`buildRoomFrame` in
`src/server.js`, bytes as they are and anything else JSON-encoded), and the
communicator splits that into packets and puts it together again at the far end -
which a JSON message is *not* subject to, and is the whole reason the frame
exists. Two things follow that the stream work has to know:

- **frames can finish out of order.** `send()` resolves when the last packet has
  left, not when the far end has the message, so a big frame is still being
  reassembled while a small one sent after it arrives whole. Anything that cares
  about order carries its own sequence.
- **both legs are the same protocol.** The data channel is wrapped in a
  `Communicator` exactly as the socket is, so packets, acknowledgments and
  reassembly happen on a direct connection too - which is what lets `send()` be
  one call with one behaviour, and lifts the per-message ceiling a raw
  `RTCDataChannel` has (a few hundred kilobytes). Its packet is 16 KB, the size
  every browser agrees on, against the socket's 1 KB: no proxy sits in the middle
  of this one. The room bar is the exception, and
deliberately: a relayed connection is slower and is worth saying so - the
indicator is in the empty track the centring already leaves, and it is only ever
shown when it is true, because an indicator for the expected case is one more
light to learn to ignore.

**"Connected" means the two ends have exchanged packets**, not that ICE says so
and not only that the channel opened: the channel opening says *this* end is
ready, and the `sideSync`/`timeSync` that follows says the two of them actually
reached each other, which is later and truer. A channel that opens but cannot be
synced is not a connection - it is left to the direct clock, which takes the
relay - so the sync failing must never report `connected`.

The communicator is built when the channel is wired rather than when it opens:
the other end opens at its own moment and can sync into this one first, and a
packet that arrives before there is anything to receive it is a negotiation that
hangs. It carries no media and nothing is sent on it yet - it
is the handshake that proves the path, and the seam the control protocol and the
stream land on (`getConnection()`/`getChannel()`).

The two ways out are not the same. `leave()` is this side deciding: it tears the
connection down **and** tells the server, so the other end hears `room-close` and
stops. A `room-close` that arrives from the server is the other end having gone,
and only takes this side down. Either way the state ends at `closed` and the
event says why. One room at a time on this client - a second `room-open` replaces
the first - which the server does not impose and a host with two peers will
eventually need.

## The room

The room is the **peer's** side of a connection - the one looking at somebody
else's screen - and the bar under the stream is that peer's half of it: what it
hears, what it drives, and how much of the line the host is allowed to spend on
it. Nothing carries any of it to a host yet, so the whole bar ends in one
`settings` event on the screen and a `getSettings()` beside it, which is the
seam the stream is wired to when it lands.

**The bandwidth is the cap, and the resolution is priced against it.** One table
in `ui/room/index.js` says what each picture costs to send, and the Mbps the peer
allows is what decides which of them may be asked for at all - a resolution the
line cannot carry is not paid for in sharpness but in a picture that arrives late
and in pieces. So the entries over the cap are greyed and inert with their price
beside them (an entry that is simply gone says nothing - see Permissions), the
`automatic` entry is the cap itself and follows it, and a resolution that was
chosen by name is brought **down** when the bandwidth moves under it, with the
snackbar saying which one it is now. There is no path that leaves the bar showing
a picture that is not being asked for.

**A wait that is not going to end stops claiming to be one.** The screen gives
the other device `CONNECT_TIMEOUT` (20 s, longer than ICE needs on any path that
works) and then swaps the dialog's title, text and bar for *not connected* -
nothing here retries, so what runs out is the claim that something is happening,
and the quit button becomes the only thing left to do. A connection that drops
later goes to the same state.

**The wait ends when the connection does.** `room-loading` is up while
`ctx["room"]` is not connected: the screen listens for `connected` and lifts it,
and for `closed` and puts it back with the snackbar saying so - a connection that
drops leaves the peer looking at the wait it came in through, with the quit
button in it, rather than at a bar that controls nothing. `open()` asks
`isConnected()` rather than assuming: the socket dropping and coming back reopens
this screen, and the connection between the two devices does not run through that
socket.

**There are two waits and they are not the same wait.** The shell's loading
layer is the one that covers a server that has gone away; `room-loading` is the
wait for the *other device*, and it is an ordinary dialog under it (`dialog` is
z-index 102 in `index.css`, the layer is 300). That ordering is the whole
behaviour: while the socket is down the shell closes every dialog and raises its
own layer, so a client that cannot reach a server is never also claiming to be
reaching a host - and when the socket comes back, `loadPath()` opens the room
again and its own wait returns with it.

**A room is entered *for* something**, and either the path or the flow says so.
`/room/<joinId>` is a remembered device - an address this client can be sent back
to - and the room waits when the route carries one. A pairing the host did not
remember has no id anywhere to put in a URL, so the dialog that accepted it
navigates with `isConnecting` instead (`navigate(path, params)`; the params are
gone after a reload, which is right - so is the pairing). `/room` typed by hand is
neither, and is the bar with nothing in front of it.

`setConnecting(false)` is what ends the wait, and nothing calls it yet - the
thing that would is the stream.

**An accepted request now moves both sides, and they move to different places.**
The peer goes into the room it was asking for (`room/joining`, which handles the
pairing, the remembered join and the unsupervised one that the server answers in
the first call). The host goes to its own list: a yes it asked to *remember* is a
connection it now keeps, so `room/create` lands on `management/shares` with that
connection's settings open on it, because naming it is the one thing worth doing
to a connection the moment it is made. A yes that was not remembered leaves
nothing behind, so that host stays where it is - and a device let back in through
`join-request` does not move the host either, since it was not deciding anything
new. An unsupervised join never reaches the host at all.

The wait carries a **quit** button, and it is a button rather than a question:
the case it exists for is a host that is answering nothing, so asking one more
thing that needs an answer is the one option it cannot offer. It dispatches
`quit`, the room leaves, and the close guard goes with the screen.

**A room is left through a question, and there are two of them** - the same
question, asked by whoever owns the window:

- the leaving button on the bar opens `room-exit`, which decides nothing and
  hands its answer back as `done`, the way `room/request` does;
- the window's own close button is the shell's to answer. A browser tab is held
  by `beforeunload`, and the wording there has not been the page's to write for
  years - only whether there is a dialog at all. Electron does **not** do the
  same thing: a renderer that holds a close through `beforeunload` cancels it
  *silently*, which would leave a window nobody could shut, so the desktop shell
  is handed the strings instead (`set-close-guard`) and asks natively from
  `main.js`. That is why the room translates the question itself and passes it
  down rather than letting the shell word it.

The guard belongs to being in the room and not to the way it is left:
`open()` takes it and `close()` gives it back, so a navigation, a dropped
connection and the leaving button all end it the same way.

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

The pairing and join flows are live; what is still cut out of the server is the
accounts half and the WebRTC signaling relay, and the UI for those is present but
inert. Each piece is planned under `dev/plans/`. The previous client
implementation is at commit `da3921d`, and it read message types the server no
longer serves — do not paste it back untouched.

| Module | Waiting on |
| --- | --- |
| `management/new`, `room/create`, `room/joining`, `room/request`, `management/devices`, `management/shares` — pairing, remembering and reconnecting are live, and an accepted request now opens the room on the peer and the connection's settings on the host; what the room leads *into* is not | `dev/plans/ws-pairing-joins.md` |
| `room` — the peer's bar is built and answers itself (sound, control, the bandwidth cap, fullscreen, leaving), and the connection behind it is negotiated and reported; what none of it does yet is carry a picture — no stream is attached to the `<video>`, nothing is sent on the data channel, and the bar's `settings` event reaches nobody | `dev/plans/ws-pairing-joins.md` |
| the *settings* entry of a `devices` card opens nothing yet — `management/connection`, which names and forgets a connection, is the dialog it wants | `dev/plans/ws-pairing-joins.md` |
| `management/account/*` (information, sessions, delete) | `dev/plans/ws-accounts.md` |
| `nav-top` `setAccounts()` — the list is the guest alone | `dev/plans/ws-accounts.md` |

`management/search` is a separate case: the field it mirrors and the button that
opens it are both still commented out in the shell markup, so nothing opens it.
