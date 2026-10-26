const stripData = $('Combine English and Arabic').first().json;
const unsplashResponse = $input.first().json;

let hasImage = false;
let imageUrl = '';
let photographerName = '';
let photoUrl = '';
let imageAlt = '';

try {
  if (unsplashResponse && Array.isArray(unsplashResponse.results) && unsplashResponse.results.length > 0) {
    const firstResult = unsplashResponse.results[0];
    if (firstResult.urls && firstResult.urls.regular) {
      imageUrl = firstResult.urls.regular;
      hasImage = true;
      photographerName = (firstResult.user && firstResult.user.name) ? firstResult.user.name : '';
      photoUrl = (firstResult.links && firstResult.links.html) ? firstResult.links.html : '';
      // Alt text must describe THIS photo. Gemini writes its alt before the photo
      // is chosen, so it described a different picture; use Unsplash's own description.
      imageAlt = String(firstResult.alt_description || firstResult.description || '')
        .replace(/\s*[—–]\s*|\s+-\s+/g, ', ') // no dashes as punctuation in site copy
        .replace(/\s+/g, ' ').trim();
    }
  }
} catch (e) { hasImage = false; }

const frontmatter = { ...stripData.frontmatter };
const coverImagePath = hasImage ? '/images/blog/' + stripData.topicSlug + '.jpg' : '/images/blog/pm-default.jpg';
frontmatter.coverImage = coverImagePath;
if (hasImage) {
  frontmatter.coverImageAlt = imageAlt
    ? imageAlt.charAt(0).toUpperCase() + imageAlt.slice(1)
    : 'Cover photo for the article ' + (frontmatter.title || stripData.topic);
  if (photographerName && photoUrl) {
    frontmatter.coverImageCredit = 'Photo by ' + photographerName + ' on Unsplash';
    frontmatter.coverImageCreditUrl = photoUrl;
  }
}
// (No image: Strip node already set the default cover, its alt text, and no credit.)

return [{
  json: {
    frontmatter,
    body: stripData.body,
    parseProblems: stripData.parseProblems,
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
