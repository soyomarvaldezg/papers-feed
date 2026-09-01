// extension/source-integration/pnas/index.ts
import { BaseSourceIntegration } from '../base-source';

export class PnasIntegration extends BaseSourceIntegration {
  readonly id = 'pnas';
  readonly name = 'PNAS'; 

  // Host allowlist: only well-formed http(s) URLs on pnas.org match
  readonly allowedHosts = ['pnas.org'];

  // Path pattern for articles, anchored to the parsed URL's pathname
  readonly urlPatterns = [
    /^\/doi\/10\.1073\/pnas\.([0-9]+)/
  ];

  // Extract the numeric PNAS id from the anchored pathname
  extractPaperId(url: string): string | null {
    const parsed = this.parseHttpUrl(url);
    if (!parsed || !this.isAllowedHost(parsed.hostname.toLowerCase())) {
      return null;
    }
    const match = parsed.pathname.match(this.urlPatterns[0]);
    return match ? match[1] : null;
  }
}

export const pnasIntegration = new PnasIntegration();
