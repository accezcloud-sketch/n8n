const stripData = $('Strip Fences and Base64 Encode').first().json;
const unsplashResponse = $input.first().json;

let hasImage = false;
let imageUrl = '';
let coverImagePath = '/images/blog/pm-default.jpg';
let photographerName = '';
let photoUrl = '';

try {
  if (unsplashResponse && unsplashResponse.results && Array.isArray(unsplashResponse.results) && unsplashResponse.results.length > 0) {
    const firstResult = unsplashResponse.results[0];
    if (firstResult.urls && firstResult.urls.regular) {
      imageUrl = firstResult.urls.regular;
      coverImagePath = '/images/blog/' + stripData.topicSlug + '.jpg';
      hasImage = true;
      photographerName = (firstResult.user && firstResult.user.name) ? firstResult.user.name : '';
      photoUrl = (firstResult.links && firstResult.links.html) ? firstResult.links.html : '';
    }
  }
} catch (e) { hasImage = false; }

// Escape double quotes in photographer name for YAML safety
const escapedPhotographer = photographerName.replace(/"/g, '\\"');
const creditValue = photographerName ? ('Photo by ' + escapedPhotographer + ' on Unsplash') : '';

// Replace the coverImage line in the frontmatter
let updatedContent = stripData.fileContent;
// Normalize markdown: convert * bullets to - so the Accez renderer parses them as lists
updatedContent = updatedContent.replace(/^(\s*)\*\s+/gm, '$1- ');
const coverImageRegex = /coverImage:\s*"[^"]*"/;
if (coverImageRegex.test(updatedContent)) {
  updatedContent = updatedContent.replace(coverImageRegex, 'coverImage: "' + coverImagePath + '"');
}

// Inject coverImageCredit and coverImageCreditUrl after coverImageAlt (or after coverImage if alt not present)
if (hasImage && creditValue && photoUrl) {
  const creditBlock = 'coverImageCredit: "' + creditValue + '"\ncoverImageCreditUrl: "' + photoUrl + '"';
  // Remove any existing credit lines first to avoid duplicates on re-runs
  updatedContent = updatedContent.replace(/\n?coverImageCredit:\s*"[^"]*"/g, '');
  updatedContent = updatedContent.replace(/\n?coverImageCreditUrl:\s*"[^"]*"/g, '');
  // Insert after coverImageAlt line if it exists
  if (/coverImageAlt:\s*"[^"]*"/.test(updatedContent)) {
    updatedContent = updatedContent.replace(/(coverImageAlt:\s*"[^"]*")/, '$1\n' + creditBlock);
  } else {
    updatedContent = updatedContent.replace(/(coverImage:\s*"[^"]*")/, '$1\n' + creditBlock);
  }
}

return [{
  json: {
    fileContent: updatedContent,
    contentLength: updatedContent.length,
    articleTitle: stripData.articleTitle,
    topic: stripData.topic,
    topicSlug: stripData.topicSlug,
    rowNumber: stripData.rowNumber,
    colA: stripData.colA,
    colB: stripData.colB,
    colC: stripData.colC,
    imageUrl,
    hasImage,
    coverImagePath,
    imageFilePath: 'public/images/blog/' + stripData.topicSlug + '.jpg',
    photographerName,
    photoUrl
  }
}];