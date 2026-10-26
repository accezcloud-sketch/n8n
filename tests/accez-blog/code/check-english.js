// Step 1 of 2: the English article from Gemini. Stops the run (red execution, the
// topic stays pending) when Gemini returned nothing, so the Arabic step never
// writes from an empty article. Code fences and chatter before the frontmatter are
// removed here so the Arabic step sees the article only.
const raw = $input.first().json.text;
if (!raw || !String(raw).trim()) {
  throw new Error('No content received from Gemini (English article). Check the AI model response.');
}
let text = String(raw).replace(/\r\n/g, '\n').trim();
text = text.replace(/^```[a-zA-Z]*[ \t]*\n/, '').replace(/\n```[ \t]*$/, '').trim();
const fmStart = text.search(/^---[ \t]*$/m);
if (fmStart > 0) text = text.slice(fmStart);
return [{ json: { englishDraft: text } }];
