// Turkish words for what Lykos names, so a Turkish query finds the English label: the keys are folded (no accents, ı as i; lib/search-ranking.mjs
// foldSearch) and stand for the word and any ending it takes, since the palette tries the stem too (lib/search-smart.mjs). The values are the words a
// label or a record in the project is likely to use. It is vocabulary, not translation: nothing here is shown to a person.
export const LEXICON = Object.freeze({
  // the views and what they hold
  ozet: ['overview', 'summary', 'abstract'], genel: ['overview'], kutuphane: ['library'], kayit: ['record', 'records', 'library'], makale: ['paper', 'article', 'record', 'library'],
  yayin: ['paper', 'publication', 'record'], calisma: ['study', 'studies'], arastirma: ['research', 'study'], tarama: ['screening', 'search'], eleme: ['screening'], arama: ['search'],
  ara: ['search', 'find'], bul: ['find', 'search'], veri: ['data', 'dataset', 'extraction'], cikarim: ['extraction'], cikarma: ['extraction'], cikar: ['extract', 'extraction'],
  degerlendirme: ['appraisal', 'assessment', 'evaluation'], kalite: ['appraisal', 'quality'], yanlilik: ['bias', 'appraisal'], analiz: ['analysis', 'analyze'],
  istatistik: ['statistics', 'analysis'], sonuc: ['result', 'results', 'outcome'], bulgular: ['results', 'findings'], tablo: ['table', 'tables'], sekil: ['figure', 'figures'],
  grafik: ['chart', 'figure', 'plot'], sema: ['diagram', 'figure'], akis: ['flow', 'prisma'], taslak: ['draft', 'manuscript'], makalem: ['manuscript'], yazi: ['manuscript', 'writing'],
  metin: ['manuscript', 'text'], kaynakca: ['references', 'citations', 'bibliography'], atif: ['citation', 'cite', 'cross-citations'], dergi: ['journal', 'submission'],
  gonderim: ['submission'], hakem: ['reviewer', 'review', 'rounds'], protokol: ['protocol'], kriter: ['criteria', 'criterion', 'eligibility'], uygunluk: ['eligibility'],
  dosya: ['file', 'files', 'folder'], klasor: ['folder', 'files'], gecmis: ['history', 'log'], surum: ['version', 'history', 'versions'], bagimlilik: ['dependencies', 'depends'],
  etki: ['affects', 'effect', 'impact'], not: ['note', 'notes'], gorev: ['task', 'tasks'], hasta: ['patient', 'patients', 'case', 'cases'], vaka: ['case', 'cases', 'case report'],
  ayar: ['settings', 'preferences'], yardim: ['help', 'assistant'], asistan: ['assistant'], komut: ['command', 'commands'], yedek: ['backup'], proje: ['project', 'projects'],
  // what a person does
  ekle: ['add', 'new'], yeni: ['new', 'add'], sil: ['delete', 'remove'], kaldir: ['remove', 'delete'], ac: ['open'], kapat: ['close'], kaydet: ['save'], duzenle: ['edit'],
  yeniden: ['again', 'rename', 'refresh'], adlandir: ['rename', 'name'], tasi: ['move'], kopyala: ['copy', 'duplicate'], disa: ['export'], aktar: ['export', 'import', 'transfer'],
  yukle: ['import', 'upload', 'load'], indir: ['download'], paylas: ['share', 'export'], yazdir: ['print', 'export'], karsilastir: ['compare', 'history'], geri: ['restore', 'back', 'undo'],
  dahil: ['include', 'included', 'inclusion'], haric: ['exclude', 'excluded', 'exclusion'], dislama: ['exclude', 'exclusion', 'excluded'], dislan: ['exclude', 'excluded'],
  kararsiz: ['uncertain', 'maybe'], karar: ['decision', 'decisions'], onayla: ['accept', 'confirm', 'verify'], kabul: ['accept'], reddet: ['reject'], dogrula: ['verify', 'check'],
  kontrol: ['check', 'checks'], uyari: ['warning', 'checks'], hata: ['error', 'problem'], sorun: ['problem', 'issue', 'checks'], eksik: ['missing', 'incomplete'], cift: ['duplicate', 'duplicates'],
  tekrar: ['duplicate', 'duplicates'], birlestir: ['merge', 'combine'], ayir: ['split', 'separate'], filtre: ['filter'], sirala: ['sort', 'order'], grupla: ['group'], say: ['count'],
  // the subject of the reviews
  omurga: ['spine', 'spinal'], skolyoz: ['scoliosis', 'deformity'], deformite: ['deformity'], cerrahi: ['surgery', 'surgical', 'operative'], ameliyat: ['surgery', 'operation'],
  fuzyon: ['fusion'], vida: ['screw', 'screws'], cubuk: ['rod', 'rods'], implant: ['implant', 'instrumentation'], dinamik: ['dynamic'], hibrit: ['hybrid'], rijit: ['rigid'],
  komplikasyon: ['complication', 'complications'], revizyon: ['revision'], gevseme: ['loosening'], kirilma: ['breakage', 'fracture'], takip: ['follow-up', 'followup'], sure: ['duration', 'time'],
  yas: ['age'], cinsiyet: ['sex', 'gender'], hastalik: ['disease', 'condition'], tedavi: ['treatment', 'intervention'], girisim: ['intervention'], karsilastirma: ['comparison', 'comparator'],
  tumor: ['tumor', 'tumour', 'glioma'], beyin: ['brain', 'cranial'], radyocerrahi: ['radiosurgery', 'srs'], radyoterapi: ['radiotherapy'], sagkalim: ['survival'], mortalite: ['mortality'],
  meta: ['meta-analysis'], derleme: ['review', 'systematic review'], sistematik: ['systematic'], olgu: ['case', 'cases'], kohort: ['cohort'], randomize: ['randomized', 'trial'],
});
