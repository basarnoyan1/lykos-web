// A record whose PDF moved with a reorganisation follows it: its path and name, the folder map's record of what was imported, and
// the study number the file's new name carries. Used for an organisation, a renumbering and the undo of either.
import { update } from '../store.mjs';
import { movedPath, parseStudyPdf } from './folder-map.mjs';
import { baseName } from './fsys.mjs';

export function followMove(from, to) {
  update(s => {
    for (const p of s.papers || []) if (p.pdfRel && (p.pdfRel === from || p.pdfRel.startsWith(`${from}/`))) {
      p.pdfRel = movedPath(p.pdfRel, [{ from, to }]); p.pdfName = baseName(p.pdfRel);
      const no = parseStudyPdf(p.pdfName)?.no;
      if (no) p.folderNo = no;
    }
    const map = s.folderMap?.applied;
    if (map) for (const k of Object.keys(map)) if (k === from || k.startsWith(`${from}/`)) { map[movedPath(k, [{ from, to }])] = map[k]; delete map[k]; }
    return s;
  });
}
