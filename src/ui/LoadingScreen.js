/**
 * The boot veil.
 *
 * Owns the markup already in `index.html` rather than creating its own, so the
 * first paint happens before any JavaScript has run.
 */
export class LoadingScreen {
  constructor() {
    this.root = document.getElementById('loader');
    this.fill = document.getElementById('loader-fill');
    this.status = document.getElementById('loader-status');
  }

  /**
   * @param {number} value 0..1
   * @param {string} [message]
   */
  setProgress(value, message) {
    if (this.fill) this.fill.style.width = `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
    if (message && this.status) this.status.textContent = message;
  }

  hide() {
    this.root?.classList.add('loader--done');
  }

  /** Leave the veil up and say what went wrong. */
  fail(message) {
    if (this.status) this.status.textContent = message;
    this.root?.classList.remove('loader--done');
    this.root?.classList.add('loader--failed');
    if (this.root && !this.root.querySelector('.loader__retry')) {
      const button = document.createElement('button');
      button.className = 'loader__retry';
      button.textContent = '다시 시도';
      button.style.cssText = 'margin-top:14px;padding:10px 22px;font:inherit;font-size:15px;border-radius:8px;border:1px solid rgba(220,232,247,.5);background:rgba(20,30,44,.8);color:#e6f0ff;cursor:pointer;pointer-events:auto;';
      button.addEventListener('click', () => location.reload());
      (this.status?.parentElement ?? this.root).appendChild(button);
    }
  }
}
