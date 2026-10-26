// The post failed "Quality Gate": nothing was pushed. Mark the row so it is
// not picked again, with the reasons, for a person to look at.
// To retry the topic later, set its status back to "pending".
const gate = $('Quality Gate').first().json;
const topicData = $('Find First Pending Topic').first().json;
const row = {};
row[topicData.colA] = topicData.topic;
row[topicData.colB] = ('needs review: ' + gate.qualityIssues.join('; ')).slice(0, 1000);
if (topicData.colC) { row[topicData.colC] = $now.toFormat('yyyy-MM-dd'); }
return [{ json: row }];
