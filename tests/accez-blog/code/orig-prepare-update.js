const topicData = $('Find First Pending Topic').first().json;
const sheetRow = {};
sheetRow[topicData.colA] = topicData.topic;
sheetRow[topicData.colB] = 'used';
if (topicData.colC) { sheetRow[topicData.colC] = DateTime.now().toFormat('yyyy-MM-dd'); }
return [{ json: { ...sheetRow, _topic: topicData.topic } }];