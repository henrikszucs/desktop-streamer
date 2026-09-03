"use strict";

// the search dialog of the small layout, kept in step with the wide search field
// of the top bar
//
// Nothing opens it yet: the field it mirrors and the button that opens it are
// both still commented out in the shell markup, so the module wires the halves
// that are actually there and leaves the rest alone.

// first-party dependencies
import { Dialog } from "../../../src/view.js";

const SearchDialog = class extends Dialog {
    static id = "search";
    static rootId = "dialog-search";

    // the wide field of the top bar, only there once the shell markup is
    barInput = null;
    barInputTrue = null;
    barInputFinish = null;

    async mount(ctx) {
        // get important elements
        this.barInput = document.getElementById("input-search");
        this.barInputTrue = document.getElementById("input-search-true");
        this.barInputFinish = document.getElementById("input-search-finish");
        this.searchInput2 = document.getElementById("input-search-2");
        this.searchInput2Menu = document.getElementById("input-search-2-menu");
        this.searchInput2True = document.getElementById("input-search-2-true");
        this.searchInput2Finish = document.getElementById("input-search-2-finish");

        // set passive behavior
        // common value for all input elements
        this.searchInput2.addEventListener("click", () => {
            this.searchInput2True.focus();
        });
        this.searchInput2True.addEventListener("input", this.spreadSearchInput);

        // finish of search input
        this.searchInput2True.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                this.requestClose();
                this.triggerSearch();
            }
        });
        this.searchInput2Finish.addEventListener("click", () => {
            this.requestClose();
            this.triggerSearch();
        });

        if (this.barInput === null) {
            return;
        }
        this.barInput.addEventListener("click", () => {
            this.barInputTrue.focus();
        });
        this.barInputTrue.addEventListener("input", this.spreadSearchInput);
        this.barInputTrue.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                this.barInputTrue.blur();
                this.triggerSearch();
            }
        });
        this.barInputFinish.addEventListener("click", () => {
            this.triggerSearch();
        });
    };
    open(params) {
        super.open(params);
        this.searchInput2True.focus();
    };
    close() {
        this.searchInput2.blur();
        this.searchInput2True.blur();
        super.close();
    };
    spreadSearchInput = (event) => {
        const value = event.target.value;
        this.searchInput2.value = value;
        this.searchInput2True.value = value;
        if (this.barInput === null) {
            return;
        }
        this.barInput.value = value;
        this.barInputTrue.value = value;
    };
    triggerSearch() {
        this.dispatchEvent(new CustomEvent("search", {
            "detail": {
                "value": this.searchInput2True.value
            }
        }));
    };
};

export { SearchDialog };
export default SearchDialog;
