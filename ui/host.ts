// A host split for display: the subdomain is set quieter so the eye lands on the domain. The API
// gives no zone with a host, so the domain is read off the name — the last two labels, three under
// a two-letter country's second level (example.co.uk, example.com.ua).
// A name the list misses only moves where the quieter part ends; the host still reads in full.
const SECOND_LEVEL = /^(?:co|com|net|org|gov|edu|ac|or|ne|go|me|id|ltd|plc|biz|info|nom|asn|in|gen|firm|sch|mil)\.[a-z]{2}\.?$/iu;

/** `['go.', 'example.com']` for `go.example.com`; `['', host]` when there is no subdomain. The two
 *  parts always join back into `host`, character for character. */
export function splitHost(host: string): [string, string] {
  const labels = host.split('.');
  // A trailing dot (the root) is an empty last label: it stays with the domain, uncounted.
  const root = labels.length > 1 && labels[labels.length - 1] === '' ? 1 : 0;
  const n = (labels.length - root > 2 && SECOND_LEVEL.test(labels.slice(-2 - root).join('.')) ? 3 : 2) + root;
  if (labels.length <= n) return ['', host];
  return [`${labels.slice(0, -n).join('.')}.`, labels.slice(-n).join('.')];
}
