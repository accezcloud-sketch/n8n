const text = $input.first().json.text;

if (!text) {
  throw new Error('No content received from Gemini. Check the AI model response.');
}

let cleanText = text.trim();
if (cleanText.startsWith('```')) {
  cleanText = cleanText.replace(/^```(?:md|markdown|mdx)?\n?/, '').replace(/\n?```$/, '');
}

// Defensive YAML frontmatter sanitizer:
// Ensures string values for title/titleAr/excerpt/excerptAr/coverImageAlt/category/categoryAr/author/authorAr
// are always wrapped in double quotes, even if Gemini forgot.
function quoteFrontmatterField(content, fieldName) {
  // Match: fieldName: <anything until end of line>
  // Skip if value already starts with a double quote
  const regex = new RegExp('^(' + fieldName + ':)[ \\t]*(.*)$', 'm');
  return content.replace(regex, function(match, key, value) {
    const trimmed = value.trim();
    if (!trimmed) return match;
    // Already properly quoted
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) return match;
    // Strip wrapping single quotes if present
    let inner = trimmed;
    if (inner.startsWith("'") && inner.endsWith("'")) {
      inner = inner.slice(1, -1);
    }
    // Escape any internal double quotes
    inner = inner.replace(/\\"/g, '"').replace(/"/g, '\\"');
    return key + ' "' + inner + '"';
  });
}

// Split frontmatter from body to avoid touching content
const fmMatch = cleanText.match(/^(---\n)([\s\S]*?)(\n---)([\s\S]*)$/);
if (fmMatch) {
  let frontmatter = fmMatch[2];
  const fieldsToFix = ['title', 'titleAr', 'excerpt', 'excerptAr', 'coverImageAlt', 'category', 'categoryAr', 'author', 'authorAr'];
  for (const field of fieldsToFix) {
    frontmatter = quoteFrontmatterField(frontmatter, field);
  }
  cleanText = fmMatch[1] + frontmatter + fmMatch[3] + fmMatch[4];
}

// Extract the article title from the (now sanitized) frontmatter
let articleTitle = '';
const titleMatch = cleanText.match(/^title:\s*"([^"]*)"/m);
if (titleMatch) { articleTitle = titleMatch[1]; }

const topicData = $('Find First Pending Topic').first().json;

// Build a generic image search query from frontmatter tags (skip brand-y names)
const BRAND_BLOCKLIST = /airbnb|booking\.com|booking|accez|whatsapp|mada|sadad|ejar|gastat/i;
let searchQuery = 'hospitality business';
const tagsMatch = cleanText.match(/^tags:\s*\[([^\]]*)\]/m);
if (tagsMatch) {
  const rawTags = tagsMatch[1].split(',').map(t => t.trim().replace(/^["']|["']$/g, ''));
  const generic = rawTags.filter(t => t && !BRAND_BLOCKLIST.test(t));
  if (generic.length > 0) {
    searchQuery = generic.slice(0, 2).join(' ').toLowerCase();
  }
}

return [{
  json: {
    fileContent: cleanText,
    contentLength: cleanText.length,
    articleTitle: articleTitle || topicData.topic,
    searchQuery,
    topic: topicData.topic,
    topicSlug: topicData.topicSlug,
    rowNumber: topicData.rowNumber,
    colA: topicData.colA,
    colB: topicData.colB,
    colC: topicData.colC
  }
}];