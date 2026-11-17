# Journal and citation-style catalog

Metadata snapshot from https://www.zotero.org/styles-files/styles.json, retrieved 2026-09-26. Includes all 10,863 catalog entries at retrieval, including dependent journal styles and general styles. Search is local.

Style metadata originates from the Citation Style Language community: https://github.com/citation-style-language/styles. These catalog labels identify journal targets; this app does not claim to apply every CSL file's formatting rules.

# Journal directory

`nlm-journals.json`: every journal in NCBI's databases, from NLM's https://ftp.ncbi.nlm.nih.gov/pubmed/J_Medline.txt (public domain), retrieved 2026-10-19: 38,084 titles with their NLM abbreviations. Rebuild with `node tools/build-journal-directory.mjs`. The journal search joins it with the style catalog above (`lib/journal-directory.mjs`): a journal in both keeps the catalog's format; one only NLM lists has a name and abbreviation, no known format.
