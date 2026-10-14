// A host split for display (ui/host.ts): the subdomain apart from the domain.
import { describe, expect, it } from 'vitest';
import { splitHost } from '../ui/host';

describe('splitHost', () => {
  it('takes the last two labels as the domain', () => {
    expect(splitHost('go.example.com')).toEqual(['go.', 'example.com']);
    expect(splitHost('k3f9x.links.example.com')).toEqual(['k3f9x.links.', 'example.com']);
  });

  it('takes three under a country second level', () => {
    expect(splitHost('go.example.co.uk')).toEqual(['go.', 'example.co.uk']);
    expect(splitHost('shop.example.com.ua')).toEqual(['shop.', 'example.com.ua']);
    expect(splitHost('go.example.me.uk')).toEqual(['go.', 'example.me.uk']);
    expect(splitHost('go.example.id.au')).toEqual(['go.', 'example.id.au']);
  });

  it('reads any case and a trailing dot, and always joins back into the host', () => {
    expect(splitHost('go.Example.CO.UK')).toEqual(['go.', 'Example.CO.UK']);
    expect(splitHost('go.example.com.')).toEqual(['go.', 'example.com.']);
    expect(splitHost('go.example.co.uk.')).toEqual(['go.', 'example.co.uk.']);
    for (const host of ['a.b.c.d.example.com', 'xn--80ak6aa92e.xn--p1ai', 'go.xn--80ak6aa92e.com', 'x', '.', 'example.com.'])
      expect(splitHost(host).join('')).toBe(host);
  });

  it('a bare domain has no subdomain', () => {
    expect(splitHost('example.com')).toEqual(['', 'example.com']);
    expect(splitHost('example.co.uk')).toEqual(['', 'example.co.uk']);
    expect(splitHost('localhost')).toEqual(['', 'localhost']);
  });
});
