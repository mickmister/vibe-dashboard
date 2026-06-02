import { describe, expect, it } from 'vitest';
import { getOriginTrustKey, hasSameBaseOrigin } from './originTrust';

describe('originTrust', () => {
  it('compares IP hosts exactly instead of by trailing dotted segments', () => {
    expect(getOriginTrustKey('http://10.0.1.2:3000')).toBe('http://10.0.1.2');
    expect(getOriginTrustKey('http://192.168.1.2:3000')).toBe(
      'http://192.168.1.2',
    );
    expect(
      hasSameBaseOrigin(
        'http://10.0.1.2:3000',
        'http://192.168.1.2:3000',
      ),
    ).toBe(false);
  });

  it('compares IPv6 hosts exactly', () => {
    expect(getOriginTrustKey('http://[2001:db8::1]:3000')).toBe(
      'http://2001:db8::1',
    );
    expect(
      hasSameBaseOrigin(
        'http://[2001:db8::1]:3000',
        'http://[2001:db8::2]:3000',
      ),
    ).toBe(false);
  });

  it('continues to trust port-prefixed subdomains by base hostname', () => {
    expect(
      hasSameBaseOrigin(
        'https://port-3000.example.test',
        'https://port-4000.example.test',
      ),
    ).toBe(true);
  });
});
