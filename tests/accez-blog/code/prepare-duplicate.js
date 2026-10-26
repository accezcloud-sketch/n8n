// The topic repeats an existing post (same slug, or strong word overlap with
// its slug): nothing is written. The status column gets "duplicate: <existing slug>"
// so the row is not picked again. Change the topic and set it back to "pending"
// to write it anyway.
const plan = $('Collect Existing Posts').first().json;
const topicData = $('Find First Pending Topic').first().json;
const row = {};
row[topicData.colA] = topicData.topic;
row[topicData.colB] = 'duplicate: ' + plan.duplicateOf;
if (topicData.colC) { row[topicData.colC] = $now.toFormat('yyyy-MM-dd'); }
return [{ json: row }];
