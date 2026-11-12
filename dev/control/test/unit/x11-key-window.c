/*
 * For typing-x11.test.js: a window that takes the keyboard focus and prints,
 * one per line in hex, the keysym of every key press but the modifiers', as
 * the layout makes it (Shift and AltGr applied). Prints "ready" once it has
 * the focus, and ends after 3 s without a key.
 */

#include <stdio.h>
#include <sys/select.h>
#include <X11/Xlib.h>
#include <X11/Xutil.h>

int main(void) {
    Display* display = XOpenDisplay(NULL);
    if (display == NULL) {
        return 1;
    }
    Window window = XCreateSimpleWindow(display, DefaultRootWindow(display), 0, 0, 200, 100, 0, 0, 0);
    XSelectInput(display, window, KeyPressMask | StructureNotifyMask);
    XMapWindow(display, window);
    XEvent event;
    do {
        XNextEvent(display, &event);
    } while (event.type != MapNotify);
    XSetInputFocus(display, window, RevertToParent, CurrentTime);
    XSync(display, False);
    printf("ready\n");
    fflush(stdout);

    const int fd = ConnectionNumber(display);
    for (;;) {
        while (XPending(display) > 0) {
            XNextEvent(display, &event);
            if (event.type == KeyPress) {
                char text[32];
                KeySym keysym = NoSymbol;
                XLookupString(&event.xkey, text, sizeof(text), &keysym, NULL);
                if (!IsModifierKey(keysym)) {
                    printf("%lx\n", keysym);
                    fflush(stdout);
                }
            }
        }
        fd_set fds;
        FD_ZERO(&fds);
        FD_SET(fd, &fds);
        struct timeval timeout = { 3, 0 };
        if (select(fd + 1, &fds, NULL, NULL, &timeout) == 0) {
            break;
        }
    }
    XCloseDisplay(display);
    return 0;
}
