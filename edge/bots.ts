// Bot classification by User-Agent, ported from the 301.st edge worker (docs/spec.md §5). The main
// filter is upstream of this: a bot that never runs the page's script never sends a beacon.

export type BotCategory = 'search' | 'ai_training' | 'monitoring' | 'ad_review' | 'social_preview' | 'headless' | 'other';

const SIGNATURES: { category: BotCategory; re: RegExp }[] = [
  { category: 'search', re: /Googlebot|Bingbot|YandexBot|DuckDuckBot|Baiduspider|\bYeti\b|Sogou|Applebot(?!-Extended)|Google-InspectionTool|SeznamBot|Qwantify/i },
  { category: 'ai_training', re: /GPTBot|CCBot|ClaudeBot|Claude-Web|anthropic-ai|Applebot-Extended|PerplexityBot|Perplexity-User|GoogleOther|Google-Extended|Amazonbot|Bytespider|FacebookBot|meta-externalagent|meta-externalfetcher|cohere-ai|Diffbot|DuckAssistBot|omgili|YouBot|ImagesiftBot|magpie-crawler|Kangaroo Bot|VelenPublicWebCrawler/i },
  { category: 'monitoring', re: /UptimeRobot|Pingdom|StatusCake|Hyperping|HetrixTools|SiteUptime|Site24x7|Better ?Uptime|NewRelic|Datadog|checkly|Gtmetrix/i },
  { category: 'ad_review', re: /Facebot|facebookexternalhit|FacebookAdsBot|Google-AdsBot|AdsBot-Google|TikTokBot|tiktokspider|LinkedInBot|PinterestBot|Bingbot-Ads|YandexAdNet/i },
  { category: 'social_preview', re: /Slackbot|TwitterBot|Twitterbot|Discordbot|TelegramBot|WhatsApp|Skype[Uu]ri|SkypePreview|MetaInspector|redditbot|VK Share|Line Bot|Snapchat|Threads/i },
  // Not in 301.st: there the filter sat in front of page requests, here behind a script, so the
  // bots that matter are the ones that run scripts — headless browsers and audit tools.
  { category: 'headless', re: /HeadlessChrome|PhantomJS|Puppeteer|Playwright|Lighthouse|Chrome-Lighthouse|Selenium|Electron\//i },
];

/** The bot category of a User-Agent, or null for a browser. */
export function botCategory(ua: string): BotCategory | null {
  const s = ua.trim();
  if (s.length < 10) return 'other';
  for (const { category, re } of SIGNATURES) if (re.test(s)) return category;
  if (/bot|crawl|spider|slurp|bingpreview|curl|wget|python-|go-http-client|node-fetch|axios|okhttp/i.test(s)) return 'other';
  return null;
}

/** Browser and OS families from a User-Agent (the families 301.st reports, Edge read by `Edg/`). */
export function browserOf(ua: string): string {
  if (/Edg\//.test(ua)) return 'edge';
  if (/OPR\/|Opera/.test(ua)) return 'opera';
  if (/SamsungBrowser/.test(ua)) return 'samsung';
  if (/Firefox\/|FxiOS/.test(ua)) return 'firefox';
  if (/Chrome\/|CriOS/.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}

export function osOf(ua: string): string {
  if (/Windows/.test(ua)) return 'windows';
  if (/Android/.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macos';
  if (/CrOS/.test(ua)) return 'chromeos';
  if (/Linux/.test(ua)) return 'linux';
  return 'other';
}
