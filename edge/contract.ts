// What clx.cx and clx-edge agree on (docs/spec.md §4): the cron of the self-check, when the worker
// reports `setup_ok`, and the working cron clx.cx sets once it has.
export const SELF_CHECK_CRON = '* * * * *';
export const WORKING_CRON = '5 * * * *';
