/**
 * Disposable / temp-mail domain blocklist.
 *
 * These domains are free, throwaway email providers commonly used for spam
 * signups and abuse. Registration is rejected when the email's domain is in
 * this set (or in the optional DISPOSABLE_EMAIL_EXTRA env var, comma- or
 * space-separated, for project-specific additions).
 *
 * The list is the well-known public set (mailinator, guerrillamail, yopmail,
 * 10minutemail, tempmail, throwaway, etc.) plus a handful of the random
 * alphanumeric domains that automated signup tools rotate through.
 */
const KNOWN_DISPOSABLE: ReadonlySet<string> = new Set([
  // mailinator family
  "mailinator.com", "mailinator.net", "mailinator.org", "mailinator.io",
  "mailinator.co.uk", "mailinator2.com", "mailinator3.com",
  "mailshell.com", "spamherelots.com",
  // guerrillamail family
  "guerrillamail.com", "guerrillamail.net", "guerrillamail.org",
  "guerrillamail.biz", "guerrillamail.de", "grr.la", "pokemail.net",
  "spam4.me", "sharklasers.com",
  // yopmail family
  "yopmail.com", "yopmail.fr", "yopmail.net", "yopmail.org", "yopmail.co",
  "yopmail.ae", "yopmail.biz", "yopmail.cz", "yopmail.info", "yopmail.mx",
  "yopmail.site", "yopmail.uk", "yopmail.ws",
  // 10minutemail family
  "10minutemail.com", "10minutemail.net", "10minutemail.org",
  "10minutemail.info", "10minutemail.co.uk", "10minutemail.pl",
  "mytemp.email", "temp-mail.org", "temp-mail.io", "temp-mail.com",
  "tempmail.com", "tempmail.net", "tempmail.io", "tempmailo.com",
  "mailtemp.net", "tempinbox.com", "tmail.ws", "tmail.io",
  "throwawaymail.com", "throwaway.email", "trashmail.com", "trashmail.de",
  "trashmail.io", "trash-mail.com", "trashmailer.com", "trashmail.ws",
  "nada.email", "nadaemail.com", "fakemail.net", "fakeinbox.com",
  "dispostable.com", "maildrop.cc", "mailnesia.com", "mintemail.com",
  "getnada.com", "nada.email", "emailondeck.com", "mailcatch.com",
  "mailmetrash.com", "maileater.com", "meltmail.com", "spambox.us",
  "discard.email", "discardmail.com", "emailfake.com", "emailnator.com",
  "maildax.com", "mailer.me", "mailforspam.com", "mailnull.com",
  "mailsac.com", "mailinatorzz.com", "mailzi.ru", "mt2015.com",
  "pookmail.com", "sogetthis.com", "soodonims.com", "spamgourmet.com",
  "spam.la", "squizzy.de", "temporarymail.com", "tmailinator.com",
  "tradermail.info", "wh4f.org", "willselfdestruct.com", "wegwerfmail.de",
  "wegwerfmail.net", "wegwerfmail.org", "wegwerfmail.info",
  "mjukglass.nu", "mintemail.com", "mozmail.com", "spamdecoy.net",
  "temporaryinbox.com", "emailtemporario.com.br", "tmpmail.org",
  "tmpmail.net", "tmpmail.io", "1secmail.com", "1secmail.net",
  "1secmail.org", "deadaddress.com", "mytrashmail.com", "mailbite.io",
  "mohmal.com", "mohmal.in", "mohmal.tech", "cellurl.com",
  // random alphanumeric domains used by signup spammers
  "jbsze.net", "jbsze.com", "zhcne.com", "zhcne.net", "mzfv.net",
  "ndfgd.com", "abcmail.top", "bheps.com", "ctos.nl", "daum.net",
  "dgtew.com", "dzsln.com", "evxan.com", "feahe.com", "fexbox.org",
  "hienco.com", "huvudspira.com", "jmgk.net", "kxdpz.com", "lpoi.net",
  "moimoi.re", "nalwan.com", "nezhv.com", "odok.de", "offnft.com",
  "pokemail.net", "pwiwq.com", "raxlf.com", "rfsza.com", "rlcuq.com",
  "rtwerw.com", "scrtmail.com", "slmqt.com", "spymail.com", "ssyhe.com",
  "talme.net", "tbpia.com", "ttyeq.com", "tydfr.com", "vinza.com",
  "wzrln.com", "xkdke.com", "yep.it", "zxcv.com",
]);

function loadExtraDomains(): Set<string> {
  const raw = process.env.DISPOSABLE_EMAIL_EXTRA ?? "";
  return new Set(
    raw
      .split(/[\s,]+/)
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d.length > 0)
  );
}

/**
 * Returns true when the email uses a disposable/temp-mail domain.
 * Handles both "user@domain.com" and bare "@domain.com" inputs.
 */
export function isDisposableEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  const domain = email.trim().toLowerCase().split("@").pop() ?? "";
  if (!domain || domain === email.trim().toLowerCase()) return false;
  return KNOWN_DISPOSABLE.has(domain) || loadExtraDomains().has(domain);
}
