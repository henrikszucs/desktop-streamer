"use strict";

// listing the cameras and microphones the browser will admit to
//
// a browser hands out unnamed, id-less devices until the page has been granted
// access once, so an empty list is asked for again after a getUserMedia call

const listDevicesHelper = async function(type) {
    const selectedDevices = [];
    let devices = await navigator.mediaDevices.enumerateDevices();
    for (let device of devices) {
        if (device.kind === type && (device.deviceId !== "default" || device.deviceId !== "communications")) {
            selectedDevices.push(device);
        }
    }
    const startLenght = selectedDevices.length;
    for (let i = startLenght - 1; i > -1; i--) {
        if (selectedDevices[i].deviceId === "" ) {
            selectedDevices.splice(i, 1);
        }
    }

    if (selectedDevices.length === 0 && startLenght !== 0) {
        return undefined;
    }
    return selectedDevices;
};

const listDevices = async function(type="audioinput") {
    // try to list device
    let selectedDevices = await listDevicesHelper(type);

    // try to get permission by accessing microphone
    if (selectedDevices === undefined) {
        try {
            const accessMediaStream = await navigator.mediaDevices.getUserMedia({"audio": true, "video": true});
            const accessTracks = accessMediaStream.getTracks();
            for (let track of accessTracks) {
                track.stop();
            }
        } catch(err) {
            console.log(err);
        }

        // try to list device again
        selectedDevices = await listDevicesHelper(type);
        if (selectedDevices === undefined) {
            return [];
        }
    }

    return selectedDevices;
};

export { listDevices };
export default { listDevices };
