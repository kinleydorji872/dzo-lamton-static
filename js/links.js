/* ==========================================================
   links.js  -  ONE list of Dzongkha links, used for
   (1) the external-link header bar at the top, and
   (2) the searchable "Links" page.
   To add a link, add a line in LINKS. `bar: true` also puts it in the header bar.
   ========================================================== */
(() => {
  'use strict';
  const LINKS = [
    // ---- Official & language authority
    { cat: 'Official & language authority', title: 'Dzongkha Development Commission (DDC)', short: 'DDC', url: 'https://www.dzongkha.gov.bt', desc: 'Official body for Dzongkha: standards, dictionaries, fonts and terminology.', bar: true },

    // ---- Dictionaries
    { cat: 'Dictionaries', title: 'DDC Dictionary (iPhone / iPad app)', short: 'Dictionary', url: 'https://apps.apple.com/us/app/-/id1555517704', desc: 'Dzongkha dictionary app published for the DDC.', bar: true },
    { cat: 'Dictionaries', title: 'Dzongkha Dictionary (iPhone / iPad app)', url: 'https://apps.apple.com/app/id902728616', desc: 'Another Dzongkha dictionary app for Apple devices.' },
    { cat: 'Dictionaries', title: 'Online Dzongkha ⇄ English dictionary (Thimphu Tech)', url: 'https://www.thimphutech.com/2010/10/online-dzongkha-english-dzongkha.html', desc: 'Blog post that points to online Dzongkha–English dictionaries.' },
    { cat: 'Dictionaries', title: 'Digitalization of the Dzongkha dictionary (TUFS)', url: 'https://www.aa.tufs.ac.jp/~kmach/IRC/2011/Dzongkha2011.htm', desc: 'Research note on turning the Dzongkha dictionary into digital form.' },
    { cat: 'Dictionaries', title: 'Dzongkha–English dictionary records (Mandala Library, UVA)', url: 'https://sources.mandala.library.virginia.edu/node/125281', desc: 'Library record of a Dzongkha–English dictionary.' },

    // ---- Fonts & typing
    { cat: 'Fonts & typing', title: 'DDC Uchen font (fonts-ddc-uchen)', short: 'Fonts', url: 'https://packages.debian.org/sid/fonts-ddc-uchen', desc: 'Free DDC Unicode font package. (Get DDC Joyig from the DDC site.)', bar: true },
    { cat: 'Fonts & typing', title: 'Dzongkha Keyboard (DDC) – iPhone / iPad app', short: 'Keyboard', url: 'https://apps.apple.com/us/app/-/id1552829793', desc: 'Type Dzongkha on Apple phones with the DDC keyboard.', bar: true },
    { cat: 'Fonts & typing', title: 'Dzongkha keyboard layout (UVA)', url: 'https://collab.its.virginia.edu/access/content/group/26a34146-33a6-48ce-001e-f16ce7908a6a/Tibetan%20Input%20Tools/Dzongkha%20Keyboard%20Resources/dzkeylayout.html', desc: 'Key map for the standard Bhutanese Dzongkha keyboard.' },
    { cat: 'Fonts & typing', title: 'SALRC – Tibetan & Dzongkha fonts', url: 'https://salrc.uchicago.edu/resources/fonts/available/tibetan', desc: 'University of Chicago list of Unicode fonts that support Dzongkha.' },
    { cat: 'Fonts & typing', title: 'Noto Serif Tibetan (Google Fonts)', url: 'https://fonts.google.com/noto/specimen/Noto+Serif+Tibetan', desc: 'Backup font this app uses when DDC Joyig is not installed.' },
    { cat: 'Fonts & typing', title: 'Thimphu Tech – Dzongkha tips (typing, phones, SMS)', url: 'https://www.thimphutech.com/search/label/Dzongkha', desc: 'Practical posts on using Dzongkha on computers and phones.' },
    { cat: 'Fonts & typing', title: 'Dzongkha on iPhone, iPad and iPod touch', url: 'https://www.thimphutech.com/2011/05/dzongkha-on-iphone-ipad-ipod-touch.html', desc: 'How to read and type Dzongkha on Apple devices.' },

    // ---- Spelling & script
    { cat: 'Spelling & script', title: 'Hunspell Dzongkha spell-checker', url: 'https://packages.debian.org/sid/hunspell-dz', desc: 'Open-source Dzongkha spelling dictionary (LibreOffice, Firefox and more).' },
    { cat: 'Spelling & script', title: 'Joyig script (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Joyig_script', desc: 'History of the Joyig style used in Bhutan.' },

    // ---- Learning & reference
    { cat: 'Learning & reference', title: 'Dzongkha For Kids (iPhone / iPad app)', url: 'https://apps.apple.com/au/app/id1149715462', desc: 'Learning app for children.' },
    { cat: 'Learning & reference', title: 'Dzongkha language (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Dzongkha', desc: 'Overview of the national language of Bhutan.' },
    { cat: 'Learning & reference', title: 'རྫོང་ཁ་ཝིག་ཀི་པི་ཌི་ཡ། · Dzongkha Wikipedia', short: 'Dzongkha Wikipedia', url: 'https://dz.wikipedia.org', desc: 'Articles written in Dzongkha – good for checking modern vocabulary.', bar: true },

    // ---- News & media
    { cat: 'News & media in Dzongkha', title: 'Kuensel – རྫོང་ཁ། (Dzongkha edition)', short: 'Kuensel རྫོང་ཁ།', url: 'https://kuenselonline.com/dz', desc: 'National newspaper of Bhutan with Dzongkha content.', bar: true },
    { cat: 'News & media in Dzongkha', title: 'Bhutan Broadcasting Service (BBS)', short: 'BBS', url: 'https://www.bbs.bt', desc: 'National broadcaster; the site has a Dzongkha language switch.', bar: true },
    { cat: 'News & media in Dzongkha', title: 'Mass media in Bhutan (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Mass_media_in_Bhutan', desc: 'Overview of newspapers, radio and TV in Bhutan.' },

    // ---- Voice & AI
    { cat: 'Voice & AI for Dzongkha', title: 'MMS-TTS Dzongkha voice (Meta)', url: 'https://huggingface.co/facebook/mms-tts-dzo', desc: 'Text-to-speech model behind the Listen button. CC-BY-NC 4.0 (non-commercial).' },
    { cat: 'Voice & AI for Dzongkha', title: 'MMS-1B-all speech recognition (Meta)', url: 'https://huggingface.co/facebook/mms-1b-all', desc: 'Has a Dzongkha (dzo) adapter used for Dzongkha voice input.' },
    { cat: 'Voice & AI for Dzongkha', title: 'Dzongkha Text-to-Speech – CST, Royal University of Bhutan', url: 'https://nlp.cst.edu.bt/tts/', desc: 'A Bhutanese research project on Dzongkha speech synthesis.' },
    { cat: 'Voice & AI for Dzongkha', title: 'Pioneering Dzongkha Text-to-Speech Synthesis (paper)', url: 'https://tech.gov.bt/wp-content/uploads/2024/08/OCOCOSDA2008_final.pdf', desc: 'Research paper from Bhutan\'s Department of IT.' }
  ];

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

  /* ---- header bar ---- */
  const bar = document.getElementById('linkbar-list');
  if (bar) {
    bar.innerHTML = LINKS.filter(l => l.bar).map(l =>
      `<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" title="${esc(l.title)}">${esc(l.short || l.title)}</a></li>`).join('');
  }
  const all = document.getElementById('linkbar-all');
  if (all) all.addEventListener('click', e => { e.preventDefault(); const t = document.querySelector('.nav-btn[data-tab="sources"]'); t && t.click(); });

  /* ---- Links page (grouped + searchable) ---- */
  const dir = document.getElementById('links-dir');
  const search = document.getElementById('links-search');
  const count = document.getElementById('links-count');
  if (!dir) return;

  function render(q = '') {
    q = q.trim().toLowerCase();
    const cats = [...new Set(LINKS.map(l => l.cat))];
    let shown = 0;
    dir.innerHTML = cats.map(cat => {
      const items = LINKS.filter(l => l.cat === cat && (!q || (l.title + ' ' + l.desc + ' ' + l.url + ' ' + cat).toLowerCase().includes(q)));
      if (!items.length) return '';
      shown += items.length;
      return `<section class="links-cat"><h3>${esc(cat)}</h3><ul class="sources">` + items.map(l =>
        `<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"><b>${esc(l.title)}</b><span>${esc(l.desc)}</span><em>${esc(host(l.url))} ↗</em></a></li>`).join('') + '</ul></section>';
    }).join('') || '<p class="hint">No link matches your search.</p>';
    if (count) count.textContent = shown + ' of ' + LINKS.length + ' links';
  }
  if (search) search.addEventListener('input', () => render(search.value));
  render();
})();
