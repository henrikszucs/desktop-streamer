"use strict";

// one card in the shares grid, and the four tags that say what kind of share it
// is. A repeated component, so its markup is a template literal.

const ShareBox = class extends EventTarget {
    constructor(joinId="", hostCode="") {
        super();
        const div = document.createElement("div");
        const html = `
            <div class="s12 m6 l3">
                <article class="padding shares-article">
                    <div class="max bold">
                        <span class="share-name">Default name</span>
                        <button class="circle transparent">
                            <i>more_vert</i>
                            <menu class="left no-wrap">
                                <li class="btn-share-settings">
                                    <i>settings</i>
                                    Settings
                                </li>
                                <li class="btn-share-delete">
                                    <i>delete</i>
                                    Delete
                                </li>
                            </menu>
                        </button>
                    </div>
                    <a class="wave">
                        <img class="responsive" src="/media/wallpaper.png">
                    </a>
                    <div class="small-padding">
                        <nav>
                            <div>
                                <button class="chip small-elevate error-text share-tag-local hide">
                                    <i>screen_record</i>
                                    <span>Local</span>
                                </button>
                                <button class="chip small-elevate primary-text share-tag-online hide">
                                    <i>done</i>
                                    <span>Online</span>
                                </button>
                                <button class="chip small-elevate share-tag-temporary hide">
                                    <i>today</i>
                                    <span>Temporary</span>
                                </button>
                                <button class="chip small-elevate secondary-text share-tag-offline hide">
                                    <i>close</i>
                                    <span>Offline</span>
                                </button>
                            </div>
                        </nav>
                    </div>
                </article>
            </div>
        `.trim();
        div.innerHTML = html;
        this.el = div.firstChild;

        this.joinId = joinId;
        this.hostCode = hostCode;

        this.nameEl = this.el.querySelector(".share-name");
        this.settingsBtn = this.el.querySelector(".btn-share-settings");
        this.deleteBtn = this.el.querySelector(".btn-share-delete");
        this.tagLocal = this.el.querySelector(".share-tag-local");
        this.tagOnline = this.el.querySelector(".share-tag-online");
        this.tagTemporary = this.el.querySelector(".share-tag-temporary");
        this.tagOffline = this.el.querySelector(".share-tag-offline");
    };
    setName(name="") {
        this.nameEl.textContent = name;
    };
    setTag(tag, isActive=true) {
        let interactEl = null;
        if (tag === "local") {
            interactEl = this.tagLocal;
        } else if (tag === "online") {
            interactEl = this.tagOnline;
        } else if (tag === "temporary") {
            interactEl = this.tagTemporary;
        } else if (tag === "offline") {
            interactEl = this.tagOffline;
        }

        let callName = "";
        if (isActive === true) {
            callName = "remove";
        } else {
            callName = "add";
        }

        interactEl.classList[callName]("hide");
    };
};

export { ShareBox };
export default ShareBox;
