// clx-mailbox: the test inbox of the live probes. Email Routing on a subdomain of the clx.cx zone
// hands `probe+<tag>@<subdomain>` to this worker, which keeps each raw message a day in KV, keyed by
// the recipient and the time; a probe reads it back through the Cloudflare API.
const DAY = 86_400;
const MAX = 256 * 1024;

export default {
  async email(message, env) {
    const raw = await new Response(message.raw).text();
    await env.MAIL.put(`${message.to.toLowerCase()}:${Date.now()}`, raw.slice(0, MAX), { expirationTtl: DAY });
  },
};
