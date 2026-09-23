"use strict";

// language, theme colour, light or dark, and the two desktop only switches

// first-party dependencies
import { Panel } from "../../../../src/view.js";

const AppearanceWindow = class extends Panel {
    static id = "settings.appearance";
    static mountPoint = "#settings-windows";
    static rootId = "settings-appearance";

    async mount(ctx) {
        const conf = ctx["conf"];
        const localization = ctx["localization"];
        const desktop = ctx["desktop"];
        const setLocal = ctx["setLocal"];

        // language settings
        this.langSelect = document.getElementById("select-appearance-lang");
        this.langSelect.addEventListener("change", async (event) => {
            let lang = event.target.value;
            if (lang !== "auto" && localization.supportedLanguages.indexOf(lang) === -1) {
                lang = "auto";
            }
            await setLocal("lang", lang);

            // the language resolved and applied, the title with it
            lang = ctx["ui"].applyLanguage();
            if (desktop.isAvailable) {
                desktop.ipcRenderer.send("api", "set-lang", lang);
            }
        });

        // theme settings
        this.themeBtn = document.getElementById("btn-appearance-theme");
        this.themeBtn.addEventListener("click", async () => {
            if (conf["local"]["mode"] === "auto") {
                conf["local"]["mode"] = "light";
            } else if (conf["local"]["mode"] === "light") {
                conf["local"]["mode"] = "dark";
            } else {
                conf["local"]["mode"] = "auto";
            }
            ctx["ui"].applyTheme();
            this.setThemeIcon();
            await setLocal("mode", conf["local"]["mode"]);
        });
        document.getElementById("btn-appearance-theme-color").addEventListener("change", (event) => {
            this.setColor(event.target.value);
        });
        const presets = {
            "btn-appearance-theme-green": "#006e1c",
            "btn-appearance-theme-red": "#f44336",
            "btn-appearance-theme-pink": "#e91e63",
            "btn-appearance-theme-purple": "#9c27b0",
            "btn-appearance-theme-indigo": "#3f51b5",
            "btn-appearance-theme-blue": "#2196f3",
            "btn-appearance-theme-yellow": "#ffeb3b",
            "btn-appearance-theme-orange": "#ff9800"
        };
        for (const [id, color] of Object.entries(presets)) {
            document.getElementById(id).addEventListener("click", () => {
                this.setColor(color);
            });
        }

        // tray setting
        this.trayCheckbox = document.getElementById("checkbox-tray");
        this.trayLabel = document.getElementById("label-tray");
        this.trayError = document.getElementById("error-tray");
        if (desktop.isAvailable) {
            this.trayLabel.classList.remove("hide");
            this.trayCheckbox.checked = conf["local"]["minimizing"];
            this.trayCheckbox.addEventListener("change", async (event) => {
                const isChecked = event.target.checked;
                desktop.ipcRenderer.send("api", "set-tray", isChecked);
                await setLocal("minimizing", isChecked);
            });
        } else {
            this.trayError.classList.remove("hide");
        }

        // auto lanunch
        this.autoLaunchLabel = document.getElementById("label-auto-launch");
        this.autoLaunchCheckbox = document.getElementById("checkbox-auto-launch");
        this.autoLaunchError = document.getElementById("error-auto-launch");
        if (desktop.isAvailable) {
            this.autoLaunchLabel.classList.remove("hide");
            this.autoLaunchCheckbox.addEventListener("change", async (event) => {
                const isChecked = event.target.checked;
                const count = this.lockAutoLaunch();
                // what the system holds is read back either way, a failure too
                let isSwitched = false;
                try {
                    if (isChecked) {
                        await desktop.autoLaunch.enable();
                    } else {
                        await desktop.autoLaunch.disable();
                    }
                    isSwitched = true;
                } catch (error) {
                    console.error("Cannot switch auto launch:", error);
                }
                // the system is the only record of it - one that cannot be
                // read is taken as switched only if the switch did not fail
                let isEnabled = (isSwitched === true ? isChecked : !isChecked);
                try {
                    isEnabled = await desktop.autoLaunch.isEnabled();
                } catch (error) {
                    console.error("Cannot read auto launch:", error);
                }
                if (count === this.autoLaunchCount) {
                    event.target.checked = isEnabled;
                }
                this.unlockAutoLaunch(count);
            });
        } else {
            this.autoLaunchError.classList.remove("hide");
        }
    };

    setThemeIcon() {
        const mode = this.ctx["conf"]["local"]["mode"];
        if (mode === "auto") {
            this.themeBtn.children[0].innerText = "hdr_auto";
        } else if (mode === "light") {
            this.themeBtn.children[0].innerText = "light_mode";
        } else {
            this.themeBtn.children[0].innerText = "dark_mode";
        }
    };
    // drawn at once and written behind it - applyTheme reads the value that
    // setLocal puts in memory before it reaches the disk
    async setColor(color) {
        const saving = this.ctx["setLocal"]("color", color);
        await this.ctx["ui"].applyTheme();
        await saving;
    };

    // the checkbox is off limits while a read or a switch is out, and only the
    // latest of them hands it back, so a late answer never lands over a click
    lockAutoLaunch() {
        this.autoLaunchCheckbox.disabled = true;
        this.autoLaunchCount = (this.autoLaunchCount ?? 0) + 1;
        return this.autoLaunchCount;
    };
    unlockAutoLaunch(count) {
        if (count === this.autoLaunchCount) {
            this.autoLaunchCheckbox.disabled = false;
        }
    };

    // the system holds the setting, so a reset or another window may have moved it
    readAutoLaunch() {
        const count = this.lockAutoLaunch();
        this.ctx["desktop"].autoLaunch.isEnabled().then((isEnabled) => {
            if (count === this.autoLaunchCount) {
                this.autoLaunchCheckbox.checked = isEnabled;
            }
        }).catch((error) => {
            console.error("Cannot read auto launch:", error);
        }).finally(() => {
            this.unlockAutoLaunch(count);
        });
    };

    open(params) {
        this.langSelect.value = this.ctx["conf"]["local"]["lang"];
        this.setThemeIcon();
        if (this.ctx["desktop"].isAvailable === true) {
            this.readAutoLaunch();
        }
        super.open(params);
    };
};

export { AppearanceWindow };
export default AppearanceWindow;
