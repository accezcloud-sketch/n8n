const items = $input.all();

if (!items || items.length === 0) {
  throw new Error('No data received from Google Sheets. Check the sheet ID and permissions.');
}

for (let i = 0; i < items.length; i++) {
  const row = items[i].json;
  const keys = Object.keys(row).filter(k => k !== 'row_number');
  const colA = keys[0];
  const colB = keys[1];
  const colC = keys.length > 2 ? keys[2] : null;

  if (colB && row[colB] && row[colB].toString().toLowerCase().trim() === 'pending' && row[colA] && row[colA].toString().trim()) {
    const topic = row[colA].toString();
    const fullSlug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    // Cut at 60 characters, but never in the middle of a word.
    const topicSlug = fullSlug.length <= 60 ? fullSlug : fullSlug.substring(0, 61).replace(/-[^-]*$/, '');

    return [{
      json: {
        topic,
        rowNumber: row.row_number || (i + 2),
        topicSlug,
        colA,
        colB,
        colC
      }
    }];
  }
}

throw new Error('No pending topics found in the Google Sheet.');
