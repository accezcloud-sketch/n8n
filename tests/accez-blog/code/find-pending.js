const items = $input.all();

if (!items || items.length === 0) {
  throw new Error('No data received from Google Sheets. Check the sheet ID and permissions.');
}

// URL slug from the topic: lower case, words joined by hyphens, at most 60
// characters and always cut on a word boundary (never "...-goi" or "...-commun").
function slugify(text, max = 60) {
  const full = String(text)
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // café -> cafe
    .replace(/['\u2019]/g, '')                          // owner's -> owners
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (full.length <= max) return full;
  // Look one character past the limit: if it is a hyphen, the cut is already on a boundary.
  const head = full.slice(0, max + 1);
  const lastHyphen = head.lastIndexOf('-');
  const cut = lastHyphen > 0 ? head.slice(0, lastHyphen) : full.slice(0, max);
  return cut.replace(/-+$/, '');
}

for (let i = 0; i < items.length; i++) {
  const row = items[i].json;
  const allKeys = Object.keys(row).filter(k => k !== 'row_number');
  // Optional "Format" column (any position, any case). Empty or missing: the
  // workflow suggests a format itself (see "Collect Existing Posts").
  const formatKey = allKeys.find(k => /^\s*format\s*$/i.test(k)) || null;
  // Topic, status and date columns are read by position (A, B, C), skipping the format column.
  const keys = allKeys.filter(k => k !== formatKey);
  const colA = keys[0];
  const colB = keys[1];
  const colC = keys.length > 2 ? keys[2] : null;

  if (colB && row[colB] && row[colB].toString().toLowerCase().trim() === 'pending' && row[colA] && row[colA].toString().trim()) {
    // Kept exactly as in the sheet: the sheet update matches the row by this value.
    const topic = row[colA].toString();
    const topicSlug = slugify(topic);
    const format = formatKey && row[formatKey] != null ? row[formatKey].toString().trim() : '';

    return [{
      json: {
        topic,
        rowNumber: row.row_number || (i + 2),
        topicSlug,
        format,
        colA,
        colB,
        colC
      }
    }];
  }
}

throw new Error('No pending topics found in the Google Sheet.');
