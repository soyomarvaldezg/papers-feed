// extension/source-integration/misc/index.ts
/*
 * Catch-all for registering with URL pattern only
 */
import { BaseSourceIntegration } from '../base-source';

export class MiscIntegration extends BaseSourceIntegration {
  readonly id = 'url-misc';
  readonly name = 'misc tracked url';

  readonly urlPatterns = []; // set this empty to disable attaching the content injection icon thing
    
  // add URLs here to track
  readonly contentScriptMatches = [
    "sciencedirect.com/science/article/",
    "philpapers.org/rec/",
    "proceedings.neurips.cc/paper_files/paper/",
    "journals.sagepub.com/doi/",
    "link.springer.com/article/",
    ".science.org/doi/",
    "journals.aps.org/prx/abstract/",
    "onlinelibrary.wiley.com/doi/",
    "cell.com/trends/cognitive-sciences/fulltext/",
    "researchgate.net/publication/",
    "psycnet.apa.org/record/",
    "biorxiv.org/content/",
    "osf.io/preprints/",
    "frontiersin.org/journals/",
    "jstor.org/",
    "proceedings.mlr.press/",
    "journals.plos.org/plosone/article",
    "ieeexplore.ieee.org/document/",
    "royalsocietypublishing.org/doi/",
    "papers.nips.cc/paper_files/paper/",
    "philarchive.org/archive/",
    "tandfonline.com/doi/",
    "iopscience.iop.org/article/",
    "academic.oup.com/brain/article/",
    "elifesciences.org/articles/",
    "escholarship.org/content/",
    "pmc.ncbi.nlm.nih.gov/articles/",
    "pubmed.ncbi.nlm.nih.gov/",
    "openaccess.thecvf.com/content/",
    "zenodo.org/records/",
    "journals.asm.org/doi/full/",
    "physoc.onlinelibrary.wiley.com/doi/full/",
    "storage.courtlistener.com/recap/",
    "bmj.com/content/",
    "ntsb.gov/investigations/pages",
    "ntsb.gov/investigations/AccidentReports",
    "aclanthology.org/",
    "journals.ametsoc.org/view/journals/",
    
    "substack.com/p/",
    "citeseerx.",
    "/doi/",
    "/pdf/",

  ];

  // Host allowlist derived from the substring patterns above. Each entry
  // pins the pattern to an explicit host (subdomains included) and, where
  // the original pattern had a meaningful path, an anchored path prefix.
  // The bare "/doi/" and "/pdf/" substrings were dropped: they matched any
  // host and could be spoofed via query strings; every publisher they
  // covered is listed explicitly here.
  private readonly trackedHosts: Array<{ host: string; pathPrefix?: string }> = [
    { host: 'sciencedirect.com', pathPrefix: '/science/article/' },
    { host: 'philpapers.org', pathPrefix: '/rec/' },
    { host: 'proceedings.neurips.cc', pathPrefix: '/paper_files/paper/' },
    { host: 'journals.sagepub.com', pathPrefix: '/doi/' },
    { host: 'link.springer.com', pathPrefix: '/article/' },
    { host: 'science.org', pathPrefix: '/doi/' },
    { host: 'journals.aps.org', pathPrefix: '/prx/abstract/' },
    { host: 'onlinelibrary.wiley.com', pathPrefix: '/doi/' },
    { host: 'physoc.onlinelibrary.wiley.com', pathPrefix: '/doi/full/' },
    { host: 'cell.com', pathPrefix: '/trends/cognitive-sciences/fulltext/' },
    { host: 'researchgate.net', pathPrefix: '/publication/' },
    { host: 'psycnet.apa.org', pathPrefix: '/record/' },
    { host: 'biorxiv.org', pathPrefix: '/content/' },
    { host: 'osf.io', pathPrefix: '/preprints/' },
    { host: 'frontiersin.org', pathPrefix: '/journals/' },
    { host: 'jstor.org' },
    { host: 'proceedings.mlr.press' },
    { host: 'journals.plos.org', pathPrefix: '/plosone/article' },
    { host: 'ieeexplore.ieee.org', pathPrefix: '/document/' },
    { host: 'royalsocietypublishing.org', pathPrefix: '/doi/' },
    { host: 'papers.nips.cc', pathPrefix: '/paper_files/paper/' },
    { host: 'philarchive.org', pathPrefix: '/archive/' },
    { host: 'tandfonline.com', pathPrefix: '/doi/' },
    { host: 'iopscience.iop.org', pathPrefix: '/article/' },
    { host: 'academic.oup.com', pathPrefix: '/brain/article/' },
    { host: 'elifesciences.org', pathPrefix: '/articles/' },
    { host: 'escholarship.org', pathPrefix: '/content/' },
    { host: 'pmc.ncbi.nlm.nih.gov', pathPrefix: '/articles/' },
    { host: 'pubmed.ncbi.nlm.nih.gov' },
    { host: 'openaccess.thecvf.com', pathPrefix: '/content/' },
    { host: 'zenodo.org', pathPrefix: '/records/' },
    { host: 'journals.asm.org', pathPrefix: '/doi/full/' },
    { host: 'storage.courtlistener.com', pathPrefix: '/recap/' },
    { host: 'bmj.com', pathPrefix: '/content/' },
    { host: 'ntsb.gov', pathPrefix: '/investigations/' },
    { host: 'aclanthology.org' },
    { host: 'journals.ametsoc.org', pathPrefix: '/view/journals/' },
    { host: 'substack.com', pathPrefix: '/p/' },
    { host: 'citeseerx.ist.psu.edu' },
  ];

  canHandleUrl(url: string): boolean {
    const parsed = this.parseHttpUrl(url);
    if (!parsed) {
      return false;
    }
    
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;
    
    return this.trackedHosts.some(entry =>
      (hostname === entry.host || hostname.endsWith(`.${entry.host}`)) &&
      (!entry.pathPrefix || pathname.startsWith(entry.pathPrefix))
    );
  }
}

export const miscIntegration = new MiscIntegration();
