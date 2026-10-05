import { describe, expect, it } from 'vitest';
import { botCategory, browserOf, osOf } from '../src/bots';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

describe('bots', () => {
  it('sorts bots into categories, headless browsers included', () => {
    expect(botCategory('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe('search');
    expect(botCategory('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2)')).toBe('ai_training');
    expect(botCategory(CHROME.replace('Chrome', 'HeadlessChrome'))).toBe('headless');
    expect(botCategory('curl/8.5.0')).toBe('other');
  });
});

describe('families', () => {
  it('reads Edge, iOS, Android correctly and passes ordinary browsers', () => {
    expect(browserOf(CHROME.replace('Safari/537.36', 'Safari/537.36 Edg/140.0'))).toBe('edge');
    expect(osOf(IPHONE)).toBe('ios');
    expect(osOf('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/140 Mobile Safari/537.36')).toBe('android');
    expect(botCategory(CHROME)).toBeNull();
    expect(botCategory(IPHONE)).toBeNull();
    expect(botCategory('')).toBe('other');
  });
});
