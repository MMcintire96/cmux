// Find bar for terminal search

class FindBar {
  constructor(paneManager) {
    this.paneManager = paneManager;
    this.barEl = document.getElementById('find-bar');
    this.inputEl = document.getElementById('find-input');
    this.countEl = document.getElementById('find-count');
    this.visible = false;

    document.getElementById('find-next').addEventListener('click', () => this.findNext());
    document.getElementById('find-prev').addEventListener('click', () => this.findPrev());
    document.getElementById('find-close').addEventListener('click', () => this.hide());

    this.inputEl.addEventListener('input', () => this.find());
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) this.findPrev();
        else this.findNext();
      }
      if (e.key === 'Escape') this.hide();
    });
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  show() {
    this.visible = true;
    this.barEl.classList.remove('hidden');
    this.inputEl.focus();
    this.inputEl.select();
  }

  hide() {
    this.visible = false;
    this.barEl.classList.add('hidden');
    this.countEl.textContent = '';
    // Re-focus terminal
    const pane = this.paneManager.getFocusedPane();
    if (pane) pane.term.focus();
  }

  find() {
    const query = this.inputEl.value;
    if (query) {
      this.paneManager.search(query);
    }
  }

  findNext() {
    this.paneManager.searchNext(this.inputEl.value);
  }

  findPrev() {
    this.paneManager.searchPrev(this.inputEl.value);
  }
}

window.FindBar = FindBar;
