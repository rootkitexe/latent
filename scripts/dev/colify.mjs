// One-off refactor helper: merge a chapter overlay's top "title block" and bottom "controls" block into
// one .ov-col column (title → .fit-copy explainer → .ov-controls), so they stack instead of overlap.
//   node scripts/dev/colify.mjs <spec.json>
// spec: { file, titleOpen, titleWrapClass, splitAfter, bottomOpen, bottomClass }
import fs from 'node:fs';

const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let src = fs.readFileSync(spec.file, 'utf8');

function matchClose(s, start) {
  // from the '<div' at `start`, find the index just after its matching '</div>'
  const re = /<div\b[^>]*?(\/?)>|<\/div>/g;
  re.lastIndex = start;
  let depth = 0;
  for (let m; (m = re.exec(s)); ) {
    if (m[0].startsWith('</')) depth--;
    else if (!m[1]) depth++;
    if (depth === 0) return re.lastIndex;
  }
  throw new Error('unbalanced');
}
const must = (i, what) => { if (i < 0) throw new Error('not found: ' + what); return i; };

const t0 = must(src.indexOf(spec.titleOpen), 'titleOpen');
const t1 = matchClose(src, t0);
const b0 = must(src.indexOf(spec.bottomOpen, t1), 'bottomOpen');
const b1 = matchClose(src, b0);

let title = src.slice(t0, t1);
let bottom = src.slice(b0, b1);
const between = src.slice(t1, b0);

// title: open the column + a non-shrinking header; split into the flexible explainer after `splitAfter`
const openEnd = title.indexOf('>') + 1;
title = `<div className="gx ov-col right-0">\n<div className="shrink-0 ${spec.titleWrapClass}">` + title.slice(openEnd);
const s = must(title.indexOf(spec.splitAfter), 'splitAfter') + spec.splitAfter.length;
title = title.slice(0, s) + `\n</div>\n<div className="fit-copy ${spec.titleWrapClass}">` + title.slice(s);

// bottom: becomes the column's controls row
const bOpenEnd = bottom.indexOf('>') + 1;
bottom = (spec.bottomOpenNew || `<div className="ov-controls ${spec.bottomClass}">`) + bottom.slice(bOpenEnd);

src = src.slice(0, t0) + title + '\n' + bottom + '\n</div>' + between + src.slice(b1);
fs.writeFileSync(spec.file, src);
console.log('colified', spec.file);
