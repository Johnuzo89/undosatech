// Institutional domain patterns — uses domain.includes(d) so:
//   'edu'   matches harvard.edu, nus.edu.sg, pku.edu.cn, usp.edu.br, etc.
//   'ac.uk' matches all UK academic domains
//   'ac.jp' matches all Japanese academic domains, etc.
export const INSTANT_DOMAINS = [
  // ── UK / Ireland ──────────────────────────────────────────────────────
  'ac.uk', 'nhs.uk', 'nhs.net', 'hse.ie',
  'tcd.ie', 'ucd.ie', 'nuig.ie', 'ucc.ie', 'ul.ie', 'dcu.ie', 'maynooth.ie',

  // ── USA / Global .edu  (also catches .edu.sg, .edu.cn, .edu.br, etc.) ──
  'edu',

  // ── Canada (no unified .edu.ca; list major universities) ───────────────
  'utoronto.ca','ubc.ca','mcgill.ca','ualberta.ca','uwaterloo.ca',
  'queensu.ca','dal.ca','uottawa.ca','umontreal.ca','laval.ca',
  'ucalgary.ca','usask.ca','umanitoba.ca','unb.ca','mun.ca',
  'yorku.ca','carleton.ca','sfu.ca','uvic.ca','concordia.ca',
  'torontomu.ca','uqam.ca','uregina.ca','uwindsor.ca','gc.ca',

  // ── Australia / New Zealand / Pacific ─────────────────────────────────
  'edu.au','ac.nz','ac.fj','ac.pg',

  // ── Europe: countries using .ac.XX ────────────────────────────────────
  'ac.at',   // Austria
  'ac.be',   // Belgium (some)
  'ac.cy',   // Cyprus

  // ── Europe: common name-based academic prefixes ────────────────────────
  'uni-','tu-','fh-','hs-','univ-',

  // ── Europe: Switzerland ────────────────────────────────────────────────
  'eth.ch','epfl.ch','uzh.ch','unibe.ch','unil.ch','unige.ch','unibas.ch',

  // ── Europe: Germany (major institutions without uni-/tu- prefix) ───────
  'rwth-aachen.de','fu-berlin.de','hu-berlin.de','lmu.de','tum.de',
  'charite.de','dkfz.de','embl.de','mpg.de','hpi.de',

  // ── Europe: France ────────────────────────────────────────────────────
  'inserm.fr','cnrs.fr','inria.fr','pasteur.fr',
  'sorbonne-universite.fr','u-paris.fr','ens.fr','ens-lyon.fr',

  // ── Europe: Netherlands ───────────────────────────────────────────────
  'uva.nl','vu.nl','tudelft.nl','leiden.nl','rug.nl','uu.nl',
  'utwente.nl','tue.nl','radboudumc.nl','erasmusmc.nl',
  'umcutrecht.nl','lumc.nl','nki.nl','umcg.nl','maastrichtuniversity.nl',

  // ── Europe: Scandinavia ───────────────────────────────────────────────
  'uio.no','ntnu.no','uib.no','uit.no',
  'ku.dk','dtu.dk','au.dk','sdu.dk',
  'su.se','kth.se','liu.se','ki.se','chalmers.se','gu.se','umu.se','lu.se',
  'aalto.fi','helsinki.fi','oulu.fi','jyu.fi','tuni.fi',
  'hi.is','ru.is',

  // ── Europe: Belgium ───────────────────────────────────────────────────
  'kuleuven.be','ugent.be','vub.be','uliege.be','ulb.be','unamur.be',

  // ── Europe: Spain ─────────────────────────────────────────────────────
  'upm.es','uam.es','ucm.es','upv.es','us.es','uv.es','usc.es',

  // ── Europe: Italy ─────────────────────────────────────────────────────
  'unibo.it','polimi.it','polito.it','uniroma1.it','uniroma2.it','unipi.it',
  'humanitasresearch.it',

  // ── Europe: Portugal ──────────────────────────────────────────────────
  'ulisboa.pt','up.pt','nova.pt','uminho.pt',

  // ── Europe: Eastern / Central ─────────────────────────────────────────
  'cuni.cz','cvut.cz',           // Czech Republic
  'bme.hu','elte.hu',            // Hungary
  'uw.edu.pl',                   // Poland (also caught by 'edu')
  'ncbj.gov.pl',

  // ── Asia: countries using .ac.XX ──────────────────────────────────────
  'ac.jp',   // Japan
  'ac.in',   // India
  'ac.id',   // Indonesia
  'ac.il',   // Israel
  'ac.ir',   // Iran
  'ac.kr',   // South Korea
  'ac.th',   // Thailand
  'ac.ae',   // UAE
  'ac.lk',   // Sri Lanka
  'ac.bd',   // Bangladesh (some)
  'ac.np',   // Nepal (some)
  'ac.vn',   // Vietnam (some)

  // ── Asia: .edu.XX all caught by 'edu' (Singapore, HK, Taiwan, China…) ──

  // ── Africa: countries using .ac.XX ────────────────────────────────────
  'ac.za',   // South Africa
  'ac.ke',   // Kenya
  'ac.ug',   // Uganda
  'ac.tz',   // Tanzania
  'ac.rw',   // Rwanda
  'ac.zw',   // Zimbabwe
  'ac.zm',   // Zambia
  'ac.mw',   // Malawi
  'ac.gh',   // Ghana
  'ac.bw',   // Botswana
  'ac.na',   // Namibia
  'ac.mu',   // Mauritius
  'ac.sz',   // Eswatini
  'ac.ls',   // Lesotho
  'ac.ma',   // Morocco (some)

  // ── Africa: .edu.XX caught by 'edu' (Nigeria, Egypt, Ethiopia, etc.) ───

  // ── Latin America: .edu.XX caught by 'edu' (Brazil, Argentina, etc.) ───

  // ── Middle East: .edu.XX caught by 'edu' (Saudi, Jordan, Lebanon…) ────

  // ── Global health & research orgs ─────────────────────────────────────
  'who.int','paho.org','wellcome.org','nih.gov','cdc.gov',
]

export function isInstitutional(email) {
  if (!email) return false
  const domain = email.split('@')[1]?.toLowerCase() || ''
  return INSTANT_DOMAINS.some(d => domain.includes(d))
}
