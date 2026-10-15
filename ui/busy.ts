// The loading bar (301-ui's loading indicator, without its notice flash): a shimmer along the
// header's lower edge while work runs — a call the reader started, or an operation the open page
// shows running — so a slow action is not taken for a dead button.
let bar: HTMLElement | null = null;
let calls = 0; // counted: two calls at once end with the last one
let page = false;

function draw(): void {
  if (!bar) {
    bar = document.createElement('div');
    bar.classList.add('loading-bar');
    (document.querySelector('.topbar') ?? document.body).append(bar);
  }
  if (calls > 0 || page) bar.dataset.loading = '';
  else delete bar.dataset.loading;
}

/** Shows the bar until the returned function is called (once; later calls do nothing). */
export function busy(): () => void {
  calls++;
  draw();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    calls--;
    draw();
  };
}

/** The open page's own work (an install running): the router clears it on every page drawn. */
export function pageBusy(on: boolean): void {
  page = on;
  draw();
}
