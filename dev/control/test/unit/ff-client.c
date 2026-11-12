// What a game does to rumble a gamepad on Linux, for gamepad.test.js:
// uploads a rumble effect of 200 ms and plays it, lets it end by its length,
// then plays a second one without a length and stops it, and erases both.
//
//     ff-client /dev/input/eventN
#include <fcntl.h>
#include <linux/input.h>
#include <stdio.h>
#include <string.h>
#include <sys/ioctl.h>
#include <unistd.h>

static int upload(int fd, int strong, int weak, int length) {
    struct ff_effect effect;
    memset(&effect, 0, sizeof(effect));
    effect.type = FF_RUMBLE;
    effect.id = -1;
    effect.u.rumble.strong_magnitude = strong;
    effect.u.rumble.weak_magnitude = weak;
    effect.replay.length = length;
    if (ioctl(fd, EVIOCSFF, &effect) < 0) {
        perror("EVIOCSFF");
        return -1;
    }
    return effect.id;
}

static int play(int fd, int id, int count) {
    struct input_event event;
    memset(&event, 0, sizeof(event));
    event.type = EV_FF;
    event.code = id;
    event.value = count;
    return write(fd, &event, sizeof(event)) == sizeof(event) ? 0 : -1;
}

int main(int argc, char** argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: ff-client /dev/input/eventN\n");
        return 2;
    }
    int fd = open(argv[1], O_RDWR);
    if (fd < 0) {
        perror("open");
        return 1;
    }
    int first = upload(fd, 0xC000, 0x4000, 200);
    if (first < 0 || play(fd, first, 1) < 0) {
        return 1;
    }
    usleep(500000);     // it ends by its length
    int second = upload(fd, 0xFFFF, 0xFFFF, 0);
    if (second < 0 || play(fd, second, 1) < 0) {
        return 1;
    }
    usleep(200000);
    if (play(fd, second, 0) < 0) {
        return 1;
    }
    usleep(100000);
    if (ioctl(fd, EVIOCRMFF, first) < 0 || ioctl(fd, EVIOCRMFF, second) < 0) {
        perror("EVIOCRMFF");
        return 1;
    }
    close(fd);
    return 0;
}
