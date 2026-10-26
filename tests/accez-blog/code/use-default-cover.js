// Runs only when the Unsplash download or the image push to GitHub failed.
// The post then uses the default cover, so it never points at a missing image.
const gate = $('Quality Gate').first().json;
const DEFAULT_COVER = '/images/blog/pm-default.jpg';
const DEFAULT_ALT = 'A row of suburban houses under a clear blue sky';

const end = gate.fileContent.indexOf('\n---\n', 4); // end of the frontmatter block
const head = gate.fileContent.slice(0, end)
  .split('\n')
  .filter(line => !/^coverImageCredit(Url)?: /.test(line))
  .map(line => line.startsWith('coverImage: ') ? 'coverImage: ' + JSON.stringify(DEFAULT_COVER)
    : line.startsWith('coverImageAlt: ') ? 'coverImageAlt: ' + JSON.stringify(DEFAULT_ALT)
    : line)
  .join('\n');
const fileContent = head + gate.fileContent.slice(end);

return [{
  json: {
    fileContent,
    coverImagePath: DEFAULT_COVER,
    // GitHub puts the error message in `error` as text; HTTP Request puts an object there.
    imageError: (e => !e ? 'image step failed' : typeof e === 'string' ? e : (e.message || JSON.stringify(e)))($input.first().json.error)
  }
}];
