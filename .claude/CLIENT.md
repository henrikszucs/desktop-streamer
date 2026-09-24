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
down with it - and the failure is not kept: `registry.load` forgets a build that
failed, takes back out whatever markup it had already mounted, and remembers no
stylesheet that did not load, so the next time the module is asked for (the
router opening it) it is built again rather than failing for the life of the
page over one request that failed at boot.

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
hold while it is the guest — `isGuest()` asks `ctx["account"]` (see Users), and
is the one place the permissions know about accounts.

Where an entry is refused, prefer greying it over removing it: an entry that is
gone says nothing, and what the user needs to know is that it was refused by the
administrator and not by this client. `nav-top` greys the add-account entry,
shows the reason in its tooltip, and removes the `data-route` — which is what
stops the click, since the router's delegated handler walks past an element with
no `[data-route]`.

The login screen is reachable by URL whatever the server answers, so it has a
notice for each way there can be nothing to sign in with. `isAuth()` false is
the administrator's decision and gets `main.authDisabled`, the same string as
the bar's tooltip. A provider that *is* offered can still fail in the browser:
Google's button is a script fetched from Google itself, and offline, behind a
filter or with the script blocked by an extension there would be an empty
screen and no error.

**The Google button is framed, never loaded into the page.** The desktop
shell's window runs with Node (`nodeIntegration`, no context isolation), so a
script in it is a script with the whole machine - and Google's is a stranger's
script. `login/google.js` puts an iframe of `login/google-frame.html` on the
screen instead, served by the HTTP server (this page's own origin in a browser,
`conf["http"]`'s under the desktop shell, which is on `local://`), and Google's
script runs in there: a frame is a plain web page (`nodeIntegrationInSubFrames`
is off, and `main.js` says so), and the server's origin is also the one Google
has the client id for. The frame says `ready` or `error`, its `size` as the
button lands, and the `credential`; the screen listens to its own frames on that
origin alone, and the frame posts only to its own origin and `local://local.local`
and renders nothing for any other parent - a credential is a sign-in to this
server, so a page elsewhere that frames it hears nothing. `createButton()`
resolves to whether the frame got a button, with `LOAD_TIMEOUT` behind it, and a
failure shows `login.unavailable` with a retry instead of the button; the frame
is drawn in the `normal` colour scheme, since a frame whose scheme differs from
the page's is painted opaque. Inside, the button is rendered through
`google.accounts.id.renderButton` rather
than the declarative `g_id_onload` markup, which Google's script only parses
once at its own load and so would never draw a button created after it. The
button is rendered at `size: "medium"` on purpose: Google personalizes the
button ("Sign in as *Name*", with the picture) whenever the browser holds a
session that approved this client id, there is no option against it, and the
only documented way not to get it is a button below `large` — so the screen
always reads "Sign in with Google" and shows nobody's account.

Beneath the sign-in is the account recovery, for somebody locked out of their
own account by a session that keeps ending theirs. It is kept quiet — well
below the sign-in, a plain bordered button in the middle rather than a red one
— so the eye lands on the sign-in first. Google's button is the only
way to get a credential, so the recovery button does not call anything — it opens a
panel with a Google button of its own and hides the sign-in one, and `mode` on
the screen says what the one credential that can now arrive is for. `recover()`
calls `account.recover()`, which sends `sessions-revoke`: every session of the
account ends, none starts, the local record goes, and the route is redrawn as
the guest if this client was that account. The screen stays, since signing in
again is what comes next.

## Users

The client is always a user. It starts as the guest and signing in adds an
account *beside* it rather than replacing it, so there is no signed-out state and
no second menu for one. `src/management/account.js` (`ctx["account"]`) is that model: the
accounts this client holds are `accounts` in the local configuration — each with
the `sessionKey` the server answered once to `login-google` and the profile as it
was last seen — and `userId` is the one the client wants to be, `""` for the
guest. Who it *is* is `liveId`, filled only by the server's answer: the server
holds who a socket is for that socket alone, so `resume()` presents the wanted
key through `login-session` on every `online`, before the route is drawn, and
a key the server no longer knows (ended from another device, or run out) drops
the record on the spot. A reconnect does not flip the bar to the guest and back:
`liveId` is left alone while the loading layer is up and `resume()` sets it
again. The Google credential goes from the login screen's `login` event to
`loginGoogle()`, and a yes navigates home — the bar follows the `change` event.
Signing in again as an account this client already holds sends that record's
`sessionKey` along — the e-mail is read off the credential's payload only to
find the record, never trusted — and the server hands the same session back,
so the record is refreshed rather than doubled and the sessions list shows one
device once.
`switchTo("")` is `login-guest`, which leaves the session for the device to come
back to; `logout()` is `logout`, which ends it on every socket presenting it.
A `logout` pushed by the server — this device signed out from another one — is
answered the way a sign out from here is: the record dropped, the dialogs
closed, the route redrawn. Every user's records are rows of the one `user` table in
IndexedDB keyed by the id of the user they belong to; the guest is the row under
the empty id (`GUEST_ID` in `src/conf.js`), since a client is only ever one guest
and the empty key collides with no account id. The `configuration` table is not a
user's row, which is why a guest reset leaves the theme and the language alone.

Sign out means `resetUser("")` for the guest — forget the local connection
records, there is no session to end on the server — and `account.logout()` for an
account; both end in `refresh()`, `closeDialogs()` and `reload()`, since the
route was drawn for the user before. The guest's name is a localization key rather than a value, so its menu
row follows a language change like the rest of the bar — unless the guest gave
itself one in the account dialog, which is kept on its row (`name`, beside the
joins) and shown as text instead.

The confirm dialog carries an overlay of its own (`#dialog-confirm-overlay`, mounted from its `view.html` beside the dialog and toggled in `show()`/`hide()`): it is only ever opened nested, and the shared overlay is already held by the dialog asking and sits *under* it, so without one the question and the dialog behind it would stand side by side with nothing to say which is live. A click on it is a no, like a click on the shared overlay for any other dialog; `index.css` stacks it over every dialog and the question over it.

The guest's sign out cannot be taken back, so `logout()` in `nav-top` asks
through the confirm dialog first, and a yes is three things: the row dropped,
`joins.reset()` — the memory records cleared and `join-disconnect` sent, since
the server had this socket presented on the old codes (`join-connect`) and
would otherwise go on answering for a device that dropped them until the socket
actually closed — and the route drawn again (`ui.reload()`) under the dialogs
that go, because the devices screen reads its records once on open rather than
following `change`. The socket is kept: closing it would have done the same
through the shell's `offline`/`online` handlers, at the cost of the reconnect
wait under the loading layer.

The account dialog is not the same column for every user. `open()` asks
`permissions.isGuest()` and shows the buttons marked with that `data-user`: the
guest has its name (`account.guest`, the *Name* button — the field opens on the name the bar shows, the localized "Guest" when the row has none, and saving that default back keeps the row empty so the name goes on following the language) and a delete (`account.reset`) that is the
bar's `logout()` reached through `loadModule("nav-top")` — one call, so the
menu's sign out and the dialog's delete cannot drift apart — where an account
has the information, sessions and delete windows. The guest's name window
reaches the bar the same way and calls `refresh()` after a save so the row
follows it. The account's `information` window edits the two names through
`account.update()` — the e-mail is the provider's and stays disabled — and the
bar follows on `change`; a change pushed from another device (`user-change`)
refills the fields while the window is open. `sessions` lists
`account.sessions()` on every open in the `SessionBox` rows, and the button on
a row is one of two things: on this device it is the bar's `logout()` again,
on another it is `endSession()` and the row goes. `delete` is the account's
end, in two halves. *Send delete key* is `account.requestDelete()` — the server
mails a key to the account's address (`delete-email`, in the client's language)
and the module notes **this device asked**: `{userId, sessionId, expire}` in the
tab's `sessionStorage` rather than the local configuration, since the key is
only good on the account session that asked (the server binds the row to it)
and asking again is one click — so it survives a reload of this tab and reaches
no other tab or device, with memory standing in where storage throws. `setStage()`
is the gate: the key field and *Delete my account* are disabled, and the notice
under the send button hidden, unless `hasDeleteRequest()` is true — the request
names the current account on its current session and has not run out — checked
on every open and again after a send, so the second half only opens on the
device that asked. A `too-soon` answer (the server's cooldown) is its own line
rather than the generic failure, and pressing send again is safe: the server
holds one code per account and mails the same one again. *Delete my account*
asks `hasDeleteRequest()` once more — the key may have run out while the field
stood open — and a device that no longer holds a request is told so and the
field closed, without the server being asked; only then is the confirm dialog opened (`confirm.deleteAccount`,
the one line that says it cannot be undone), and only a yes calls
`account.deleteAccount(key)` — the `delete` call, then the record dropped and
`change` emitted, so the bar is the guest's. The window then does what the
bar's sign out does after the call: `navTop.refresh()`, `closeDialogs()`,
`reload()`, and a snackbar that says it happened. An `invalid-key` answer — a
wrong code, another device's, one that ran out — is one notice, since the
person's move is the same for all three: check the code or send a new one.

The settings dialog's *About* window holds the reset of the local settings: `resetLocal()` in `src/conf.js` writes every `LOCAL_DEFAULTS` key back except `accounts`/`userId` (the `color` and `mode` among them are the server's `appearance` from `index.json` where it names them) — who this client is signed in as is not a setting — and the window then calls `ui.applyLocal()` — `applyLocal` in `ui/ui.js`, the one call boot applies the theme, the language and the desktop's tray and language with, so the defaults land in place the way any value does and nothing reloads; the other settings windows read their values on `open()` and so show the defaults the next time they are opened. Auto launch is a state of the system rather than a row, so it is switched off by name beside it. It is asked through the confirm dialog like every other thing that cannot be taken back.

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
rather than dispatched. Seventeen types today, one set per flow: the pairing
(`pair-request`, `pair-accept`, `pair-reject`, `pair-cancel`, `pair-code`), the
joins (`join-request`, `join-accept`, `join-reject`, `join-cancel`,
`join-remove`, `join-online`), the room (`room-open`, `room-signal`,
`room-data`, `room-close`) and the account (`user-change`, `logout`). A module
listens for the ones it is in the middle of rather than the transport holding
state about them, so a new push is a line in that set and a listener in the
module it concerns.

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

`src/management/joins.js` (`ctx["joins"]`) is this client's half of that, and **the two
sides are kept in different places**. A share is the machine's: its record lives
in the guest row of the local database (`getJoins`/`setJoin`/`removeJoin` in
`src/conf.js`, under `GUEST_ID`) whoever is signed in, so the host code never
leaves this client and the shares screen shows every user of it the same list.
A device is the person's: its record lives in the row of the user the client is
right now, so the devices screen shows only that user's - the guest's are the
codes it holds and go with the guest row when it is reset, and an account's are
handed to any client it signs in on by `join-sync`, since the server wrote the
account on the row when the pair was made. `rowOf(isHost)` in `joins.js` is the
one place that decides which row a record goes in, and an account forgotten here
(`dropRecord` in `src/management/account.js`) takes its row with it - the server has the
devices back at the next sign-in.

**One join, one side per client.** The two sides of a join carry the same
`joinId`, and `records` holds one record per id - so a join this machine hosts
is a share here and nothing else, and the device side of it is the other
machine's whoever is signed in on both. `join-sync` cannot know that: the row
carries the peer's account and no host, so when the *same* account is signed
in on both machines (one person, two devices - or two windows of one browser,
which share the stored accounts) the host is handed its own share back as a
device of that account. `syncAccount()` skips an entry whose id is a share
here, `load()` skips a device record with a share's id and drops the row entry
an older sync wrote, and `remember()` refuses the device side of a join already
hosted here. Without the three the sync overwrote the share record at every
sign-in as that account - the shares screen emptied on the switch and the host
presented the peer code from its own socket. What is still not supported is two
windows of one browser pairing *with each other*: they are one client on both
sides of one join and one guest row, and neither side's record can stand
without the other's going.

`connectAll()` runs on every `online`, before the screen is even up: a host is
only reachable on the joins it has connected, and nothing on screen asks for
that. It loads the rows, asks `join-sync` for an account, and presents every code
that this socket has not presented yet (`isConnected`, cleared on `offline`). A
code the server does not know is dropped locally on the spot - the other side
deleted it while this one was away. **A switch of user is a switch of devices**:
`joins` listens to the account's `change`, and when the id differs from the one
whose devices are held it drops those records and starts one sync that takes the
socket off them with a scoped `join-disconnect`, loads the new user's rows and
presents their codes - the shares are left exactly where they were. **The sync
is one wait, started before the change is told**: `list()` waits on a sync in
flight, so a screen that answers the switch is drawn from the new user's records
only once the server holds this socket on them; drawn any earlier, every device
would come out offline and stay that way. A second `connectAll()` for the same
user while one is in flight joins it rather than presenting every code twice,
which is what makes the boot's own call and the listener's coexist, and a
generation counter is what an answer from before a switch is checked against, so
a code presented for the old user cannot put a record back that the switch took
out. The devices and shares screens then read the records and ask the server
only for who is online, which is the one thing a local record cannot know.
`list()` emits nothing, and that is what lets both screens re-run a build that a
`change` interrupted (`isPending`) instead of dropping the change - the codes
presented after a switch land while the screen is mid-build more often than not. What is not pushed between two clients of one account: a device
remembered or renamed on one reaches the other at its next `connectAll()`, a
device deleted on one reaches the other at once (`join-remove` goes to every
socket on the join).

**A connection has a name, and it is this side's own.** `join-rename` writes it
to the caller's own column on the row (`peer_name` for a host, `host_name` for a
peer) and nothing is pushed to the other end, which keeps whatever it called this
one. It is on the row rather than only in the local record so a device presenting
the same code again is handed it back: `rename()` writes both, and `connectAll()`
adopts what `join-connect` answers when that is not empty - an empty one is a
connection nobody has named, not a name somebody cleared, so the local record
stands. `management/connection` is the dialog, and a rename made while the socket
is down is local only, since the call cannot be made. The same dialog names the
live share, where there is no row and no call at all - see "A share is not only a
record" below. **The dialog follows the connection it is about**: it listens to
the `change` of `ctx["joins"]` (and the room's `closed`, for the live share)
while it stands, and when its record is gone - the other side deleted it, the
push `join-remove` having dropped the row - it closes, its nested confirm with
it, and says why in the snackbar; a name saved onto a row that no longer exists
would otherwise be answered `connection.unknown` after the fact. Its own delete
sets `isRemoving` first, since the records change the same way for both.

Who is on the other side of a join arrives the same way: `join-online` is pushed
to each side as the other's first socket appears and its last one goes, so
presence is the server's answer rather than the age of the last screen that
looked. `ctx["joins"]` keeps it on the record, drops all of it on `offline` -
nobody is reachable until `connectAll()` has presented the codes on the next
socket - and fires `change` for whatever draws it.

**The shares screen is what draws it; the badge on the two bars does not.**
`countOnline(true)` is the devices on the host side of this client that are
there right now, and it stays a question for the screen: a remembered device
being online means it *could* ask, not that anything is crossing to it. The
badge is lit by `room.isSharing()` alone - this client is the host of a room
that stands - because a machine sharing its screen is one whose user is looking
at something else, so the bar says somebody is on this machine and the screen
behind the entry says who. It is a dot rather than a count - a beercss badge is
`var(--error)` and `min` clips it to one - which is also why `nav-left` and the
`menu` dialog of the small layout carry the same two lines against their own
badge, each listening to the room's `connecting` and `closed` edges and to
nothing of the records.

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
first call, so that one is over before the bar has moved - and it goes into the
room without the snackbar an accept is announced with (`enterRoom` alone, not
`onPairAccept`): nobody decided anything, and a device that walks in every time
would be told "the host accepted" every time.

The code is the server's to make - six digits, so it can be read out loud - and
it belongs to the socket it was asked on: the server drops it when the connection
goes, which is why the share dialog asks for one when it opens and gives it back
when it closes. `createPairCode` hands back the code and nothing else, so nothing
on either side refreshes it.

## The connection

`ctx["room"]` (`src/room/room.js`) is the live connection between this device and the
other one, and it is the shell's rather than the room screen's: **the host holds
one while it is on its own screens**, so a screen cannot own it.

Nothing opens it by hand. The server puts the two sockets in a room when a
request is accepted and tells them both (`room-open`), so an accepted pairing, a
remembered device let back in and an unsupervised one nobody was asked about all
arrive here down the same path - and the same message says which side this
socket is. **Which side decides who offers**: the peer asked for the connection,
so the peer opens it and the host answers. One rule, rather than a negotiation
about who negotiates.

**What that message carries is a key, not an id**, and it is this side's alone.
The two ends of one room hold different keys and neither is ever told the
other's: every room call presents the caller's own (`roomKey`), the server checks
both that it minted it and that this socket is the side it gave it to, and
everything it carries across - a signal, a relayed message, the close - is
re-addressed to the receiver's key on the way, the binary frame included. So a
key that leaks names one side and works from one socket, and a client that has
somehow kept more than it should still cannot do the other half. `getRoomKey()`
is what this client knows the room by; there is no id behind it that both sides
share.

What crosses the server is SDP and ICE and nothing else, one message per call
(`room-signal`), so the server holds nothing between two of them. Three details
are worth keeping, and two of them are the same mistake at different heights:

- an ICE candidate that arrives **before the description it belongs to** is held
  until one is set - both ends start gathering at once and the messages cross;
- a signal that arrives **before this side's own `room-open`** is held by the room
  key in it and replayed when it comes. The two ends are told about the room in two
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
  case where that signal is the one that went missing - but only while this
  side is still `connecting` on its direct attempt. A room that stands direct
  hears relayed bytes too: the tail of what the other end sent before its own
  sync took it off the relay, and after a retry that made it, reading those as
  a surrender would put the room straight back on the relay and close the
  connection it just proved. A direct connection that is *lost* while
  connected is the grace timer's and the `relay` signal's to notice, below;
- **a fallback that is not allowed is not waited for.** `guestAllowRelay` is
  answered to every client in `permissions` (it is off unless the configuration
  says otherwise, since it spends the server's own bandwidth), and where it is
  off a failed direct attempt ends the room rather than hanging on one - with
  `leave()`, not a local teardown, and on the other end's `relay` signal as
  much as on its own clock: the two ends' flags can differ (an account that
  has the relay, a guest that has not), and a room only one side left would
  keep the other on the relay "connected", a host sending its screen to
  nobody. It is
  the *guest's* flag: an account's is its own users row, told in the profile
  as `isRelayAllowed` and kept on the account record - taken from every
  profile the server answers or pushes, not the sign-in alone, so a record
  from before the flag existed and a row changed since both follow the newest
  answer - and `isRelayAllowed()`
  in `room.js` answers from whichever the client is - the one permission
  `permissions.allows()` in `ui.js` cannot answer, since a signed-in user is
  not simply allowed everything a guest is refused;
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
  every browser agrees on; the socket's is 64 KB with 64 in flight, since the
  relayed stream is carried by that product and the kilobyte it used to be
  capped a relayed room at a few Mbps. The room bar is the exception, and
deliberately: a relayed connection is slower and is worth saying so. The
switch (`#btn-room-relay`) is in the empty track the centring already leaves,
and it is always there: lit while the server is carrying the room, plain for a
direct room with the server behind it, and `[disabled]` for a direct room with
**no relay for this user** - so a peer on a line that keeps dropping can see
whether there is a fallback, and take it. A click is the same move the failures
make on their own: `useRelay()` is `startRelay`, and `useDirect()` is
`startDirect` - a fresh `RTCPeerConnection` negotiated while the relay goes on
carrying the room, taken over only on the new channel's sync (which is where
`mode` flips, on each end's own proof) and given up on the direct clock or an
ICE failure with the relay still standing, said in the snackbar since the
button then looks as it did. The other end follows a `direct` signal the way
it follows a `relay` one; `attempt` is what keeps a channel of the attempt
that was given up from reporting for the one that replaced it. `drawRelay`
asks `ctx["room"].isRelayAllowed()` every time, which answers for whoever the
client is right now (see below), rather than reading the guest flag once.

**"Connected" means the two ends have exchanged packets**, not that ICE says so
and not only that the channel opened: the channel opening says *this* end is
ready, and the `sideSync`/`timeSync` that follows says the two of them actually
reached each other, which is later and truer. A channel that opens but cannot be
synced is not a connection - it is left to the direct clock, which takes the
relay - so the sync failing must never report `connected`.

The communicator is built when the channel is wired rather than when it opens:
the other end opens at its own moment and can sync into this one first, and a
packet that arrives before there is anything to receive it is a negotiation that
hangs. It carries no picture - it is the handshake that proves the path, and
what the control protocol and the stream's settings go over (`send()`/`message`).

**The stream has a channel of its own beside it.** `video` is opened by the same
side in the same offer, `ordered: false, maxRetransmits: 0`, wrapped in nothing:
`sendFrame()` hands a chunk to it as it is and reports `false` rather than
queueing when `bufferedAmount` is past `VIDEO_BACKLOG`, and whatever arrives on
it is the `frame` event. On the relay the same chunk is the socket's binary frame
(`roomDataSend`), refused the same way once the socket's `bufferedAmount` is past
`RELAY_BACKLOG` - the server acknowledges as fast as it reads, so without that
line a relay slower than the encoder is a queue that only grows - and the
relayed bytes come back as `frame` too, so the stream
never asks which leg it is on - bytes are the stream and an object is a message,
on both. Why the picture is not on the control channel is the section below.

The two ways out are not the same. `leave()` is this side deciding: it tears the
connection down **and** tells the server, so the other end hears `room-close` and
stops. A `room-close` that arrives from the server is the other end having gone,
and only takes this side down. Either way the state ends at `closed` and the
event says why - and whose doing it was: `isRemote` marks a close the server
reported, because the reason is then the other end's. A `left` from the server
is the other end leaving (the host ending the connection from its share card),
which the room screen shows as the connection lost; only a `left` of this
side's own is the screen on its way out already. **A socket that drops is a
room that ended**: the server ends every room of a closing socket and tells
only the other side, since this one is not there to hear it, and the key it
held was that socket's - no later socket can present it. So `offline` takes the
room down here as `gone`, remote, exactly as a `room-close` would have. Left
standing, the other end's teardown closed the channel, the fallback took the
room onto a relay with a dead key, and it sat there "connected": the host
capturing into nothing and still drawn as sharing, the peer on a frozen
picture, and any key the peer held down left down on the host, since only the
stream stopping lets go of it. One room at a time on this client - a second `room-open` replaces
the first - which the server does not impose and a host with two peers will
eventually need.

## The room

The room is the **peer's** side of a connection - the one looking at somebody
else's screen - and the bar under the stream is that peer's half of it: what it
hears, what it drives, and how much of the line the host is allowed to spend on
it. The whole bar ends in one `settings` event on the screen and a
`getSettings()` beside it, and `emit()` hands the same object to `ctx["stream"]`,
which carries it to the host - see The stream below. The picture is a `<canvas>`
the screen hands the stream once at mount (`attach`), and the reading beside the
relay chip is the stream's `stats` event once a second - two short lines, the
frames over the bits, since one line of it was twice the chip's width and a
flex item keeps its content's width, which ran it into the toolbar in a
narrowing window; each line is cut with an ellipsis before that can happen
(the drop count, last on its line, goes first) and the tooltip carries the
whole reading.

**A tool the host has not got is greyed, not left to do nothing.** The
`share` message says whether there is sound (`isAudio`, the encoder's
`hasAudio()` - a desktop host on a platform with a loopback device is believed
until its capture fails, and the share is said again when it does) and a keyboard to take
(`isControl`, easy-control being there), and the bar greys the two buttons
(`room-tool-off`) until a share has said, with the reason in the tooltip; a
keyboard already taken from a host that then says it has none is let go.

**Fullscreen is the stage alone** - `#room-stage`, the canvas and nothing of
the bar - so the way out is the exit shortcut: the browser's own Escape, or
under the desktop shell the hold. The hold lets go of the innermost thing
first, the fullscreen and then the keyboard on a second hold, and while it runs
the stream's `hold` event (`onHold` in `stream-input.js`, the delay in it)
fills the ring over the picture, since five seconds on a key that shows nothing
reads as a key that does nothing.

**The screen entry is drawn from the host, never guessed.** `#btn-room-screen`
is hidden until the stream's `share` event brings a `screens` list of more than
one, and its rows are that list in the host's own order - the one thing both
ends can point at - with the primary display said to be. Choosing one only sends
`screenIndex` in the settings: the label does not move until the host restarts
its encoder on that display and says so in its next `share`, so what is marked
is what is on screen, and a display the host could not open is never claimed to
be. The choice is of *this* host, so `onRoomClosed` clears it and the next room
opens on its primary display like any first time.

**The frame rate is priced by nothing.** The third menu (`FRAMERATES`: 24, 30,
45, 60, 120) is not held under the bandwidth the way a resolution is: an encoder
keeps the bitrate it was given and spends it across however many frames there
are, so a higher rate costs sharpness inside the same budget rather than bytes
the line has not got - which is the peer's trade to make, and the picture is
what says how it went. It travels in the same `settings` message as the rest.

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
`/room/<joinId>` is a room on a remembered device and the room waits when the
route carries one. A pairing the host did not remember has no id anywhere to
put in a URL, so the dialog that accepted it navigates with `isConnecting`
instead (`navigate(path, params)`; the params are gone after a reload, which is
right - so is the pairing). **The room is not an address**: `isRoomRoute` in
`src/router.js` answers a room path only while a flow is entering it or a room
stands on exactly that id (`getRoomKey()`/`getJoinId()`), and anything else -
`/room` typed in, a stale bookmark, a reload of a room that died with it, the
right screen with the wrong id - is normalized to the default screen the way a
route the server does not offer is. The way back to a remembered device is the
devices screen, which asks the host; a URL never does.

`setConnecting(false)` is what ends the wait, and the room's `connected` event
is what calls it (`onRoomConnected`, which also draws the relay indicator) - the
other end is there, and the picture is what is missing now, not the path to it.

**An accepted request now moves both sides, and they move to different places.**
The peer goes into the room it was asking for (`room/joining`, which handles the
pairing, the remembered join and the unsupervised one that the server answers in
the first call). The host goes to its own list: `management/shares` opens, with
that connection's settings on it where there is a connection to settle, because
naming it is the one thing worth doing to a connection the moment it is made.

**The host is moved by the room rather than by the flow that made it**, and that
is the whole reason the listener is on `management/shares` and not in the dialogs
the flows end in. There are three ways a connection is made on a host: a pairing
accepted in `room/request`, a remembered device let back in through
`join-request`, and the unsupervised join, which the server answers itself, so
nothing on that host is ever asked. What all three have is `room-open`, told to
both sides alike (`handlers/rooms.js`), and it carries **`isNew`** - set by
`pair-accept` alone - because only the server knows which flow a room came out
of. **Only a new connection moves the host**: a pairing is a connection worth
naming the moment it is made, so the host is brought to the shares screen with
its settings open; a remembered device coming back, asked or unattended, was
named when it was made, and the host that answered it from wherever it was is
left there. `room/create` therefore only stores its half of the join and closes
itself - it navigates nowhere, and it closes *before* it stores, since opening a
screen closes the dialogs over it.

Two things that listener has to be careful about. A pairing the host did not ask
to remember carries **no join id**: the host is moved and the settings are opened
all the same, on the *room* rather than on a record (`{"joinId": "", "isLive":
true}`) - what was just accepted is what the host is looking at either way. And
the record
may be a moment *behind* the room - the accept answer that carries the new join
and this push cross on the same socket - so a room whose record is not there yet
waits for the `change` that stores it rather than deciding it is a room about
nothing. A join that never arrives at all is the one case with nothing to open:
there is no card for it on the screen either, so it is logged rather than left as
a navigation that did half of what it was for.

**A share is not only a record.** `ctx["joins"]` is what a device *keeps*, and a
pairing nobody remembered is kept by nothing: the room is the whole of it. Drawn
from the records alone, the one flow that shares nothing but the moment showed
the host an empty screen and an unlit bar at the exact moment it began sharing
its machine - so `room.isSharing()` (this client is the host of a room that
stands) is the second half of the screen and the whole of the badge. The shares
screen draws a card from it, first in the grid; the shares badge of the rail and
of the small layout's menu is lit by `isSharing()` and by nothing else, so both
bars listen to the room's own edges (`connecting`, `closed`) and not to the
records' `change`. Where the live room
*is* on a remembered join, `getJoinId()` matches it to the card that is already
there and marks that one instead - one connection is one card, and the `Sharing`
chip is what says it is up right now.

**Every card carries the same menu, and the live one answers it from the room.**
A card whose menu was missing would be the one card on the screen that could not
be acted on, so both entries are there for the live share too and both mean what
they mean everywhere else, as far as a connection kept nowhere can: *settings*
opens `management/connection` with `isLive`, where the name is the room's
(`setName`/`getName`, and the card follows the room's `name` event) and stands
only while the connection does - the hint under the field says so - and *delete*
is `room.leave()`, because deleting a share that **is** only a connection is
ending it. One dialog for both, since a host that has just let somebody in should
not have to learn a second screen for the connection it did not tick a box for.

**A live card also carries *disconnect*.** Where the live room stands on a
remembered join, the card is that join's and its *delete* forgets the device -
which the server answers by ending the room on it too (`removed`) - so ending
the connection *without* forgetting the device needs an entry of its own.
`setLive()` shows it on whichever card is live, the connection-only card
included, and it is `room.leave()` behind `confirm.endRoom`, for the room the
click was about and no other: one that replaced it while the question stood is
left alone. It is the host's one way to put a connected device off its keyboard
and keep it; an unsupervised device may walk straight back in, and forgetting it
is what keeps it out.

**Neither delete is taken without asking.** `ctx["ui"].confirm()` is the one
question the shell puts before something is undone for good -
`ui/management/confirm/`, opened *nested* so whatever asked it is still behind
it, dispatching `done` the way `room/exit` does. It is handed **localization
keys** rather than lines: a language switched while a dialog stands re-translates
the document from `data-localization`, so a line written in as text would go back
to whatever the markup was built with - which is the same reason
`management/connection` writes the key of its hint onto the element before
reading it. The two questions are not one question: forgetting a join is gone from
both devices for good, a connection standing on it with it (`confirm.deleteJoin`),
ending a live share only ends what is up (`confirm.endRoom`, and the button says
*End* rather than *Delete*).

**A rebuild the room asked for is not dropped.** The grid answers two sources and
they need opposite guards: `joins` fires `change` *because* the build asked it
(`list()` writes who is online), so answering that one would build for ever - it
is skipped while `isBuilding`. A room does not move because this screen asked
something, so `connecting`/`closed`/`name` arriving mid-build set `isPending` and
the build runs again, rather than leaving a card standing for a connection that is
already gone. `buildCards` also empties the grid only once the records have
arrived, so a rebuild does not blink and a call that fails does not leave the
screen empty.

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

## The stream

`ctx["stream"]` (`src/room/stream.js`) is what crosses the room: the host's screen as
raw encoded frames one way, the peer's mouse and keyboard the other. It follows
`ctx["room"]` on its own - a room that connects starts the share on the host
side and the watch on the peer side, and a room that closes stops it - so no
screen owns it either; the room screen hands it a canvas and the bar's settings,
and the shares screen reads `isSharing()`. `dev/plans/room-media.md` is the plan
it was built from.

**Never a WebRTC media track.** The `RTCPeerConnection` carries data channels and
nothing else, on every host and every peer. A media track puts an encoder pacer,
an RTP layer and a jitter buffer between the capture and the pixel, each a queue
tuned for a video call and none of them one this code can empty; a remote
desktop is measured on the one thing those spend. So every host sends bytes
its own encoder made, the peer decodes and draws them itself, and the latency is
capture + encode + line + decode + one vsync.

**The wire format is `src/room/frame.js`**, and it is pure: a 12 byte header (`seq`,
chunk index and count, `KEY`/`AUDIO`/`CONFIG` flags, a 24 bit timestamp) on
every chunk, `packFrame` cutting a frame at the leg's limit (16000 bytes on the
channel, one chunk on the relay since the socket splits it itself) and a
reassembler with three rules that are the whole of what an unreliable channel
needs: a frame that completes after a later one was delivered is dropped, a
frame still in pieces when `HOLD` newer ones have started is dropped, and a
drop is reported so the peer waits for a keyframe and asks for one - a delta
frame over a hole decodes to garbage. `tests/frame.test.js` runs it under Node.
A `CONFIG` frame is the decoder configuration as JSON, sent ahead of every
keyframe so a peer that missed one has it the next time it could use it; audio
frames carry `AUDIO` and their own timestamp clock, since the host stamps sound
and picture from two sources.

**Two hosts, one output.** Under the desktop shell it is ffmpeg
(`src/room/stream-ffmpeg.js` builds the lines, `encoder-ffmpeg.js` in the Electron
libs cuts the pipe): raw Annex B H.264 with an access unit delimiter in front of
every frame, which is what the splitter cuts on, so there is no container to
parse and the SPS/PPS ride in-band the way a WebCodecs decoder with no
`description` expects. The lines are tried in order - `h264_nvenc`, `h264_amf`,
then `libx264` on Windows with the D3D11 capture staying on the GPU into the
hardware encoders; `h264_videotoolbox` then `libx264` on macOS - and the first
to produce a frame within `ENCODER_START_TIMEOUT` is the share; a keyframe every
second, no B frames, a constant bitrate of `VIDEO_SHARE` of what the bar allows,
at the frame rate the bar asked for.
ffmpeg's video lines carry no sound: the desktop host's is `createSystemAudio`,
the first of two sources that gives any. First a `getDisplayMedia` that
`main.js` answers through `setDisplayMediaRequestHandler` with the first screen
and the `loopback` audio device - Windows' own, and behind Chromium features
`main.js` switches on, ScreenCaptureKit's on macOS 13+
(`MacLoopbackAudioForScreenShare`, `MacSckSystemAudioLoopbackOverride`) and the
PulseAudio monitor on Linux (`PulseaudioLoopbackForScreenShare`). Its picture
is asked for at 4x4 and 1 fps and never read: a display capture cannot be had
without one, and an empty one is a picture Electron on macOS cannot wrap, whose
capture then hands back silence (electron/electron#49607). Its sound is asked
for as `CAPTURE_AUDIO` - stereo, echo cancellation, noise suppression and gain
control off - on both hosts, since Chromium otherwise treats a display
capture's sound as a call's microphone and hands back one processed channel;
measured on Windows, a 0.2 tone came back at 0.16 through it and at 0.1965
without. The track is only adopted once its first frame is out
(`createAudioReader`'s `start()` answers that), since Electron on macOS has
handed back a track that was ended from the start (electron/electron#52738) and
it would otherwise stand in front of the ffmpeg lines saying nothing; a
loopback delivers frames of silence while nothing plays, so on Windows the first
is there within a few milliseconds. Under a Wayland session `main.js` refuses the
capture outright - its screens are listed through the desktop portal, which
would ask the host on every unmute - and a refusal is a rejected
`getDisplayMedia`, not a hang. Then ffmpeg on its own, from a
device that carries what the system plays: `stream-ffmpeg.js` lists the
platform's audio inputs (`listAudioParams`/`parseAudioDevices`, dshow and
avfoundation) and `buildAudioLines` keeps only the loopback kind by name -
"Stereo Mix" and its translations, virtual cables and virtual-audio-capturer
on Windows, BlackHole and its kind on macOS, never a microphone - and on Linux
it is the default sink's PulseAudio monitor (`@DEFAULT_MONITOR@`, which
PipeWire's pulse server answers too), which needs no listing. Those lines write
raw 48 kHz stereo float PCM rather than Opus: `createPcmReader` cuts it into
`AudioData` at whole samples and the one `createAudioSink` encodes every source,
so there is no Ogg to parse and the peer is handed one kind of sound. The
Windows device name is quoted into the line by hand, since `FFmpegProcess`
spawns with `windowsVerbatimArguments`. A source that ends on its own is let
go, and the next unmute looks again; only when every source fails is the share
said again without sound. It runs beside ffmpeg rather than in it, so a restart of the line
leaves it alone, and only while the peer's sound button is on: the `isAudio`
setting starts and stops the capture itself rather than only the sending, and
the settings preview never starts it. The sound's configuration rides with
every keyframe like the picture's, since it is sent once when the encoder
starts and the peer's room may not have been up for it.
A settings change is a restart behind `RESTART_DEBOUNCE`, since ffmpeg is told
nothing over a pipe - which is also why the desktop host cannot answer a
keyframe request, and the one second GOP is the whole answer to a gap. The
display shared is a setting like the others (`screenIndex`, an index into
`Control.Screen.list()`, the primary one when absent or out of range): every
start of the encoder reports the display it opened and the whole list beside it
in the `share` message, and re-binds the control to that display, since the
peer's mouse is mapped into the picture being shared. In a
browser it is `getDisplayMedia` through a `MediaStreamTrackProcessor` into a
WebCodecs `VideoEncoder` (`latencyMode: "realtime"`, `avc: {format: "annexb"}`
so the bytes are the desktop host's bytes), a keyframe every `KEY_INTERVAL`
seconds and on request, `configure()` again on a settings change - and
`applyConstraints` on the captured track when the frame rate is what changed,
since the capture is what paces the encoder; the display's audio track
goes through an `AudioEncoder` as Opus on the same channel. A browser without
`VideoEncoder` cannot share and the settings preview says so. A share that
cannot start - the picker cancelled, no encoder - leaves the room, since a peer
sitting on a black picture is worse than a request the host can answer again.
Both encoders start across an `await` that nothing above them can cancel - the
picker on the web, the old line ending before the debounced restart on the
desktop - so each carries a `generation` that `stop()` bumps, and a start that
comes back to a newer one lets go of what it got (the tracks picked, the line
that started) instead of running a share the room has already left, which
nothing could stop afterwards.

**The peer decodes in a worker** (`src/room/stream-worker.js`) that holds the
`VideoDecoder` and the canvas. The hardware decoder is preferred and never
required, and the two calls that decide it do not fail the same way:
`configure()` takes any configuration and reports the one it cannot do later,
through the error callback, so a `try` around it catches nothing - the
question is put to `isConfigSupported()` first and `prefer-hardware` is dropped
to `no-preference` on its answer; a `NotSupportedError` that still reaches
`onError` drops it the same way once, and without the preference there is no
decoder to make, so the worker reports it and stops rather than building the
same failing decoder for ever. `createDrawer` is the same shape: a canvas
opened as one kind of context cannot be opened as another, so a WebGPU or
WebGL path that opened and then threw leaves nothing for the 2D one, and it
throws rather than handing back nothing for every frame to call. Beyond that
the worker holds the decoder and the canvas: the room screen's `<canvas>` hands its surface
over once (`transferControlToOffscreen`, which is why the element lives for the
screen's life and `attach` is once), whole frames are posted to it transferred
rather than copied, and a decoded frame is drawn the moment it comes out - the
compositor shows what is there at the next vsync, and a queue between the two
would be latency. Drawing is `src/room/stream-draw.js`: WebGPU (`importExternalTexture`,
the path the upscaling work will read from), WebGL (`texImage2D` of the frame)
or the 2D context, the first that opens, all of them the frame staying on the
GPU. Two drop rules: a delta with no keyframe under it is dropped and one asked
for (once per gap, `KEY_REQUEST_GAP` apart), and a decoder more than `QUEUE_MAX`
frames behind drops deltas until the next keyframe - a hardware decoder is
faster than the line, so a shallower queue is a hiccup that empties on its own.
Sound is decoded on the main thread, since a worker has no speaker: an
`AudioDecoder` into an `AudioContext`, each frame scheduled behind the one
before it and `AUDIO_JITTER` ahead of the clock when the chain restarts.

**Control is the control channel's.** The peer's events (`src/room/stream-input.js`)
are read off the canvas and mapped into the *picture* - the canvas letterboxes,
so its rectangle is not the picture's - batched per animation frame with only
the newest move kept, and sent as `{"kind": "input"}` on `room.send()`; the host
applies them with easy-control on the screen it is sharing, and lifts every
button and key it was handed when the peer lets go or leaves. The way out of a
taken keyboard is a shortcut *held* for its delay (Escape for a second in a
browser, five under the desktop shell, and whatever `settings.control` added),
because every key the peer presses goes to the host, so a key alone cannot mean
stop. The screen hears that as the stream's `control` event and lets the button
go with it. Two bookkeeping rules keep the host from being left holding
something: the keys down are kept by `KeyboardEvent.code`, the physical key,
because the name moves with Shift (`a` down and `A` up would be two keys, and
a map that never empties is a hold that never starts) while the name beside it
is what a shortcut is written in; and a button pressed on the canvas captures
the pointer, so its release is the canvas's wherever it happens - over the
bar, outside the window - and a blur or a cancelled pointer lifts every button
the way it lifts every key.

**The pointer is the peer's to draw.** The desktop host tells its capture *not*
to draw the cursor into the picture (`isCursor` in `stream-ffmpeg.js` -
`capture_cursor`, `-capture_cursor`, `-draw_mouse`, off wherever the host can
hand one over instead) and reads its own pointer with easy-control:
`src/room/cursor.js` fingerprints the shape and packs it as a PNG data URL,
and the watch in `stream.js` looks at the pointer `CURSOR_POLL` - thirty times
a second, the rate the picture beside it moves at - sending `{"kind":
"cursor"}` only when that fingerprint is one the peer has not been given and
`{"kind": "cursor-move"}` only when the position has actually moved (0..1 in
the shared display, `null` when the pointer has walked onto another one). **The
deciding is local**: a pointer sitting still is looked at thirty times a second
and mentioned none. The looking is the cost - reading the shape is ~1.5 ms
inside the addon against ~1 us for the position, about a twentieth of a core at
this rate - which is what the fingerprint in front of the packing is worth, and
why the two halves share one tick with the cheap one first. That tick schedules
itself against the clock the run started on rather than against the tick before
it, so the read inside it is not added to the gap after it - an interval of the
same length drifts to 25 a second on a read of a millisecond and a half. The
window it runs in must not be throttled either: Chromium slows a hidden page's
timers to one a second, and a sharing host is a window somebody switched away
from, which is why `main.js` opens it with `backgroundThrottling: false`. A cursor inside the video is a cursor at the video's
rate and a frame behind it - it lags the hand moving it and stutters at
whatever the line is doing - and the pointer is the one thing a person watches
continuously while they drag something. The PNG is written by hand over
`CompressionStream` rather than through a canvas, which is what keeps the
module pure enough to run under Node (`tests/cursor.test.js`); a cursor is a
few kilobytes of mostly nothing, so it packs to a fraction of its pixels and
the shape only crosses the line when it changes at all.

**Sizes are fractions, never pixels.** The shape is measured against the
display being shared and its hotspot against the shape, because the peer knows
that display only as the rectangle it drew it in - so a pointer covering a
button on the host covers the same button on the peer, at any window size.
Windows is the one platform whose scaling has to be divided out (`cursorScale`):
it hands the cursor over at the size it is drawn on screen while
`Screen.list()` reports that display in logical pixels, where a macOS `NSImage`
is in points already and the X11 figure is read off the monitor's millimetres
rather than off any scaling the desktop applies.

**Two layouts, because the client is not what builds the addon.**
`Mouse.getIcon()` hands over `width * height * 4` bytes of RGBA where
`dev/control/src/mouse.cpp` stands today, and `width * height` packed
`0xAARRGGBB` pixels from the build vendored under `src/client/native/`, which
predates that source. `iconStride` is what tells them apart and `readIcon`
reads either. The vendored one fills no alpha at all, so what it reports is a
silhouette - the Windows arrow arrives as one white shape where it is really
white inside a black edge - and a white pointer on a white document is a
pointer nobody can see: `outlineSilhouette` gives the empty pixels touching the
shape its contrast, black around a light pointer and white around a dark one.
Nothing is invented about the shape, only about the edge it lost, and a picture
that came with an alpha channel never goes through there. Rebuilding the addon
from `dev/control/` is what replaces the guess with the real thing.

**A shape is encoded once.** The fingerprint - FNV-1a over the pixels with the
size and the hotspot in front of it - is what says the peer already has this
one, and `CURSOR_SHAPES` of them are kept packed, since a session crosses the
same handful over and over. The memo is dropped when the share moves to another
display, because the fractions in it are of that display.

**The browser draws it while the peer is driving.** The pointer over the
picture *is* the host's pointer then, so the shape is handed to the canvas as
its own `cursor: url(<the shape>) <hotspot>, auto` and the browser draws it -
no image of ours to place, no position to wait for, and nothing between the
hand and what it sees. The host stops sending positions the moment the peer
takes the keyboard and the mouse (`setControlled`), since what it would say is
a round trip behind that hand, and sends again the moment it is let go. The
hotspot is in the shape's own pixels, which is why those go over beside the
fractions. Chromium ignores a cursor image over 128 pixels, so the `auto`
behind it is what a pointer that large falls through to; and the `cursor: none`
still in the stylesheet is what is left for a host that sends no shape at all -
a browser sharing through `getDisplayMedia` draws its own into the picture, and
a second one over it would be two pointers. Because the shape lands in a CSS
`url()` and an `img src`, the peer takes one only as the PNG data URL
`cursor.js` packs (`CURSOR_IMAGE` in `stream.js`); a string that is anything
else - a quote closing the `url()`, an address to fetch - is read as no pointer.

**Where it is drawn is where a click lands.** `#room-cursor` sits over
`#room-stage` and is placed by `pictureBox()` in `stream-input.js` - the same
letterbox mapping the peer's own clicks travel through, so a pointer drawn in
the wrong place and a click landing in the wrong place are one defect rather
than two. That mapping is against the *picture's* size, which the element
cannot be asked for: its surface belongs to the worker from the moment it is
transferred and the width it still reports is the one it was born with, so the
size comes from the stream's `size` event and the stage is measured again
(a `ResizeObserver`) whenever the window or the fullscreen changes its shape.
A host that cannot hand its cursor over - a browser sharing through
`getDisplayMedia` - sends none of these messages, keeps the cursor in the
capture, and the peer draws nothing over the picture.

**The settings preview is the same pipeline with no line in it**: `preview()`
runs the host's encoder into a viewer on the settings window's own canvas, so
the one ffmpeg line in the tree is the one a room runs, and it refuses while a
share stands - one encoder per client.

## The clipboard

The bar's *clipboard* button is one switch over one idea: while it is on, the
two machines have the same clipboard, and while it is off neither of them reads
or writes the other's. `src/room/clipboard.js` is this machine's clipboard
behind one interface - the Electron one under the desktop shell, and
`navigator.clipboard` in a browser - and `stream.js` is what carries it, as two
messages on the control channel beside the input: `{"kind": "clipboard",
"isClipboard"}` for the switch and `{"kind": "clipboard-text", "text"}` for
what was copied, which travels in both directions.

**The switch is the peer's.** A host is a machine somebody else is driving, so
the side that asked for the connection is the side that decides whether its
clipboard goes over; the host has no button for it and is simply told. It
outlives a room the way the peer's other settings do - a new host is told it in
`startPeer` - and a host that says it has no clipboard in its `share` message,
or a browser that hands the page none, greys the button rather than flipping
the switch: it is a setting, not something taken, and the sound beside it
behaves the same way.

**One side watches, the other waits for a gesture.** Neither shell reports a
copy, so a clipboard is only ever read by looking at it. The host looks every
`CLIPBOARD_POLL`, which is what makes a copy on the shared machine land on the
peer's clipboard a moment later. The peer does not poll at all, because
something better says when to look: *it came back to the picture*. A
`pointerdown` or a `focus` on the canvas, and a `focus` on the window for the
peer that never left the canvas at all, is both the moment its clipboard could
have changed and - in a browser - the user gesture that a first
`readText()` has to be asked inside. So the flow the button promises is the one
that happens: copy on this machine, click back onto the remote picture, paste
there.

**Nothing echoes.** Two watches over one text would send it back and forth for
ever, so `clipboard.js` keeps what both ends are known to hold: a text read
that is what was last read or last written is not news, and `put()` records the
text *before* writing it. That one rule is also why `onCanvasActive` flushes
before it reads - a write still in flight would otherwise be read back as
something this machine had just copied.

**Turning it on has a direction.** The host primes - it reads its clipboard and
remembers it without sending it - and the peer sends its own straight over, so
switching on means "this machine's clipboard, onto that one" rather than a race
between two machines to overwrite each other with something copied hours ago.

**What it will not do is said.** A text longer than `MAX_LENGTH` is not sent:
the relay answers a `room-data` call of at most 64 KB and JSON escaping grows a
string on the way, so the cap is on the text with room to spare, and the bar
says so in the snackbar rather than truncating what somebody copied. A browser
that refuses to be read is said once per switch, not once per click. A write
the browser refuses for want of focus is not lost either - it is kept and
written at the next gesture.

## The enhancer

`src/room/stream-enhance.js` is the stage between the decoder and the drawer
in the stream worker, and the bar's *enhance* entry is its whole UI: three
switches - upscale, frame interpolation, frame extrapolation - that may be on
in any combination, since a switch that excluded the others would be a choice
between three things a person wants all of. What is on is this client's and
not the host's: it never travels in `settings`, it outlives a room, and the
room screen keeps it beside `settings` rather than in it.

**The models are mocks, and the pipeline is real.** Each enhancement is one
ONNX graph under `media/models/`, written by `model/mock/make_mock_models.py`:
a depthwise identity 3×3 convolution followed by a bilinear ×2 (the
convolution before the resize, at the input resolution, the way a real
upscaler computes low and upsamples last), and the two blends as the
elementwise arithmetic they are. **A two-frame model takes two inputs**,
`previous` and `current`, never one stacked six channel tensor: stacked, the
enhancer paid a copy to stack them and the graph a `Slice` to take them apart
again - 11 of the 17 ms an interpolated 1080p frame cost - where two inputs
are two buffers handed over as the tensors they already are. The shapes were chosen by what the runtime's
WebGPU provider runs well, and the measurements are in the generator's
docstring: its generic `Conv` has no vectorised path for a channel count that
is not a multiple of four and took 25 ms on a 1080p frame where the depthwise
kernel takes 1.4 ms; a 1×1 convolution cost 17 ms where `Add`/`Mul` cost
1-2; `Resize` at 11 ms is the floor and what a real upscaler pays, and the
NCHW↔NHWC `Transpose` pair the provider puts around a graph's convolutions is
4.3 ms once per graph; float16 and graph capture changed nothing - the kernels
are index-bound, not bandwidth- or arithmetic-bound. A trained model will pay
those prices for whatever it is built from. Where a 1080p frame's ~26 ms go
with the upscaler on: `Resize` 11, the transposes 4, the draw onto the canvas
~4, the frame into planes ~2.5, the convolution 1.4. They are the
*shape* of the real thing - the same input and output, real GPU work in
between, a picture that stays right - so the whole path from decoded frame to
drawn picture can be built and timed before a trained model exists, and a
trained one replaces a mock by being exported under the same name. `model/`
is where those are trained; nothing there runs in the client.

**The runtime is fetched when the first switch is turned on, not at boot.**
ONNX Runtime Web is 800 KB of script and 26 MB of WebAssembly, and a room that
draws the picture as it comes never needs it. What the worker does at boot is
the *probe*: which backend this browser could run one on. `probeBackend()`
asks for a WebGPU adapter, then for a WebGL context, and the answer is posted
to the bar before anything is asked for, so the entry is greyed with the reason
in its menu rather than left to fail on the click. There is no third backend
on purpose: the runtime has a CPU one, and a CPU cannot keep up with a stream,
so a browser with neither GPU path is told it needs one instead of being given
a picture that arrives a second late.

**A model never sees a whole frame, and every tile of a frame is one run.**
Every picture is cut into tiles of one size, the tiles go through the model as
one batch (`[N, C, h, w]`, the graphs carry a symbolic `N`), and the kept
centres are merged back. Three reasons, and the first was a bug: the runtime's
convolution is only right up to a size *per image* - a whole 1080p frame
through the upscaler came back as the same 640 pixels repeated across the
picture, silently, and 1440p is where the kernel breaks - while a batch is a
dimension of its own and thirty-six tiles of 328×188 come back right; one run
of every tile costs a frame far less than thirty-six runs of one (56 → 41 ms
measured, the rest being the runtime's per-run overhead); and a session is
then one shape whatever the stream's resolution, which is what the WebGL
provider wants anyway. `planTiles()` is pure and tested: a 320×180 step, which
divides every 16:9 resolution exactly (720p is 4×4 of it, 1080p 6×6, 4K
12×12), and a halo of 4 pixels every model is given beyond it - the geometry
`model/upscale/webexport.py` measured as the cheapest, and one halo for the
whole chain, so a tile out of one model is a tile into the next. A tile near
an edge is not cut short: its input window is slid back into the frame, so
every tile of a frame has the same input size and the kept region moves
inside the window instead; a frame smaller than a tile is one tile of its own
size. A model exported for the client has to be right on a 328×188 tile and
read no further than the halo.

**The picture stays on the GPU on WebGPU, and goes through a pixel array on
WebGL.** On WebGPU a decoded frame is imported as an external texture and one
compute dispatch - a workgroup per 8×8 of a tile, the tile index on the third
axis, each tile's window origin in a small table - writes the whole batch as
float32 NCHW into one storage buffer the runtime takes as a tensor
(`Tensor.fromGpuBuffer`, one tensor per graph input - a two-frame model is
handed the previous picture's buffer and this one's, nothing stacked); the
runtime answers in another (`preferredOutputLocation: "gpu-buffer"`); and
one draw of a full-screen
triangle finds, for every canvas pixel, the tile it is kept from by dividing
by the step (the tiles are batched in row-major order for exactly that) and
reads it there, onto a canvas of the enhancer's own, which is wrapped as a
`VideoFrame` - so the drawer draws it exactly the way it draws a decoded
frame, whichever of its three contexts it holds, and does not know the
difference. A frame is one dispatch, one run per model, one draw. On WebGL
the provider takes and returns CPU tensors and nothing else, so a frame is
read off a 2D canvas and cut into one `Float32Array` batch, and the answer
put back through an `ImageData`; it is a fallback, it costs seconds a frame,
and the reading in the menu says so. Two things about the
WebGPU path were found rather than designed. The runtime's
buffers are only tensors on the device that made them, and this build of the
runtime makes its own device from the adapter and takes none it is handed -
`env.webgpu.device` is written by it, never read - so the enhancer's passes are
built on the *runtime's* device once the first session exists, and the
drawer keeps its own; the `VideoFrame` between them is what crosses. And the
WebGL provider runs static shapes only: a dimension the graph leaves symbolic
(`H`, `W`, so one file serves every resolution) is read as nothing and refused,
so for WebGL the graph's bytes are patched - the symbolic input dimensions
written as the frame's, a small protobuf rewrite of the fields on that path
alone - and a session made per resolution. `tests/enhance.test.js` proves the
patch against the mock files.

**A generated frame has a place in the interval, and the real one moves to
make room.** `schedule()` is pure: for one arriving frame it says which
pictures are drawn and where each sits in the frame interval, as fractions.
The interpolated frame stands in *before* the real one (it is the picture
between this frame and the last) and the extrapolated one *after* it, so with
interpolation on the real frame is drawn at half the interval, with
extrapolation on the predicted frame is, and with both on the three are spaced
by thirds. Upscaling is not a step - it runs over every picture the steps
produce. The interval is measured from the stream's own timestamps rather than
assumed. Whatever is still held when the next real frame arrives is drawn
ahead of it, in order, rather than dropped: a generated frame never covers a
real one, and none is lost.

**One frame at a time, and the newest waits - and a frame is not done until
the GPU is.** A frame that arrives while one is being enhanced waits, and a
second one replaces it and is counted dropped: an enhancer that is behind
should not fall further behind by working through what it missed. That only
holds because a frame ends with `queue.onSubmittedWorkDone()`: a run resolves
at *submit*, so without the wait a frame whose GPU work costs more than the
interval queued behind the last one for ever - the CPU clock said a few
milliseconds while the picture fell seconds behind and nothing was ever
dropped, which is the freeze the tiling was first blamed for. With it the
reading is the GPU's own time per frame (~26 ms for a 1080p→4K mock upscale
on an 8-core Apple GPU, which keeps 30 fps; ~10 ms for interpolation; ~75 ms
with all three on), the
queue is bounded, and the drop count says what the GPU could not keep up
with. A `reset` (the stream over, or restarted) bumps a generation,
and a frame still in flight across it is let go rather than becoming the first
frame of the next stream's pair. A change of size is not a reset - the host
restarts its encoder at a new resolution inside the same stream, which the
peer's `auto` resolution does on every bandwidth step - so the previous picture
is dropped when the new one is not the same frame size (`isSameShape`, tested):
a two-frame graph handed two sizes throws, and the enhancer would switch itself
off for a bandwidth click. The picture a frame is made into is given back on
every way out of `process` but the one that keeps it as the next previous.

**What the bar shows is what the worker said, not what was clicked.** A click
draws the wish at once and greys the rows until the worker answers; the
`enhance` event carries the options actually in force, and an option the
runtime refused - a graph that will not load, a run that threw - comes back
off, with the reason in the snackbar. The label is the short names of what is
on, joined; the last row of the menu is a status rather than a choice - the
probe, its refusal, a load in progress, and otherwise the reading: the backend
and what a frame costs from arriving to its last drawn picture, fed from the
stream's `stats` while a picture is being received, or the backend alone until
there has been one. It is **one row that is always there** and only ever
changes its text: a row that appears or goes moves the rows under the pointer
of an open menu, which is what it did first.

## The registry

Every `import()` specifier in the route table is a **literal**, on purpose: a
built specifier works at runtime but hides every path from
`tests/assets.test.js`, and a mistyped path is the one class of error the browser
reports badly. A module is its code, its markup, its styles and its strings in
one round trip; `html`, `css` and `localization` are omitted when a module has
none. **A registry id is not its path** — `room-create` lives at
`ui/room/create/` and the id is what the shell, the markup and the router know it
by.

The localization dictionary grows with the UI, and none of it is code:
`src/localization.js` is the lookup alone, starts empty and knows no file. A
`localization.json` sits at the level that uses it. The shell's own levels
carry one each that no module brings, and boot `load()`s the three
(`LEVEL_DICTIONARIES` in `ui/ui.js`) before anything asks for a line — a
slice that fails is logged and skipped like a module, and the markup keeps its
own English text where its lines would have gone:
`ui/localization.json` is what every level shares — `main.name`, the
application's own name where the configuration gives it none, which the desktop
shell names its auto-launch entry from in `initDesktop` — while
`ui/loading/localization.json` is the loading layer of `index.html` and
`ui/management/localization.json` the `main.*` chrome the two bars, the menu and
the management screens share. The registry then hands each module's
`localization.json` to `add()` while the module loads; the room segment's
shared lines (`room.share.failed`, which `src/room/stream.js` shows) are in the
room module's own, since that module is the level. `tests/localization.test.js`
holds a module to the slices of its own folder and the folders above it, and
checks every literal key a script hands to `get()` as well as the markup's. `supportedLanguages` is a getter for the same
reason: the languages arrive with the slices, so they are read off the
dictionary when asked rather than when the module is imported.

## Odds and ends worth keeping

- **beercss nav badges** are read as `nav.left > a > .badge`, so the narrow rail
  wants the badge as a direct child of the entry and the wide one wants it inside
  the wrapper beside the icon. `nav-left` re-parents it when the width changes.
- **The theme is painted before any module runs.** A person should meet the
  colour and the mode on the loading layer rather than watch them switch once
  the modules arrive, so the first thing in the body of `index.html` is a plain
  script — a module would run after the first paint — that puts the palette on
  the body as beercss would: the class of the mode and the palette as the
  body's `style`. It paints the palette this client last drew with (`appearance`
  in `localStorage`, `{color, mode, light, dark}` — a cache for the paint, the
  setting itself stays in IndexedDB, which cannot be read synchronously) and,
  on a first visit, the server's default, which the build computes for
  `http.appearance` with the same `material-dynamic-colors` the client uses
  (`buildPaint` in `building.js`) and writes into `<meta name="appearance">` —
  an attribute, because the minifier routes inline script through UglifyJS and
  leaves attributes alone. `applyTheme` in `ui/ui.js` then hands beercss a
  palette it already has as `{light, dark}`, which is synchronous and draws
  nothing new, builds one only for a colour never drawn, and caches whatever
  it drew; the appearance window goes through it as `ctx["ui"].applyTheme()`
  so a change is painted at the next load too. **The palette is built beside
  beercss, never by it**: `ui("theme", color)` applies its result whenever it
  resolves, so a slow colour would land over one picked after it and nothing
  could call it off. `buildPalette` in `src/appearance.js` calls
  `materialDynamicColors` itself and writes the style strings the way beercss
  does — the build's `buildPaint` imports the same module, so the palette
  painted first and the one drawn after cannot drift apart — and only the
  latest call draws what it built; an earlier one that resolves late is
  dropped. One build per colour is in flight at a time, however many calls wait
  on it. Nothing waits in line behind a build, so a cached colour or a mode
  switch is drawn at once; while a new colour builds — and if the build fails
  — the mode is switched on the palette already on screen. Before the first
  draw beercss holds no palette and setting a mode alone would wipe the one
  `index.html` painted, so that palette (the cache's, else the meta's) is
  handed to beercss with the mode instead. The meta is read
  once — the build's never changes — but the cache is read on every write,
  since another tab or window writes it too and a copy in memory would put its
  stale colour or language back. `ui.js`
  imports the two beercss modules itself so `ui()` is there when it is called.
  Under the desktop shell the window starts hidden and is shown on
  `ready-to-show`, so it never appears as a blank frame before that paint — or
  on a `did-fail-load` of the main frame (not an aborted navigation, `-3`, and
  not a frame inside the page such as the Google button) or after
  `SHOW_TIMEOUT`, so a page that never paints does not leave the application
  running with no window. Any show counts, the tray's or a second launch's
  too (the window's own `show` event), so a window hidden to the tray before
  its first paint is not brought back by it.
  The same script sets the **title** from the configured `name` in the meta —
  in the language this client last showed (`lang` in the same cache, written by
  `applyLanguage`), else the browser's — and `applyLanguage` sets it again on
  every language change; the name itself is never cached, so a renamed server
  is renamed at the next load. Electron's window takes the page title on its
  own, and `main.js` hands it to the tray's tooltip on `page-title-updated`.
  The build also writes the English name (`pickName(names, "en")`, the same
  rule) as the static `<title>` for anything that reads the page without running it. Where no name
  is configured, the title is the dictionary's `main.name` in the client's
  language. The rules are `pickName`/`pickSystemName` in `src/appname.js`
  (pure, `tests/appname.test.js`).
  **What the system is told is in English.** The auto-launch entry
  (`openAutoLaunch` in `src/desktop.js`) is named with the configured English
  name (by `pickName`'s rule, so an `en-US` counts, as it does for the static
  `<title>`), else the first configured, else "Desktop Streamer" — the
  product's own name, a constant rather than the dictionary's `main.name`,
  since a slice that failed to load on one start and not the next would move
  the entry back and forth — stripped of what a registry value, a file name or
  an AppleScript string cannot hold — the name *is* the entry on Windows and
  Linux (a `Run` value, an autostart `.desktop` file). The vendored
  `auto-launch` does not honour it: its `fixOpts` replaces the name it is given
  with the executable's basename whenever the path holds a separator, which an
  absolute path always does, so every entry would be one entry. `createEntry`
  puts the name back over the library's — except on **macOS**, where the entry
  is a login item and System Events names a login item after its bundle
  whatever it is told (a login item's `name` is read only), so there the
  library's name is the only one that can be found again, nothing is ever
  moved, and no AppleScript runs until the setting is touched. Elsewhere the
  name the library picks (`readExeName` — what every build before that fix
  actually registered under) is added to the names to move the first time an
  executable is seen (`autoLaunchExeName` records it). For a plain dist that
  name is `electron`, which any other Electron app may have registered, so an
  entry under it is taken as ours only if it starts this executable
  (`startsExe`, which reads the `Run` value through `reg.exe` or the `Exec=`
  line of the autostart file, around the library that only says whether there
  is one): anybody else's is never read as on, moved or removed. A read that
  fails (a `reg.exe` past `REG_QUERY_TIMEOUT`, an unreadable file) throws
  rather than answering "not ours" — it is only asked once an entry was found
  under the name, so a "no" would drop that name from the list while its
  entry went on starting the application. Because the
  entry is found by its name, a renamed one would leave the old entry starting
  the application beside it and the setting reading as off, so every name an
  entry may still be under is kept in `localStorage` (`autoLaunchNames`,
  seeded from the single `autoLaunchName` of the build before it, else
  "Desktop Streamer"). The current name is written into that list *before*
  anything is registered under it, so a name renamed again before its move
  finished is still known and still moved; a name leaves the list only once
  nothing of ours is enabled under it. At start each enabled entry under
  another name is moved — the new one enabled first, the old one disabled
  after — in the background, not on the boot path. The calls of
  `desktop["autoLaunch"]` run one at a time behind that move, since each one
  rewrites the list of names left and two overlapping would drop a name the
  other still had an entry under; one that has not settled
  `AUTO_LAUNCH_QUEUE_TIMEOUT` after it started (a `reg.exe` that hangs, an
  AppleScript prompt nobody answers) fails its caller — so the checkbox it
  locked comes back — and frees the ones behind it, so a settings reset is
  never stuck behind it. The task itself cannot be stopped, so it runs on
  under a lease that has expired and writes nothing more: no entry enabled
  or disabled, no list of names saved over the one the next call is using. It answers for every name still left: it reads as on while any
  is, its `enable` retries the moves, and its `disable` (the settings reset's
  included — a `disable` that has no entry of its own to remove still removes
  the others) removes every one it can, so a failed move never leaves an
  entry the setting cannot see. A failure to move or remove an *old* entry is
  logged and kept for the next try, never thrown: the appearance window
  re-reads `isEnabled()` after every switch — a failed one too — and on every
  `open()`, since a settings reset disables it from another window, so the
  checkbox says what the system holds, the only record of the setting there
  is. The checkbox is disabled while a read or a switch is out and only the
  latest of them writes it, so a late answer never lands over a click; a read
  that fails after a failed switch puts it back rather than leaving it as
  clicked. **Every enable goes through `enableEntry`**: a `Run` value or an
  autostart file is rewritten in place, so enabling again is how an entry left
  pointing at an old executable (a build unzipped somewhere else) is pointed
  at this one; a macOS login item is *added* by every enable, so there one
  that exists is left as it is — removing it to make it again would lose it
  whenever the make failed — and switching the setting off and on is what
  points it at a moved build. A name that changes only in **case** is moved
  the other way round — the old entry disabled first, then the new one
  enabled — since the `Run` key ignores case, and there enabling the new name
  rewrites the old entry, which disabling the old name would then remove; if
  the new one cannot be made, the old one is enabled again, so a failed move
  never leaves no entry at all.
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
- **The desktop shell's libs are loaded by path, once.** `src/desktop.js` asks
  the main process for the app path and `require()`s the three libs from it -
  `auto-launch` and `ffmpeg-chunkifier` from the shell's own `libs/`, the
  `easy-control.node` addon from the native folder that the build lays beside it
  - onto `ctx["desktop"]`, and then sets `globalThis.require` to `undefined`, so
  nothing that runs after boot can reach Node whatever it was handed. Anything
  the desktop needs from Node is either on `ctx["desktop"]` already or goes
  through `ipcRenderer` to `main.js`.
- **The locked exit shortcuts** (ESC, and F11 in a browser) are the platform's
  own and cannot be edited or removed, so the row says so in a beercss tooltip
  rather than only greying its controls. A tooltip is shown by `:hover` on its
  parent, and a disabled control swallows the pointer in Chrome and Firefox, so
  `settings/control/view.css` gives the locked row's disabled controls
  `pointer-events: none` for the hover to reach the row.

## What is not wired yet

The pairing, join, room, account and stream flows are live: the picture, the
sound of a web host, and the peer's keyboard and mouse cross the room on both
legs (see The stream), and the desktop host's sound beside ffmpeg (a loopback
display capture, then ffmpeg from a loopback device or Linux's PulseAudio
monitor - both paths run on Windows in Electron 42; macOS and Linux are built
to what Electron and Chromium document and are untested). What `dev/plans/room-media.md` still lists as open: a desktop host cannot answer a keyframe request
over a pipe, the access unit splitter is one frame behind the encoder (a unit is
only known whole when the next delimiter arrives), and the enhancer runs mock
graphs - the pipeline is there, the trained models are not (see The
enhancer). The previous client implementation is at commit `da3921d`, and it read
message types the server no longer serves — do not paste it back untouched.

Two modules are markup with nothing behind them. `management/search`: the field
it mirrors and the button that opens it are both still commented out in the
shell markup, so nothing opens it. `room/settings` (`room-settings`): the
dialog a host would set what it shares and under what name in, an empty
`Dialog` subclass today — the host shares its primary display and the name a
share carries lives in `management/connection` for now.
